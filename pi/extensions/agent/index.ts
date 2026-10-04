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
 * Review pipeline: a personality with `then: <name>` (implementer.md) has every
 * finished task reviewed by that personality, with failed reviews (VERDICT: FAIL)
 * sent back to the same agent to fix, up to `rounds` reviews. The result returned
 * or delivered is the agent's report plus the last review. A personality with
 * `default: true` is used for agents that may edit files and name no personality,
 * so delegated code changes are always reviewed.
 *
 * Concurrency is per model provider: `subagents.maxConcurrency` in
 * ~/.pi/agent/settings.json, either a number or { "default": 3, "<provider>": n }.
 * $PI_AGENT_MAX_CONCURRENCY overrides the default; the fallback is 3.
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
	/** Set while a review pipeline runs after this agent's work, e.g. "review 1/2". */
	stage?: string;
	/** The agent reviewing this one; reused across rounds. */
	reviewer?: Run;
	/** Set on a reviewer: the id of the agent it reviews. Internal; never delivered on its own. */
	reviewOf?: string;
	/** The latest review of this agent's work. */
	review?: { by: string; verdict: "pass" | "fail" | "unclear"; text: string; round: number; rounds: number };
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
	lines.push(
		"- End with your answer for the dispatcher, in one of these forms: a short direct answer; a",
		"  summary of what you did (files changed, commands run, anything left undone); or, for long",
		`  findings, a report written to ${join(run.dir, "report.md")} plus its path and a few-line summary.`,
	);
	if (persona?.prompt) lines.push("", persona.prompt);
	return lines.join("\n");
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
		const cwd = ctx.cwd;
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
		if (run.claimed || run.reviewOf) return;
		pending.add(run);
		flush();
	}

	/**
	 * One unit of work: a prompt cycle, then, for a personality with `then:`, review rounds;
	 * a failed review goes back to this agent to fix, until a pass or `rounds` reviews.
	 */
	async function work(ctx: ExtensionContext, run: Run, text: string, start?: () => Promise<AgentSession>) {
		await cycle(run, text, start);
		const then = run.persona?.then;
		if (!then || run.status !== "done") return;
		const rounds = run.persona?.rounds ?? DEFAULT_ROUNDS;
		run.halt = false;
		try {
			for (let round = 1; round <= rounds; round++) {
				run.stage = `review ${round}/${rounds}`;
				changed(run);
				const rv = await reviewOnce(ctx, run, then);
				if (run.halt) return;
				const text = rv.status === "done" ? (rv.result ?? "") : `Review ${rv.status}: ${rv.error ?? "no result"}`;
				const m = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)].pop();
				const verdict = rv.status !== "done" || !m ? "unclear" : m[1]!.toUpperCase() === "PASS" ? "pass" : "fail";
				run.review = { by: rv.id, verdict, text, round, rounds };
				if (verdict !== "fail" || round === rounds) return;
				run.stage = `fixing ${round}/${rounds}`;
				await cycle(
					run,
					[
						`A reviewer (${rv.id}) checked your change and found problems. Fix what it reports, nothing more.`,
						"If you disagree with a finding, say why instead of changing the code.",
						"End with the same kind of report as before.",
						"",
						"## Review",
						text,
					].join("\n"),
				);
				if (run.status !== "done" || run.halt) return;
			}
		} finally {
			run.stage = undefined;
			changed(run);
		}
	}

	/** Run one review of `run`: a new reviewer for the first round, the same one after fixes. */
	async function reviewOnce(ctx: ExtensionContext, run: Run, personality: string): Promise<Run> {
		const prev = run.reviewer;
		const ending = "End your final message with a line that is exactly `VERDICT: PASS` if nothing must change, or `VERDICT: FAIL` after listing what must change.";
		if (prev?.session && !prev.expired && !isLive(prev)) {
			prev.done = cycle(
				prev,
				[`${run.id} has made changes since your review. Its report:`, "", run.result ?? "", "", "Check them against the spec and your findings, and that nothing else broke.", ending].join("\n"),
			);
			await prev.done;
			return prev;
		}
		const prompt = [
			`Review the change another agent (${run.id}) just made, against the spec it was given.`,
			"",
			"## Spec",
			run.spec,
			"",
			`## ${run.id}'s report`,
			run.result ?? "",
			"",
			"Work out what changed: start with `git status` and `git diff` if this is a git repository. Other agents may",
			"have touched other files, so stick to the files this change concerns. Check that it does what the spec",
			"asks, nothing it doesn't, and has no defects; run the relevant checks if they are cheap.",
			"",
			ending,
		].join("\n");
		let rv: Run;
		try {
			rv = dispatch(ctx, { description: `review ${run.id}`, prompt, personality, readonly: true, reviewOf: run.id });
		} catch (e) {
			// e.g. the `then:` personality doesn't exist: report it as a failed review
			return { id: personality, status: "failed", error: errorText(e) } as Run;
		}
		run.reviewer = rv;
		changed(run);
		await rv.done;
		return rv;
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
		p: { description: string; prompt: string; personality?: string; readonly?: boolean; background?: boolean; reviewOf?: string },
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
			reviewOf: p.reviewOf,
		};
		runs.set(id, run);
		run.done = work(ctx, run, p.prompt, () => startChild(ctx, run, persona, model)).finally(() => deliver(run));
		return run;
	}

	function stop(run: Run) {
		if (run.stage) {
			run.halt = true;
			if (run.reviewer) stop(run.reviewer);
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
				? `Implementation finished; still in ${run.stage}${run.reviewer ? ` by ${run.reviewer.id}` : ""}. Its report so far:\n${run.result ?? ""}`
				: run.status === "done"
				? (run.result ?? "")
				: run.status === "failed"
					? `Error: ${run.error}`
					: run.status === "stopped"
						? `Stopped.${run.session?.getLastAssistantText() ? ` Last message:\n${run.session.getLastAssistantText()}` : ""}`
						: `Still ${run.status}${run.activity ? ` (${run.activity})` : ""}.`;
		const rv = run.review;
		if (rv && !run.stage) {
			const verdict = rv.verdict === "pass" ? "PASS" : rv.verdict === "fail" ? "FAIL (review rounds used up)" : "no clear verdict";
			body += `\n\n## Review by ${rv.by}, round ${rv.round}/${rv.rounds}: ${verdict}\n${rv.text}`;
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
				: [...runs.values()].filter((r) => !r.reviewOf && (isLive(r) || !r.claimed));
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
			"- Use `readonly: true` for research. Don't let two agents edit the same files at once.",
			...(def
				? [
						`- Code changes: an agent that may edit files and names no personality runs as \`${def.name}\`.${def.then ? ` When it finishes, a \`${def.then}\` agent reviews the change against your prompt, and failed reviews go back to it for fixes (up to ${def.rounds ?? DEFAULT_ROUNDS} reviews); you get its report plus the final review.` : ""}`,
						"  So write the prompt as a precise spec (what to change, where, constraints, how to verify), and set",
						"  `readonly: true` on every agent that shouldn't change files.",
					]
				: []),
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
