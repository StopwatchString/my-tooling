/**
 * Subagents: the `agent` tool starts a fresh pi session in this process, in
 * a working directory of the caller's choice, with auto-compaction on and
 * the same model, extensions and MCP servers. It returns at once; the
 * agent's final answer reaches the caller as a message when it finishes,
 * which starts a turn if the caller is idle. `allow_subagents` decides
 * whether the agent gets the `agent` tool itself.
 *
 * `agent_message` sends an agent more instructions: a running agent reads
 * them after its current step, a finished or stopped one carries on with its
 * context and answers again. An agent only known from the session file (pi
 * restarted) is started afresh with its saved conversation as context.
 *
 * An agent counts as finished when its session settles with nothing it
 * started still running, so an agent that waits on its own shells or
 * subagents gets their results first. Its session lives on until the
 * top-level session ends, so it can be messaged again.
 */
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	createAgentSession,
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Type } from "typebox";
import {
	type AgentTask,
	changed,
	clip,
	elapsed,
	formatLine,
	logLine,
	nextId,
	notify,
	record,
	recordEnd,
	registry,
	runningOwnedBy,
	SAVED_ARGS,
	SAVED_RESULT,
} from "./registry.ts";

export const AGENT_DONE = "task-agent-done";
export const AGENT_TOOL = "agent";

type ToolArgs = Record<string, unknown>;
type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
type Content = { type: string; text?: string };

/** `Name(main arg)` for the list below the prompt. */
function activity(toolName: string, args: ToolArgs): string {
	const main = args.command ?? args.path ?? args.pattern ?? args.description ?? args.query ?? args.id;
	const text = typeof main === "string" ? main.split("\n")[0]! : "";
	return text ? `${toolName}(${text})` : toolName;
}

function preamble(cwd: string, allowSubagents: boolean): string {
	return [
		"You are a subagent: another agent (the orchestrator) started you to do one task.",
		`You work in ${cwd}.`,
		"The orchestrator sees only your final message, so end with a complete, self-contained answer:",
		"what you found or did, with file paths and anything it needs to act on. Don't ask questions; nobody will answer them.",
		"The orchestrator may send you more messages later; answer each the same way.",
		allowSubagents
			? "You may start subagents of your own with the agent tool for independent parts of the task."
			: "You can't start subagents.",
		"",
	].join("\n");
}

/** A saved conversation, for an agent started again after a restart. */
function history(task: AgentTask): string {
	return task.log.map(formatLine).join("\n\n");
}

/** A tool result's text; images as a placeholder. */
function resultText(result: unknown): string {
	const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [];
	return content
		.map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`))
		.join("\n")
		.trim();
}

/** Waits for the session to settle, once per call. */
type Settle = () => Promise<void>;
const settles = new WeakMap<AgentSession, Set<() => void>>();

async function createLive(task: AgentTask, ctx: ExtensionContext, thinkingLevel: ThinkingLevel): Promise<AgentSession> {
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(task.cwd, agentDir);
	settingsManager.applyOverrides({ compaction: { enabled: true } });
	const resourceLoader = new DefaultResourceLoader({
		cwd: task.cwd,
		agentDir,
		settingsManager,
		// The CLI's built-in extensions, which SDK sessions don't load on their own.
		extensionFactories: [createCodemodeExtension(), createToolSearchExtension(), createMcpExtension()],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: task.cwd,
		agentDir,
		model: ctx.model,
		thinkingLevel,
		resourceLoader,
		settingsManager,
		sessionManager: SessionManager.inMemory(task.cwd),
		excludeTools: task.allowSubagents ? [] : [AGENT_TOOL],
	});
	const id = session.sessionManager.getSessionId();
	task.session = id;
	task.live = session;
	registry.sessions.set(id, task.id);
	const settled = new Set<() => void>();
	settles.set(session, settled);
	const calls = new Map<string, string>(); // tool call id -> its arguments

	session.subscribe((event) => {
		if (event.type === "message_update" && event.message.role === "assistant") {
			task.streaming = event.message;
		} else if (event.type === "message_end") {
			task.streaming = undefined;
			task.messages = [...session.messages];
			if (event.message.role === "assistant") {
				task.tokens += event.message.usage?.output ?? 0;
				// Its text is saved, not its thinking; tool calls are saved as they end.
				const text = (event.message.content as Content[])
					.filter((c) => c.type === "text")
					.map((c) => c.text ?? "")
					.join("\n")
					.trim();
				if (text) logLine(task, "agent", text);
			}
		} else if (event.type === "tool_execution_start" && !event.parentToolCallId) {
			task.toolUses++;
			task.activity = activity(event.toolName, (event.args ?? {}) as ToolArgs);
			calls.set(event.toolCallId, JSON.stringify(event.args ?? {}));
		} else if (event.type === "tool_execution_end" && !event.parentToolCallId) {
			const args = clip(calls.get(event.toolCallId) ?? "{}", SAVED_ARGS);
			calls.delete(event.toolCallId);
			const text = clip(resultText(event.result) || "(no output)", SAVED_RESULT);
			logLine(task, "tool", text, { name: event.toolName, args, isError: event.isError });
		} else if (event.type === "compaction_start") {
			task.activity = "Compacting…";
		} else if (event.type === "agent_settled") {
			for (const fn of settled) fn();
		} else {
			return;
		}
		changed();
	});
	task.stop = async () => {
		await session.abort();
		for (const fn of settled) fn();
	};
	await session.bindExtensions({});
	return session;
}

function nextSettle(session: AgentSession): Settle {
	return () =>
		new Promise<void>((done) => {
			const settled = settles.get(session)!;
			const fn = () => {
				settled.delete(fn);
				done();
			};
			settled.add(fn);
		});
}

/** Prompt the agent and report when it is done with everything it started. */
async function run(task: AgentTask, session: AgentSession, text: string): Promise<void> {
	await session.prompt(text);
	const settle = nextSettle(session);
	while (task.status === "running" && runningOwnedBy(task.session!).length > 0) await settle();
	task.messages = [...session.messages];
	task.answer = session.getLastAssistantText()?.trim() || "(The agent ended without a final message.)";
	if (task.status === "running") task.status = "done";
}

/** Run `work` as the agent's next stretch of work, then tell its owner how it went. */
function launch(task: AgentTask, work: () => Promise<void>): void {
	task.status = "running";
	task.ended = undefined;
	task.saved = false;
	task.dismissed = false;
	task.quiet = false;
	task.error = undefined;
	changed();
	void work()
		.catch((error: unknown) => {
			if (task.status === "running") task.status = "failed";
			task.error = error instanceof Error ? error.message : String(error);
		})
		.then(() => {
			task.ended ??= Date.now();
			task.streaming = undefined;
			recordEnd(task);
			changed();
			if (task.quiet) return;
			const head = `Agent ${task.id} ("${task.description}")`;
			const stats = `after ${elapsed(task)} (${task.toolUses} tool uses)`;
			const content =
				task.status === "done"
					? `${head} finished ${stats}. Its final answer:\n\n${task.answer}`
					: task.status === "stopped"
						? `${head} was stopped by the user ${stats}. task_log ${task.id} shows its conversation so far.`
						: `${head} failed ${stats}: ${task.error ?? "unknown error"}. task_log ${task.id} shows its conversation so far.`;
			notify(task.owner, AGENT_DONE, content, {
				id: task.id,
				description: task.description,
				status: task.status,
				elapsed: elapsed(task),
				toolUses: task.toolUses,
				tokens: task.tokens,
				answer: task.status === "done" ? task.answer : (task.error ?? ""),
			});
		});
}

export function registerAgents(pi: ExtensionAPI, session: () => { owner: string; parent?: string }) {
	pi.registerTool({
		name: AGENT_TOOL,
		label: "agent",
		description:
			"Start a subagent: a fresh agent with its own context, in a working directory you choose, to do one self-contained task (research, a search across a codebase, an independent change). It runs in the background and this call returns at once; its final answer arrives as a message when it finishes. The agent sees only the prompt, so include everything it needs.",
		promptSnippet: "Start a background subagent with its own context",
		promptGuidelines: [
			"After starting an agent, tell the user in a sentence what it will do. Then go on with other work or end your turn; don't poll for it, its answer comes to you.",
			"Set allow_subagents only when the task is big enough to split again.",
			"Use agent_message to give an agent more instructions or a follow-up question, and task_log to read what it has said so far (also after it was stopped or interrupted).",
		],
		parameters: Type.Object({
			description: Type.String({ description: "What the agent does, in 3 to 6 words (shown to the user)" }),
			prompt: Type.String({ description: "The full task: goal, context, constraints, and what to report back" }),
			cwd: Type.Optional(Type.String({ description: "Working directory for the agent (default: yours)" })),
			allow_subagents: Type.Optional(
				Type.Boolean({ description: "Whether the agent may start subagents of its own (default false)" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = resolve(ctx.cwd, params.cwd ?? ".");
			if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Not a directory: ${cwd}`);
			const { owner, parent } = session();
			const task: AgentTask = {
				kind: "agent",
				id: nextId("agent"),
				owner,
				parent,
				status: "running",
				started: Date.now(),
				description: params.description,
				cwd,
				allowSubagents: params.allow_subagents ?? false,
				log: [],
				messages: [],
				toolUses: 0,
				tokens: 0,
			};
			registry.tasks.set(task.id, task);
			record(task, {
				event: "start",
				id: task.id,
				kind: "agent",
				parent,
				started: task.started,
				description: task.description,
				cwd,
				allowSubagents: task.allowSubagents,
			});
			logLine(task, "orchestrator", params.prompt);
			const thinking = pi.getThinkingLevel();
			launch(task, async () => {
				const live = await createLive(task, ctx, thinking);
				await run(task, live, `${preamble(cwd, task.allowSubagents)}\nYour task:\n\n${params.prompt}`);
			});
			return {
				content: [
					{
						type: "text",
						text: `Started agent ${task.id} in ${cwd}${task.allowSubagents ? " (may start subagents)" : ""}. It is still working, so its answer is not known yet. Tell the user what it will do, then do other work or end your turn: its final answer comes as a message.`,
					},
				],
				details: { id: task.id },
			};
		},
	});

	pi.registerTool({
		name: "agent_message",
		label: "agent message",
		description:
			"Send a message to a subagent you started: more instructions, a correction, or a follow-up question. A running agent reads it after its current step. A finished, stopped or interrupted agent carries on with its earlier context and answers again; its answer comes as a message, like the first one.",
		promptSnippet: "Send a message to a subagent",
		parameters: Type.Object({
			id: Type.String({ description: "Agent id, such as agent-1" }),
			message: Type.String({ description: "What to tell the agent" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const task = registry.tasks.get(params.id);
			if (!task || task.kind !== "agent") throw new Error(`No agent ${params.id}`);
			const live = task.live;
			if (live && task.status === "running") {
				logLine(task, "orchestrator", params.message);
				if (live.isStreaming) await live.steer(params.message);
				else void live.prompt(params.message);
				return {
					content: [{ type: "text", text: `Sent to ${task.id}; it reads it after its current step.` }],
					details: undefined,
				};
			}
			if (task.status === "running") throw new Error(`${task.id} is still starting; try again in a moment.`);
			// The answer goes to whoever asked.
			task.owner = session().owner;
			logLine(task, "orchestrator", params.message);
			const thinking = pi.getThinkingLevel();
			const revived = !live;
			launch(task, async () => {
				if (live) return run(task, live, params.message);
				const fresh = await createLive(task, ctx, thinking);
				await run(
					task,
					fresh,
					`${preamble(task.cwd, task.allowSubagents)}\nYou are picking up an earlier task after a restart. Your conversation with the orchestrator so far, with your tool calls and their results:\n\n${history({ ...task, log: task.log.slice(0, -1) })}\n\nIts new message:\n\n${params.message}`,
				);
			});
			return {
				content: [
					{
						type: "text",
						text: `${task.id} carries on with your message${revived ? " (in a new session, with its saved conversation as context)" : ""}. Its answer comes as a message.`,
					},
				],
				details: undefined,
			};
		},
	});
}
