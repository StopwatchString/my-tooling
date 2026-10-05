/**
 * Subagents: hand tasks to fresh in-process agent sessions.
 *
 * - Tool `agent`: run a task in a new subagent, optionally with a personality
 *   (see personalities.ts). Foreground returns its final message; background
 *   returns an id, and the result arrives later as an `agent-result` message
 *   that starts a turn once the main session is idle.
 * - Tool `agent_wait`: block until background agents finish; returns their results.
 *   A message from the user ends any wait early: agent_wait returns what has
 *   finished, and a foreground agent moves to the background.
 * - Tool `agent_send`: steer a running agent, or continue a finished one.
 * - Tool `agent_stop`: abort an agent.
 * - Command `/agents [id]` and shortcut Alt+A: the agent switcher (view.ts), a
 *   tab per agent with its full live transcript.
 * - Widget `agents`: one line per active agent, above the editor. Live agents
 *   get an animated spinner in the pi logo colors (shimmer.ts), here and on
 *   their tool blocks.
 * - Event `before_agent_start`: `subagents` prompt section (when to delegate,
 *   the personalities).
 * - Event `input`: user input while the main session is busy interrupts waits.
 * - Events `agent_settled`, `session_shutdown`: deliver held results; stop children.
 *
 * A child loads the normal extensions (minus this one, so no nesting), MCP
 * and tool search, uses the main session's model unless its personality says
 * otherwise, and writes its transcript to $TMPDIR/pi-agents/<session>/<id>/.
 *
 * Pipeline: after an agent finishes, each further stage is a fresh agent (a new context,
 * briefed only with the spec and the earlier reports), working on the same change:
 *   1. implementation: the dispatched agent itself
 *   2. tests (`tests: true` on the agent tool): the personality's `tester:` writes tests
 *   3. review (`then:`): a reviewer ends with VERDICT: PASS or FAIL; on FAIL a new agent of
 *      the same personality fixes the findings and a new reviewer checks again, up to
 *      `rounds` reviews
 *   4. merge-back, after a passing review (or with no `then:`), described below
 * The result returned or delivered is the agent's report plus every stage's report. A
 * personality with `default: true` is used for agents that may edit files and name no
 * personality, so delegated code changes always go through the pipeline.
 *
 * Worktrees: in a git repository, every agent that may edit files gets its own git worktree
 * on branch pi/<session>-<id>, branched from the main checkout's HEAD, so agents build and
 * test without stepping on each other; its stage agents work there too. Merge-back commits
 * the work on the branch. If the main checkout's branch has moved, a fresh `merger:` agent
 * rebases onto it, resolves conflicts and re-runs the checks. Then the main branch is
 * fast-forwarded and the worktree and branch removed. Merges into one checkout run one at
 * a time. Work that fails review or can't be fast-forwarded stays on its branch, and the
 * report says where.
 *
 * Concurrency is per model provider: `subagents.maxConcurrency` in
 * ~/.pi/agent/settings.json, either a number or { "default": 3, "<provider>": n }.
 * $PI_AGENT_MAX_CONCURRENCY overrides the default; the fallback is 3.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	createMcpExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { loadPersonalities, type Personality, toolOptions } from "./personalities.ts";
import { FRAME_MS, shimmer, spinner } from "./shimmer.ts";
import { AgentSwitcher, AgentTail, elapsed, isLive, lineBody, oneLine, statusIcon, summarizeArgs } from "./view.ts";

const SELF = realpathSync(fileURLToPath(import.meta.url));
const AGENT_TOOLS = ["agent", "agent_wait", "agent_send", "agent_stop"];
const RESULT_CAP = 50_000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WAIT_S = 1800;
/** Finished children kept open for agent_send; older ones are closed. */
const KEEP_FINISHED = 8;
/** Transcript lines in an expanded agent tool block. */
const TAIL_LINES = 30;
/** Reviews per task when a `then:` personality gives no `rounds`. */
const DEFAULT_ROUNDS = 2;
/** Rebases per merge-back before giving up on a main branch that keeps moving. */
const MERGE_ATTEMPTS = 3;

const execFileP = promisify(execFile);

/** Run git in `cwd`; resolves to trimmed stdout, rejects with git's stderr. */
async function git(cwd: string, ...args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileP("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
		return stdout.trim();
	} catch (e) {
		const err = e as { stderr?: string; message?: string };
		throw new Error(`git ${args[0]}: ${(err.stderr || err.message || String(e)).trim()}`);
	}
}

/** An agent's own git worktree and branch. */
export type Worktree = {
	/** Top level of the main checkout. */
	root: string;
	path: string;
	/** Where the agent works: the worktree plus the main session's subdirectory. */
	cwd: string;
	branch: string;
	/** Branch of the main checkout the work merges back into. */
	target: string;
	/** Commit the worktree started from (later: the commit it was last rebased onto). */
	base: string;
	notes: string[];
	/** Short sha now at the tip of `target`, or "nothing to merge"; the worktree is gone. */
	merged?: string;
};

export type Run = {
	id: string;
	description: string;
	personality?: string;
	readonly: boolean;
	provider: string;
	status: "queued" | "running" | "done" | "failed" | "stopped";
	session?: AgentSession;
	result?: string;
	error?: string;
	startedAt?: number;
	endedAt?: number;
	toolCalls: number;
	activity: string;
	dir: string;
	transcript?: string;
	/** Session closed to free resources; can't be continued. */
	expired?: boolean;
	/** Settles when the current prompt cycle ends (replaced on continue). */
	done: Promise<void>;
	/** Result already taken by a foreground call or agent_wait: don't deliver it as a message. */
	claimed: boolean;
	unqueue?: () => void;
	listeners: Set<() => void>;
	persona?: Personality;
	/** The task as given (plus any follow-ups), for the reviewer. */
	spec: string;
	/** Set while a pipeline stage runs after this agent's work, e.g. "review 1/2", "merge". */
	stage?: string;
	/** The stage agent (tester, reviewer, fixer, merger) working on this agent's change right now. */
	helper?: Run;
	/** Set on a stage agent: the id of the agent whose pipeline it belongs to. Internal; never delivered on its own. */
	stageOf?: string;
	/** The latest review of this agent's work. */
	review?: { by: string; verdict: "pass" | "fail" | "unclear"; text: string; round: number; rounds: number };
	/** Run a test-writing stage before review. */
	tests?: boolean;
	/** Reports from this pipeline's stage agents, in order. */
	log: { title: string; text: string }[];
	/** Directory the child session runs in. */
	cwd: string;
	/** May edit files and owns its pipeline: give it a worktree, if cwd is in a git repository. */
	isolate: boolean;
	/** Its worktree; stage agents share their pipeline's. */
	wt?: Worktree;
	/** Stop requested during the pipeline: no further rounds. */
	halt?: boolean;
};

function maxConcurrency(provider: string): number {
	let conf: unknown;
	try {
		conf = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"))?.subagents?.maxConcurrency;
	} catch {
		// no settings file: defaults
	}
	const valid = (v: unknown) => (typeof v === "number" && v >= 1 ? Math.floor(v) : undefined);
	const map = conf && typeof conf === "object" ? (conf as Record<string, unknown>) : undefined;
	return (
		valid(map?.[provider]) ??
		valid(Number(process.env.PI_AGENT_MAX_CONCURRENCY) || undefined) ??
		valid(map ? map.default : conf) ??
		DEFAULT_CONCURRENCY
	);
}

function isSelf(path: string): boolean {
	try {
		return realpathSync(path) === SELF;
	} catch {
		return false;
	}
}

/**
 * Tear a child down like pi's own runtime does: session_shutdown first, so its
 * extensions (MCP connections in particular) close; dispose() alone leaves them open.
 */
async function closeChild(session: AgentSession): Promise<void> {
	try {
		await session.abort();
		if (session.extensionRunner.hasHandlers("session_shutdown")) {
			await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		}
	} catch {
		// best effort
	} finally {
		session.dispose();
	}
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function brief(run: Run, persona: Personality | undefined): string {
	const lines = [
		"# Subagent",
		"",
		`You are subagent ${run.id}, dispatched by another agent to do one task. You cannot see its`,
		"conversation, and it sees only your final message; the user does not see your work directly.",
		"",
		"- Do the task you were given; don't widen the scope. If something blocks you, say so in your",
		"  final message instead of guessing.",
	];
	if (run.readonly) lines.push("- Read-only task: do not modify files or run commands that change state.");
	if (run.wt) {
		lines.push(
			`- You work in a dedicated git worktree, ${run.wt.path}, on branch ${run.wt.branch}. Build, install`,
			"  dependencies, and run tests there freely; other agents have their own worktrees. Never touch the",
			`  main checkout at ${run.wt.root}. Untracked and ignored files (node_modules, build output, .env) and`,
			"  submodules start out missing; set up what your checks need.",
		);
		if (!run.readonly) {
			lines.push(
				"- Don't commit unless your task says to: the harness commits the work on the branch and merges it",
				"  back. End your final message with a line `COMMIT: <subject>`, an imperative commit subject for",
				"  the change as a whole, under 72 characters.",
			);
		}
	}
	lines.push(
		"- End with your answer for the dispatcher, in one of these forms: a short direct answer; a",
		"  summary of what you did (files changed, commands run, anything left undone); or, for long",
		`  findings, a report written to ${join(run.dir, "report.md")} plus its path and a few-line summary.`,
	);
	if (persona?.prompt) lines.push("", persona.prompt);
	return lines.join("\n");
}

/** A new worktree for `run`, branched from the HEAD of `cwd`'s checkout; undefined outside a git repository. */
async function createWorktree(run: Run, cwd: string, session: string): Promise<Worktree | undefined> {
	let root: string;
	let prefix: string;
	try {
		[root = "", prefix = ""] = (await git(cwd, "rev-parse", "--show-toplevel", "--show-prefix")).split("\n");
		await git(cwd, "rev-parse", "--verify", "-q", "HEAD");
	} catch {
		return undefined; // not a repository, or one with no commits yet
	}
	const target = await git(root, "symbolic-ref", "-q", "--short", "HEAD").catch(() => "");
	if (!target) throw new Error("the main checkout is on a detached HEAD; check out a branch so work can merge back into it");
	const base = await git(root, "rev-parse", "HEAD");
	const branch = `pi/${session.slice(0, 8)}-${run.id}`;
	const path = join(run.dir, "worktree");
	await git(root, "worktree", "add", "-q", "-b", branch, path, base);
	const notes: string[] = [];
	if (await git(root, "status", "--porcelain")) {
		notes.push(`The main checkout had uncommitted changes; ${run.id} started from ${target} at ${base.slice(0, 8)} without them.`);
	}
	return { root, path, cwd: join(path, prefix), branch, target, base, notes };
}

/** The last `COMMIT: <subject>` line of a report, else `fallback`. */
function commitSubject(report: string, fallback: string): string {
	const m = [...report.matchAll(/^\s*COMMIT:\s*(.+?)\s*$/gm)].pop();
	return (m?.[1] ?? fallback).replace(/^[`"']|[`"']$/g, "").slice(0, 100);
}

/** Commit whatever is uncommitted in the worktree; true if there was anything. */
async function commitAll(wt: Worktree, message: string): Promise<boolean> {
	await git(wt.path, "add", "-A");
	if (!(await git(wt.path, "status", "--porcelain"))) return false;
	await git(wt.path, "commit", "-q", "-m", message);
	return true;
}

async function removeWorktree(wt: Worktree) {
	await git(wt.root, "worktree", "remove", "--force", wt.path);
	await git(wt.root, "branch", "-D", wt.branch);
}

async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
	return git(cwd, "merge-base", "--is-ancestor", a, b).then(
		() => true,
		() => false,
	);
}

async function rebaseInProgress(wt: Worktree): Promise<boolean> {
	for (const dir of ["rebase-merge", "rebase-apply"]) {
		const p = await git(wt.path, "rev-parse", "--path-format=absolute", "--git-path", dir);
		if (existsSync(p)) return true;
	}
	return false;
}

export default function (pi: ExtensionAPI) {
	const runs = new Map<string, Run>();
	const pending = new Set<Run>(); // finished background runs waiting to be delivered
	const active = new Map<string, number>(); // running count per provider
	const waiting: Run[] = [];
	const wake = new Map<Run, () => void>();
	const interrupters = new Set<() => void>(); // active waits, ended by user input
	let lastCtx: ExtensionContext | undefined;
	let nextId = 1;
	let ticker: ReturnType<typeof setInterval> | undefined;
	/**
	 * Tool blocks by tool call id: the run and the prompt cycle (`done`) the call started, so a block
	 * animates only during its own cycle, and the block's latest invalidate() to redraw it.
	 */
	const blocks = new Map<string, { run: Run; done: Promise<void>; invalidate?: () => void; settled?: boolean }>();
	let closing = false; // session_shutdown in progress: no pruning or delivery
	const mergeLocks = new Map<string, Promise<void>>(); // per main checkout: one merge-back at a time

	// --- concurrency -------------------------------------------------------

	function drain() {
		for (let i = 0; i < waiting.length; ) {
			const r = waiting[i]!;
			if ((active.get(r.provider) ?? 0) < maxConcurrency(r.provider)) {
				waiting.splice(i, 1);
				active.set(r.provider, (active.get(r.provider) ?? 0) + 1);
				wake.get(r)?.();
			} else i++;
		}
	}

	/** Resolves true once a slot is held, false if the run was stopped while queued. */
	function acquire(run: Run): Promise<boolean> {
		return new Promise((resolve) => {
			wake.set(run, () => {
				wake.delete(run);
				run.unqueue = undefined;
				resolve(true);
			});
			run.unqueue = () => {
				wake.delete(run);
				const i = waiting.indexOf(run);
				if (i >= 0) waiting.splice(i, 1);
				run.unqueue = undefined;
				resolve(false);
			};
			waiting.push(run);
			drain();
		});
	}

	function release(run: Run) {
		active.set(run.provider, Math.max(0, (active.get(run.provider) ?? 1) - 1));
		drain();
	}

	// --- UI ----------------------------------------------------------------

	function blockLive(b: { run: Run; done: Promise<void> }): boolean {
		return b.done === b.run.done && isLive(b.run);
	}

	/** Remember which run a tool block shows; returns it once execute() has linked one. */
	function track(context: { toolCallId: string; invalidate: () => void }) {
		const b = blocks.get(context.toolCallId);
		if (b) b.invalidate = context.invalidate;
		return b;
	}

	function changed(run?: Run) {
		if (run) for (const l of run.listeners) l();
		// Redraw animating blocks, plus once more when one settles to show its final state.
		for (const b of blocks.values()) {
			if (b.settled) continue;
			if (!blockLive(b)) b.settled = true;
			b.invalidate?.();
		}
		const live = [...runs.values()].filter(isLive);
		try {
			if (lastCtx?.hasUI) lastCtx.ui.setWidget("agents", live.length ? live.map((r) => oneLine(r, true)) : undefined);
		} catch {
			// stale context after a session switch
		}
		if (live.length && !ticker) ticker = setInterval(() => changed(), FRAME_MS);
		if (!live.length && ticker) {
			clearInterval(ticker);
			ticker = undefined;
		}
	}

	// --- child sessions ----------------------------------------------------

	function resolveModel(ctx: ExtensionContext, spec: string | undefined) {
		if (!spec) return ctx.model;
		const slash = spec.indexOf("/");
		const model = slash > 0 ? ctx.modelRegistry.find(spec.slice(0, slash), spec.slice(slash + 1)) : undefined;
		if (!model) throw new Error(`personality model "${spec}" not found (use provider/id)`);
		return model;
	}

	async function startChild(ctx: ExtensionContext, run: Run, persona: Personality | undefined, model: ExtensionContext["model"]) {
		const cwd = run.cwd;
		const agentDir = getAgentDir();
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			extensionFactories: [createToolSearchExtension(), createMcpExtension()],
			extensionsOverride: (base) => ({ ...base, extensions: base.extensions.filter((e) => !isSelf(e.resolvedPath)) }),
			appendSystemPromptOverride: (base) => [...base, brief(run, persona)],
		});
		await loader.reload();
		const tools = toolOptions(persona?.tools, run.readonly);
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			resourceLoader: loader,
			sessionManager: SessionManager.create(cwd, run.dir),
			model,
			thinkingLevel: (persona?.thinking ?? ctx.thinkingLevel) as ExtensionContext["thinkingLevel"],
			tools: tools.tools,
			excludeTools: [...tools.exclude, ...AGENT_TOOLS],
		});
		await session.bindExtensions({});
		if (tools.add.length) session.setActiveToolsByName([...new Set([...session.getActiveToolNames(), ...tools.add])]);
		session.subscribe((ev) => {
			if (ev.type === "tool_execution_start" && !("parentToolCallId" in ev && ev.parentToolCallId)) {
				run.toolCalls++;
				run.activity = `${ev.toolName} ${summarizeArgs(ev.args)}`.slice(0, 80);
				changed(run);
			} else if (ev.type === "message_end" || ev.type === "turn_end") changed(run);
		});
		return session;
	}

	/** One prompt cycle: wait for a slot, (start and) prompt the child, record the outcome. */
	function cycle(run: Run, text: string, start?: () => Promise<AgentSession>): Promise<void> {
		run.status = "queued";
		run.result = run.error = undefined;
		run.endedAt = undefined;
		changed(run);
		return (async () => {
			if (!(await acquire(run))) return;
			try {
				run.status = "running";
				run.startedAt = Date.now();
				changed(run);
				if (!run.session) {
					run.session = await start!();
					run.transcript = run.session.sessionManager.getSessionFile();
				}
				if ((run.status as Run["status"]) === "stopped") return;
				await run.session.prompt(text);
				if ((run.status as Run["status"]) === "stopped") return;
				const last = [...run.session.messages].reverse().find((m) => (m as { role?: string }).role === "assistant") as
					| { stopReason?: string; errorMessage?: string }
					| undefined;
				if (last?.stopReason === "error") {
					run.status = "failed";
					run.error = last.errorMessage ?? "model error";
				} else {
					run.status = "done";
					run.result = run.session.getLastAssistantText() ?? "(no final message)";
				}
			} catch (e) {
				if (run.status !== "stopped") {
					run.status = "failed";
					run.error = errorText(e);
				}
			} finally {
				release(run);
			}
		})().finally(() => {
			run.endedAt = Date.now();
			run.activity = "";
			prune();
			changed(run);
		});
	}

	/** Queue a finished unit of work for delivery as a message, unless a caller took the result. */
	function deliver(run: Run) {
		if (run.claimed || run.stageOf) return;
		pending.add(run);
		flush();
	}

	/** Run `fn` after every earlier call for the same `key` has settled (merges into one checkout). */
	function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const next = (mergeLocks.get(key) ?? Promise.resolve()).then(fn);
		mergeLocks.set(
			key,
			next.then(
				() => undefined,
				() => undefined,
			),
		);
		return next;
	}

	/**
	 * One unit of work: set up the worktree (first time), a prompt cycle, then the pipeline, each
	 * stage a fresh agent in the same worktree: tests (`tests: true`), review rounds (`then:`; on a
	 * failed review a new agent fixes the findings and a new reviewer checks again, up to `rounds`
	 * reviews), and merge-back. Stage agents themselves (`stageOf`) just run their prompt.
	 */
	async function work(ctx: ExtensionContext, run: Run, text: string, start?: () => Promise<AgentSession>) {
		run.halt = false;
		if (run.isolate && !run.wt) {
			run.stage = "worktree";
			changed(run);
			try {
				run.wt = await createWorktree(run, ctx.cwd, ctx.sessionManager.getSessionId());
			} catch (e) {
				run.status = "failed";
				run.error = `couldn't create a worktree: ${errorText(e)}`;
				return;
			} finally {
				run.stage = undefined;
			}
			if (!run.wt) run.isolate = false;
			else run.cwd = run.wt.cwd;
			if (run.halt) {
				run.status = "stopped";
				if (run.wt) await removeWorktree(run.wt).catch(() => undefined);
				return;
			}
		}
		await cycle(run, text, start);
		if (run.stageOf || run.status !== "done") return;
		const persona = run.persona;
		run.log = [];
		run.review = undefined;
		let latest = run.result ?? ""; // the newest implementation report
		try {
			let tests = "";
			if (run.tests) {
				const t = await stage(ctx, run, "tests", `tests for ${run.id}`, persona?.tester ?? "tester", [
					`Another agent (${run.id}) just implemented the spec below. Write tests for the change.`,
					...whereChange(run),
					"",
					"## Spec",
					run.spec,
					"",
					`## ${run.id}'s report`,
					latest,
				]);
				if (run.halt) return;
				run.log.push({ title: `Tests by ${t.id}`, text: t.text });
				tests = t.text;
			}
			if (persona?.then) {
				const rounds = persona.rounds ?? DEFAULT_ROUNDS;
				let previous = "";
				for (let round = 1; round <= rounds; round++) {
					const rv = await stage(ctx, run, `review ${round}/${rounds}`, `review ${run.id}`, persona.then, reviewPrompt(run, latest, tests, previous), true);
					if (run.halt) return;
					const m = [...rv.text.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)].pop();
					const verdict = !rv.ok || !m ? "unclear" : m[1]!.toUpperCase() === "PASS" ? "pass" : "fail";
					run.review = { by: rv.id, verdict, text: rv.text, round, rounds };
					const label = verdict === "pass" ? "PASS" : verdict === "unclear" ? "no clear verdict" : round === rounds ? "FAIL (review rounds used up)" : "FAIL";
					run.log.push({ title: `Review ${round}/${rounds} by ${rv.id}: ${label}`, text: rv.text });
					if (verdict !== "fail" || round === rounds) break;
					const fx = await stage(ctx, run, `fixing ${round}/${rounds}`, `fix ${run.id}`, persona.name, [
						`Another agent implemented the spec below, and a reviewer found problems with it. Fix what the review`,
						"reports, nothing more. If you disagree with a finding, say why instead of changing the code.",
						...whereChange(run),
						"End with the same kind of report as the implementer's: files changed, checks run, open points.",
						"",
						"## Spec",
						run.spec,
						"",
						"## Implementer's report",
						latest,
						"",
						"## Review",
						rv.text,
					]);
					if (run.halt) return;
					run.log.push({ title: `Fixes by ${fx.id}`, text: fx.text });
					if (!fx.ok) return; // the failed review stands; nothing merges
					latest = fx.text;
					previous = rv.text;
				}
			}
			if (run.halt) return;
			if (run.wt && (!run.review || run.review.verdict === "pass")) await mergeBack(ctx, run, latest);
		} finally {
			run.stage = undefined;
			run.helper = undefined;
			changed(run);
		}
	}

	/** Where a stage agent finds the change it works on. */
	function whereChange(run: Run): string[] {
		if (!run.wt) return ["The change is in the working tree; start with `git status` and `git diff` if this is a git repository."];
		return [`It is uncommitted in the git worktree you're working in; \`git status\` and \`git diff ${run.wt.base}\` show it.`];
	}

	function reviewPrompt(run: Run, latest: string, tests: string, previous: string): string[] {
		return [
			`Review the change another agent (${run.id}) made, against the spec it was given.`,
			...whereChange(run),
			...(run.wt ? [] : ["Other agents may have touched other files, so stick to the files this change concerns."]),
			"Check that it does what the spec asks, nothing it doesn't, and has no defects; run the relevant checks and tests.",
			"",
			"## Spec",
			run.spec,
			"",
			"## Implementer's report",
			latest,
			...(tests ? ["", "## Test writer's report", tests] : []),
			...(previous ? ["", "## Previous review", "An earlier review found the problems below and they were fixed since; check that they are.", previous] : []),
			"",
			"End your final message with a line that is exactly `VERDICT: PASS` if nothing must change, or `VERDICT: FAIL` after listing what must change.",
		];
	}

	/** Hand one pipeline stage of `run` to a fresh agent in its worktree and wait for its report. */
	async function stage(
		ctx: ExtensionContext,
		run: Run,
		label: string,
		description: string,
		personality: string,
		prompt: string[],
		readonly = false,
	): Promise<{ id: string; ok: boolean; text: string }> {
		run.stage = label;
		changed(run);
		let h: Run;
		try {
			h = dispatch(ctx, { description, prompt: prompt.join("\n"), personality, readonly, stageOf: run.id, cwd: run.cwd, worktree: run.wt });
		} catch (e) {
			// e.g. the personality doesn't exist
			return { id: personality, ok: false, text: `${label}: ${errorText(e)}` };
		}
		run.helper = h;
		changed(run);
		await h.done;
		run.helper = undefined;
		if (h.status === "done") return { id: h.id, ok: true, text: h.result ?? "" };
		return { id: h.id, ok: false, text: `${label} ${h.status}: ${h.error ?? "no result"}` };
	}

	/**
	 * Commit the work on its branch and fast-forward the main checkout's branch to it. If that
	 * branch moved since the work started, a fresh merger agent first rebases onto it and re-checks.
	 */
	async function mergeBack(ctx: ExtensionContext, run: Run, latest: string) {
		const wt = run.wt!;
		run.stage = "merge";
		changed(run);
		const subject = commitSubject(latest, run.description);
		try {
			await commitAll(wt, subject);
			if ((await git(wt.path, "rev-list", "--count", `${wt.base}..HEAD`)) === "0") wt.merged = "nothing to merge";
			else await serialize(wt.root, () => land(ctx, run, wt, subject, latest));
		} catch (e) {
			wt.notes.push(`Not merged: ${errorText(e)}`);
			return;
		}
		try {
			await removeWorktree(wt);
		} catch (e) {
			wt.notes.push(`Couldn't remove the worktree: ${errorText(e)}`);
		}
	}

	async function land(ctx: ExtensionContext, run: Run, wt: Worktree, subject: string, latest: string) {
		for (let attempt = 1; ; attempt++) {
			const current = await git(wt.root, "symbolic-ref", "-q", "--short", "HEAD").catch(() => "");
			if (current !== wt.target) throw new Error(`the main checkout is on ${current || "a detached HEAD"} now, not ${wt.target}`);
			const head = await git(wt.root, "rev-parse", "HEAD");
			if (await isAncestor(wt.path, head, "HEAD")) break;
			if (attempt > MERGE_ATTEMPTS) throw new Error(`${wt.target} kept moving (${MERGE_ATTEMPTS} rebases)`);
			const mg = await stage(ctx, run, `rebase ${attempt}/${MERGE_ATTEMPTS}`, `merge ${run.id}`, run.persona?.merger ?? "merger", [
				`Another agent's change, implementing the spec below, is committed on branch ${wt.branch} in the git worktree`,
				`you're working in. Since it started, ${wt.target} in the main checkout moved from ${wt.base.slice(0, 8)} to`,
				`${head.slice(0, 8)}. Bring the branch up to date so it can be fast-forwarded into ${wt.target}:`,
				"",
				`1. Run \`git rebase ${head}\`. Resolve conflicts so both sides' intent survives, then \`git add\` and`,
				"   `git rebase --continue`.",
				"2. Re-run the checks that cover the change (build, tests) on the combined code and fix what breaks,",
				"   committing the fixes on the branch.",
				"3. Leave the worktree clean: rebase finished, everything committed. Don't touch the main checkout.",
				"",
				"If the upstream changes make this change wrong or unnecessary, `git rebase --abort` and say why.",
				"",
				"## Spec",
				run.spec,
				"",
				"## Implementer's report",
				latest,
			]);
			if (run.halt) throw new Error("stopped during merge-back");
			run.log.push({ title: `Merge-back by ${mg.id}`, text: mg.text });
			if (!mg.ok) throw new Error(mg.text);
			if (await rebaseInProgress(wt)) throw new Error(`${mg.id} left the rebase unfinished`);
			await commitAll(wt, `${subject} (merge fixes)`);
			if (!(await isAncestor(wt.path, head, "HEAD"))) throw new Error(`${mg.id} didn't rebase onto ${head.slice(0, 8)}`);
			wt.base = head;
			run.stage = "merge";
			changed(run);
		}
		await git(wt.root, "merge", "-q", "--ff-only", wt.branch);
		wt.merged = await git(wt.root, "rev-parse", "--short", "HEAD");
	}

	function prune() {
		if (closing) return;
		const idle = [...runs.values()].filter((r) => r.session && r.endedAt && !isLive(r));
		idle.sort((a, b) => b.endedAt! - a.endedAt!);
		for (const r of idle.slice(KEEP_FINISHED)) {
			void closeChild(r.session!);
			r.session = undefined;
			r.expired = true;
		}
	}

	function dispatch(
		ctx: ExtensionContext,
		p: {
			description: string;
			prompt: string;
			personality?: string;
			readonly?: boolean;
			background?: boolean;
			tests?: boolean;
			stageOf?: string;
			cwd?: string;
			worktree?: Worktree;
		},
	): Run {
		const all = loadPersonalities(getAgentDir(), ctx.cwd, ctx.isProjectTrusted());
		let persona: Personality | undefined;
		if (p.personality) {
			persona = all.get(p.personality);
			if (!persona) throw new Error(`unknown personality "${p.personality}"; available: ${[...all.keys()].join(", ") || "none"}`);
		} else if (!p.readonly) {
			// May edit files: route through the default personality (implementer), if there is one.
			persona = [...all.values()].find((x) => x.default);
		}
		const model = resolveModel(ctx, persona?.model);
		if (!model) throw new Error("no model selected");
		const id = `a${nextId++}`;
		const dir = join(tmpdir(), "pi-agents", ctx.sessionManager.getSessionId(), id);
		mkdirSync(dir, { recursive: true });
		const run: Run = {
			id,
			description: p.description,
			personality: persona?.name,
			readonly: p.readonly ?? false,
			provider: model.provider,
			status: "queued",
			toolCalls: 0,
			activity: "",
			dir,
			done: Promise.resolve(),
			claimed: !p.background,
			listeners: new Set(),
			persona,
			spec: p.prompt,
			stageOf: p.stageOf,
			tests: p.tests,
			log: [],
			cwd: p.cwd ?? ctx.cwd,
			isolate: !p.readonly && !p.stageOf,
			wt: p.worktree,
		};
		runs.set(id, run);
		run.done = work(ctx, run, p.prompt, () => startChild(ctx, run, persona, model)).finally(() => deliver(run));
		return run;
	}

	function stop(run: Run) {
		if (run.stage) {
			run.halt = true;
			if (run.helper) stop(run.helper);
		}
		if (run.status === "queued") {
			run.status = "stopped";
			run.unqueue?.();
		} else if (run.status === "running") {
			run.status = "stopped";
			void run.session?.abort();
		}
	}

	function report(run: Run): string {
		const tags = [run.id, run.description, run.personality, `${run.status} after ${elapsed(run)}`, `${run.toolCalls} tool calls`];
		let body =
			run.stage && run.status === "done"
				? `Implementation finished; still in ${run.stage}${run.helper ? ` by ${run.helper.id}` : ""}. Its report so far:\n${run.result ?? ""}`
				: run.status === "done"
				? (run.result ?? "")
				: run.status === "failed"
					? `Error: ${run.error}`
					: run.status === "stopped"
						? `Stopped.${run.session?.getLastAssistantText() ? ` Last message:\n${run.session.getLastAssistantText()}` : ""}`
						: `Still ${run.status}${run.activity ? ` (${run.activity})` : ""}.`;
		for (const entry of run.log) body += `\n\n## ${entry.title}\n${entry.text}`;
		const wt = run.wt;
		if (wt && !run.stageOf && !run.stage) {
			body += "\n\n## Merge-back\n";
			if (wt.merged === "nothing to merge") body += "No changes to merge; the worktree is removed.";
			else if (wt.merged) body += `Merged: ${wt.target} fast-forwarded to ${wt.merged}; the worktree and branch are removed.`;
			else body += `Not merged. The work is on branch ${wt.branch}, in the worktree ${wt.path}.`;
			for (const note of wt.notes) body += `\n${note}`;
		}
		if (body.length > RESULT_CAP) {
			const path = join(run.dir, "result.md");
			writeFileSync(path, body);
			body = `${body.slice(0, RESULT_CAP)}\n\n[truncated; full result in ${path}]`;
		}
		return `[agent ${tags.filter(Boolean).join(" · ")}]\n${body}${run.transcript ? `\n[transcript: ${run.transcript}]` : ""}`;
	}

	/** Deliver finished background results, but only while the main session is idle. */
	function flush() {
		if (closing) return;
		const ready = [...pending].filter((r) => !r.claimed);
		pending.clear();
		if (!ready.length) return;
		let idle = false;
		try {
			idle = !!lastCtx?.isIdle();
		} catch {
			idle = false;
		}
		if (!idle) {
			for (const r of ready) pending.add(r);
			return;
		}
		for (const r of ready) r.claimed = true;
		pi.sendMessage(
			{
				customType: "agent-result",
				content: ready.map(report).join("\n\n"),
				display: true,
				details: { ids: ready.map((r) => r.id) },
			},
			{ triggerTurn: true },
		);
	}

	/** Resolves when the user sends a message while the main session is busy. */
	function userInterrupt(): { promise: Promise<void>; dispose: () => void } {
		let fire!: () => void;
		const promise = new Promise<void>((resolve) => (fire = resolve));
		interrupters.add(fire);
		return { promise, dispose: () => interrupters.delete(fire) };
	}

	/**
	 * Foreground wait with live progress through onUpdate; Ctrl+C stops the run.
	 * A user message detaches it instead: it keeps running and its result arrives as a message.
	 */
	async function follow(run: Run, signal: AbortSignal | undefined, onUpdate: ((r: any) => void) | undefined) {
		const update = () =>
			onUpdate?.({ content: [{ type: "text", text: oneLine(run) }], details: { id: run.id, line: oneLine(run) } });
		run.listeners.add(update);
		const onAbort = () => stop(run);
		signal?.addEventListener("abort", onAbort);
		const interrupt = userInterrupt();
		try {
			update();
			await Promise.race([run.done, interrupt.promise]);
		} finally {
			interrupt.dispose();
			run.listeners.delete(update);
			signal?.removeEventListener("abort", onAbort);
		}
		if (isLive(run)) {
			run.claimed = false;
			return {
				content: [
					{
						type: "text" as const,
						text: `The user sent a message, so agent ${run.id} moved to the background and is still ${run.status}. Its result will arrive as a message; call agent_wait to block on it.`,
					},
				],
				details: { id: run.id, line: `${run.id} moved to the background` },
			};
		}
		return { content: [{ type: "text" as const, text: report(run) }], details: { id: run.id, line: oneLine(run) } };
	}

	function getRun(id: string): Run {
		const run = runs.get(id);
		if (!run) throw new Error(`no agent "${id}"; known: ${[...runs.keys()].join(", ") || "none"}`);
		return run;
	}

	const resultRenderer = (
		result: { content: Array<{ type: string; text?: string }>; details?: unknown },
		expanded: boolean,
		theme: any,
		context: { toolCallId: string; invalidate: () => void },
	) => {
		const line = (result.details as { line?: string } | undefined)?.line;
		const text = result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
		const b = track(context);
		// Expanded (click or Ctrl+O): a live tail of the agent's transcript.
		if (b && expanded) return new AgentTail(b.run, theme, TAIL_LINES);
		// A foreground agent's progress line, live and animated while it runs.
		if (b && blockLive(b) && b.run.claimed) {
			return new Text(`${statusIcon(b.run, true)} ${theme.fg("dim", lineBody(b.run))}`, 0, 0);
		}
		if (expanded || !line) return new Text(text, 0, 0);
		return new Text(theme.fg("dim", line), 0, 0);
	};

	/** Status for a background agent's call line: spinner and shimmer while it runs, then the outcome. */
	function backgroundStatus(run: Run, live: boolean, theme: any): string {
		if (live) return `${spinner()} ${shimmer(run.stage ?? (run.status === "queued" ? "queued" : "background"))}`;
		const color = run.status === "done" ? "success" : run.status === "failed" ? "error" : "warning";
		return `${theme.fg(color, statusIcon(run))} ${theme.fg("dim", run.status)}`;
	}

	// --- tools -------------------------------------------------------------

	pi.registerTool({
		name: "agent",
		label: "Agent",
		description: [
			"Hand a task to a subagent: a fresh agent with this session's tools and model and no view of this",
			"conversation. Its final message is returned to you (not shown to the user).",
			"The prompt must be self-contained: goal, relevant paths and facts, constraints, and what to hand back.",
			"background: true returns an id at once; the result arrives later as a message, or call agent_wait.",
			"readonly: true forbids file edits. personality picks a preset (listed in the system prompt).",
		].join(" "),
		promptSnippet: "Hand a task to a subagent with a fresh context; get back its final message",
		parameters: Type.Object({
			description: Type.String({ description: "3-5 word label shown in the UI" }),
			prompt: Type.String({ description: "The complete task brief" }),
			personality: Type.Optional(Type.String({ description: "Personality name; omit for a general agent" })),
			background: Type.Optional(Type.Boolean({ description: "Run without blocking (default false)" })),
			readonly: Type.Optional(Type.Boolean({ description: "Forbid file modifications (default false)" })),
			tests: Type.Optional(
				Type.Boolean({ description: "Code changes: have a separate agent write tests for the change before review (default false)" }),
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			lastCtx = ctx;
			const run = dispatch(ctx, params);
			blocks.set(toolCallId, { run, done: run.done });
			if (params.background) {
				return {
					content: [
						{
							type: "text",
							text: `Started agent ${run.id} (${run.status}). Its result will arrive as a message when it finishes; call agent_wait to block on it.`,
						},
					],
					details: { id: run.id, line: `started ${run.id} in the background` },
				};
			}
			return follow(run, signal, onUpdate);
		},
		renderCall(args, theme, context) {
			const b = track(context);
			// Without a linked run (before execute, or replayed history) fall back to a plain tag.
			const tags = [args.personality, args.background && !b && "background", args.readonly && "readonly"].filter(Boolean);
			return new Text(
				theme.fg("toolTitle", theme.bold("agent ")) +
					theme.fg("accent", String(args.description ?? "")) +
					(tags.length ? theme.fg("dim", ` (${tags.join(", ")})`) : "") +
					(b && args.background ? ` ${backgroundStatus(b.run, blockLive(b), theme)}` : ""),
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme, context) {
			return resultRenderer(result, expanded, theme, context);
		},
	});

	pi.registerTool({
		name: "agent_wait",
		label: "Agent wait",
		description:
			"Block until background agents finish and return their results. ids: which agents (default: every unfinished or undelivered one). A result returned here is not delivered again as a message. A message from the user ends the wait early.",
		parameters: Type.Object({
			ids: Type.Optional(Type.Array(Type.String())),
			timeout_seconds: Type.Optional(Type.Number({ description: `Default ${DEFAULT_WAIT_S}` })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			lastCtx = ctx;
			const targets: Run[] = params.ids?.length
				? params.ids.map(getRun)
				: [...runs.values()].filter((r) => !r.stageOf && (isLive(r) || !r.claimed));
			if (!targets.length) return { content: [{ type: "text", text: "No agents to wait for." }], details: undefined };
			for (const r of targets) {
				r.claimed = true;
				pending.delete(r);
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			let interrupted = false;
			const interrupt = userInterrupt();
			const stopWaiting = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, (params.timeout_seconds ?? DEFAULT_WAIT_S) * 1000);
				signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			await Promise.race([
				Promise.all(targets.map((r) => r.done)),
				stopWaiting,
				interrupt.promise.then(() => {
					interrupted = true;
				}),
			]);
			clearTimeout(timer);
			interrupt.dispose();
			const unfinished = targets.filter(isLive);
			for (const r of unfinished) r.claimed = false; // deliver it as a message when it does finish
			const early = interrupted && unfinished.length > 0;
			let text = targets.map(report).join("\n\n");
			if (early) text = `[wait ended early: the user sent a message; unfinished results will arrive as messages]\n\n${text}`;
			return {
				content: [{ type: "text", text }],
				details: { line: `${targets.length - unfinished.length}/${targets.length} finished${early ? " (interrupted)" : ""}` },
			};
		},
		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("agent_wait ")) + theme.fg("accent", args.ids?.join(", ") || "all"),
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme, context) {
			return resultRenderer(result, expanded, theme, context);
		},
	});

	pi.registerTool({
		name: "agent_send",
		label: "Agent send",
		description:
			"Send a message to an agent. A running agent sees it after its current step. A finished agent continues with its context intact and returns a new final message (background: true to not block).",
		parameters: Type.Object({
			id: Type.String(),
			message: Type.String(),
			background: Type.Optional(Type.Boolean()),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			lastCtx = ctx;
			const run = getRun(params.id);
			if (run.status === "running" && run.session) {
				await run.session.steer(params.message);
				return { content: [{ type: "text", text: `Sent to ${run.id}; it sees the message after its current step.` }], details: undefined };
			}
			if (run.status === "queued") throw new Error(`${run.id} has not started yet`);
			if (run.stage) throw new Error(`${run.id} is in ${run.stage}; wait for it (agent_wait) or stop it first`);
		if (run.wt?.merged && !run.stageOf) throw new Error(`${run.id}'s work is merged and its worktree removed; dispatch a new agent`);
			if (run.expired) throw new Error(`${run.id}'s session was closed to free resources; dispatch a new agent`);
			if (!run.session) throw new Error(`${run.id} never started (${run.error ?? run.status}); dispatch a new agent`);
			run.claimed = !params.background;
			pending.delete(run);
			run.spec += `\n\n## Follow-up instructions\n${params.message}`;
			run.done = work(ctx, run, params.message).finally(() => deliver(run));
			blocks.set(toolCallId, { run, done: run.done });
			if (params.background) {
				return { content: [{ type: "text", text: `Continuing ${run.id} in the background.` }], details: undefined };
			}
			return follow(run, signal, onUpdate);
		},
		renderResult(result, { expanded }, theme, context) {
			return resultRenderer(result, expanded, theme, context);
		},
	});

	pi.registerTool({
		name: "agent_stop",
		label: "Agent stop",
		description: "Stop a queued or running agent.",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			lastCtx = ctx;
			const run = getRun(params.id);
			run.claimed = true;
			stop(run);
			await run.done;
			return { content: [{ type: "text", text: report(run) }], details: undefined };
		},
	});

	pi.registerMessageRenderer("agent-result", (message, { expanded }, theme) => {
		const ids = (message.details as { ids?: string[] } | undefined)?.ids ?? [];
		const head = theme.fg("accent", `◆ agent result: ${ids.join(", ")}`);
		const text = typeof message.content === "string" ? message.content : "";
		return new Text(expanded ? `${head}\n${text}` : `${head} ${theme.fg("dim", "(Ctrl+O to expand)")}`, 0, 0);
	});

	// --- /agents -----------------------------------------------------------

	/** Open the switcher at `id`, else the newest live agent, else the newest one. */
	async function openSwitcher(ctx: ExtensionContext, id?: string) {
		lastCtx = ctx;
		if (!runs.size) return ctx.ui.notify("No agents in this session.", "info");
		if (id && !runs.has(id)) return ctx.ui.notify(`No agent "${id}".`, "warning");
		const all = [...runs.values()];
		const start = id ?? ([...all].reverse().find(isLive) ?? all[all.length - 1]!).id;
		if (ctx.mode !== "tui") {
			// No overlay outside the TUI: pick an agent, then offer to stop it.
			const items = all.reverse();
			const labels = items.map((r) => oneLine(r));
			const run = items[labels.indexOf((await ctx.ui.select("Agents", labels)) ?? "")];
			if (run && isLive(run) && (await ctx.ui.confirm(`Stop ${run.id}?`, run.description))) stop(run);
			return;
		}
		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) =>
				new AgentSwitcher(
					() => [...runs.values()],
					start,
					tui,
					theme,
					() => done(),
					(run) => {
						stop(run);
						changed(run);
					},
				),
			{ overlay: true, overlayOptions: { width: "90%", maxHeight: "90%" } },
		);
	}

	pi.registerCommand("agents", {
		description: "Agent switcher: every subagent's live transcript (←/→ to switch); /agents <id> opens one",
		getArgumentCompletions: (prefix) =>
			[...runs.values()]
				.filter((r) => r.id.startsWith(prefix))
				.map((r) => ({ value: r.id, label: r.id, description: r.description })),
		handler: (args, ctx) => openSwitcher(ctx, args.trim() || undefined),
	});

	pi.registerShortcut("alt+a", {
		description: "Open the agent switcher",
		handler: (ctx) => openSwitcher(ctx),
	});

	// --- events ------------------------------------------------------------

	pi.on("session_start", (_e, ctx) => {
		lastCtx = ctx;
		closing = false;
	});

	pi.on("input", (event) => {
		// Only while busy (a wait is a tool call, so the session is streaming); extension input isn't the user.
		if (event.streamingBehavior && event.source !== "extension") for (const fire of [...interrupters]) fire();
		return { action: "continue" };
	});

	pi.on("agent_settled", (_e, ctx) => {
		lastCtx = ctx;
		flush();
	});

	pi.on("before_agent_start", (event, ctx) => {
		lastCtx = ctx;
		const personas = [...loadPersonalities(getAgentDir(), ctx.cwd, ctx.isProjectTrusted()).values()];
		const n = maxConcurrency(ctx.model?.provider ?? "");
		const def = personas.find((p) => p.default);
		event.systemPromptOptions.sections.subagents = [
			"## Subagents",
			"",
			"The `agent` tool hands a task to a subagent: a fresh agent with your tools and no view of this",
			"conversation. Only its final message comes back to you, and the user doesn't see it, so relay what matters.",
			"",
			'- Delegate when the user asks for an agent or subagent, parallel work, or to "fan out", and for broad',
			"  searches or investigations where you need the conclusion, not the file dumps. Do small lookups yourself.",
			"- Brief it like a colleague who just walked in: the goal, paths and facts you already know, constraints,",
			"  and what to hand back (a short answer, a summary of changes, or a report file).",
			"- For independent tasks, start several with `background: true` in one turn, then call `agent_wait`, or",
			`  keep working and handle results as they arrive. Up to ${n} run at once on this endpoint; more queue.`,
			"- Use `readonly: true` for research. Split code changes so parallel agents touch different files;",
			"  overlapping edits still merge, but through conflict resolution.",
			...(def
				? [
						`- Code changes: an agent that may edit files and names no personality runs as \`${def.name}\`.${def.then ? ` When it finishes, a fresh \`${def.then}\` agent reviews the change against your prompt; on a failed review a fresh \`${def.name}\` fixes the findings and a fresh reviewer checks again (up to ${def.rounds ?? DEFAULT_ROUNDS} reviews).` : ""}`,
						"  With `tests: true`, a fresh test-writing agent adds tests before the review; ask for it when the",
						"  change has behavior worth pinning down and the project has a test suite.",
						"  So write the prompt as a precise spec (what to change, where, constraints, how to verify), and set",
						"  `readonly: true` on every agent that shouldn't change files.",
					]
				: []),
			"- In a git repository, every agent that may edit files works in its own git worktree, branched from",
			"  the current HEAD, so editing agents can run in parallel without clashing. Uncommitted changes in the",
			"  main checkout are not in that worktree; commit them first (with the user's OK) if an agent needs them.",
			"  When the work passes review it is committed and merged back: the current branch is fast-forwarded to",
			"  it (rebased first by a merge agent if the branch moved). The report says whether it merged or which",
			"  branch and worktree hold it. Run the checks yourself afterwards if several merges landed.",
			"- `agent_send` steers a running agent or continues a finished one with its context intact.",
			...(personas.length
				? [
						"",
						"Personalities (`personality` argument):",
						...personas.map((p) => `- ${p.name}: ${p.description}${p.then ? ` (reviewed by ${p.then})` : ""}`),
					]
				: []),
		].join("\n");
	});

	pi.on("session_shutdown", async () => {
		closing = true;
		const sessions: AgentSession[] = [];
		for (const run of runs.values()) {
			stop(run);
			if (run.session) sessions.push(run.session);
		}
		await Promise.all(sessions.map(closeChild));
		runs.clear();
		pending.clear();
		blocks.clear();
		if (ticker) clearInterval(ticker);
		ticker = undefined;
	});
}
