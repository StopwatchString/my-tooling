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
 * - Command `/agents`: list agents; view one's live transcript or stop it.
 * - Widget `agents`: one line per active agent, above the editor.
 * - Event `before_agent_start`: `subagents` prompt section (when to delegate,
 *   the personalities).
 * - Event `input`: user input while the main session is busy interrupts waits.
 * - Events `agent_settled`, `session_shutdown`: deliver held results; stop children.
 *
 * A child loads the normal extensions (minus this one, so no nesting), MCP
 * and tool search, uses the main session's model unless its personality says
 * otherwise, and writes its transcript to $TMPDIR/pi-agents/<session>/<id>/.
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
import { AgentView, elapsed, oneLine, statusIcon, summarizeArgs } from "./view.ts";

const SELF = realpathSync(fileURLToPath(import.meta.url));
const AGENT_TOOLS = ["agent", "agent_wait", "agent_send", "agent_stop"];
const RESULT_CAP = 50_000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_WAIT_S = 1800;
/** Finished children kept open for agent_send; older ones are closed. */
const KEEP_FINISHED = 8;

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

	function changed(run?: Run) {
		if (run) for (const l of run.listeners) l();
		const live = [...runs.values()].filter((r) => r.status === "queued" || r.status === "running");
		try {
			if (lastCtx?.hasUI) lastCtx.ui.setWidget("agents", live.length ? live.map(oneLine) : undefined);
		} catch {
			// stale context after a session switch
		}
		if (live.length && !ticker) ticker = setInterval(() => changed(), 1000);
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
			if (!run.claimed) {
				pending.add(run);
				flush();
			}
		});
	}

	function prune() {
		if (closing) return;
		const idle = [...runs.values()].filter((r) => r.session && r.endedAt && r.status !== "queued" && r.status !== "running");
		idle.sort((a, b) => b.endedAt! - a.endedAt!);
		for (const r of idle.slice(KEEP_FINISHED)) {
			void closeChild(r.session!);
			r.session = undefined;
			r.expired = true;
		}
	}

	function dispatch(
		ctx: ExtensionContext,
		p: { description: string; prompt: string; personality?: string; readonly?: boolean; background?: boolean },
	): Run {
		let persona: Personality | undefined;
		if (p.personality) {
			const all = loadPersonalities(getAgentDir(), ctx.cwd, ctx.isProjectTrusted());
			persona = all.get(p.personality);
			if (!persona) throw new Error(`unknown personality "${p.personality}"; available: ${[...all.keys()].join(", ") || "none"}`);
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
		};
		runs.set(id, run);
		run.done = cycle(run, p.prompt, () => startChild(ctx, run, persona, model));
		return run;
	}

	function stop(run: Run) {
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
			run.status === "done"
				? (run.result ?? "")
				: run.status === "failed"
					? `Error: ${run.error}`
					: run.status === "stopped"
						? `Stopped.${run.session?.getLastAssistantText() ? ` Last message:\n${run.session.getLastAssistantText()}` : ""}`
						: `Still ${run.status}${run.activity ? ` (${run.activity})` : ""}.`;
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
		if (run.status === "queued" || run.status === "running") {
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

	const resultRenderer = (result: { content: Array<{ type: string; text?: string }>; details?: unknown }, expanded: boolean, theme: any) => {
		const line = (result.details as { line?: string } | undefined)?.line;
		const text = result.content[0]?.type === "text" ? (result.content[0].text ?? "") : "";
		if (expanded || !line) return new Text(text, 0, 0);
		return new Text(theme.fg("dim", line), 0, 0);
	};

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
		async execute(_id, params, signal, onUpdate, ctx) {
			lastCtx = ctx;
			const run = dispatch(ctx, params);
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
		renderCall(args, theme) {
			const tags = [args.personality, args.background && "background", args.readonly && "readonly"].filter(Boolean);
			return new Text(
				theme.fg("toolTitle", theme.bold("agent ")) +
					theme.fg("accent", String(args.description ?? "")) +
					(tags.length ? theme.fg("dim", ` (${tags.join(", ")})`) : ""),
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			return resultRenderer(result, expanded, theme);
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
				: [...runs.values()].filter((r) => r.status === "queued" || r.status === "running" || !r.claimed);
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
			const unfinished = targets.filter((r) => r.status === "queued" || r.status === "running");
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
		renderResult(result, { expanded }, theme) {
			return resultRenderer(result, expanded, theme);
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
		async execute(_id, params, signal, onUpdate, ctx) {
			lastCtx = ctx;
			const run = getRun(params.id);
			if (run.status === "running" && run.session) {
				await run.session.steer(params.message);
				return { content: [{ type: "text", text: `Sent to ${run.id}; it sees the message after its current step.` }], details: undefined };
			}
			if (run.status === "queued") throw new Error(`${run.id} has not started yet`);
			if (run.expired) throw new Error(`${run.id}'s session was closed to free resources; dispatch a new agent`);
			if (!run.session) throw new Error(`${run.id} never started (${run.error ?? run.status}); dispatch a new agent`);
			run.claimed = !params.background;
			pending.delete(run);
			run.done = cycle(run, params.message);
			if (params.background) {
				return { content: [{ type: "text", text: `Continuing ${run.id} in the background.` }], details: undefined };
			}
			return follow(run, signal, onUpdate);
		},
		renderResult(result, { expanded }, theme) {
			return resultRenderer(result, expanded, theme);
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

	pi.registerCommand("agents", {
		description: "List subagents; view one's transcript or stop it",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			if (!runs.size) return ctx.ui.notify("No agents in this session.", "info");
			let run = args.trim() ? runs.get(args.trim()) : undefined;
			if (!run) {
				const items: Run[] = [...runs.values()].reverse();
				const labels = items.map(oneLine);
				const pick = await ctx.ui.select("Agents", labels);
				run = items[labels.indexOf(pick ?? "")];
				if (!run) return;
			}
			const live = run.status === "queued" || run.status === "running";
			const action = live ? await ctx.ui.select(`${statusIcon(run)} ${run.id}`, ["View transcript", "Stop"]) : "View transcript";
			if (action === "Stop") return stop(run);
			if (action !== "View transcript" || ctx.mode !== "tui") return;
			const target = run;
			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => {
					const view = new AgentView(target, tui, theme, () => done());
					const rerender = () => tui.requestRender();
					target.listeners.add(rerender);
					return Object.assign(view, { dispose: () => target.listeners.delete(rerender) });
				},
				{ overlay: true, overlayOptions: { width: "90%", maxHeight: "90%" } },
			);
		},
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
			"- `agent_send` steers a running agent or continues a finished one with its context intact.",
			...(personas.length
				? ["", "Personalities (`personality` argument):", ...personas.map((p) => `- ${p.name}: ${p.description}`)]
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
		if (ticker) clearInterval(ticker);
		ticker = undefined;
	});
}
