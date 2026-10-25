/**
 * Background tasks in the style of Claude Code: shells that run in the
 * background and agents that work in their own context, both reporting back
 * when they finish, and a list of them below the prompt.
 *
 *   › ⏺ npm run dev · shell · 1m 2s
 *     ⏺ Find the auth code · Read(src/auth.ts) · agent · 12s · 4 tools
 *       ↑↓ select · enter view · x stop · esc back
 *
 * - Tool `bash` (replaces pi's): adds `run_in_background` (`shells.ts`).
 * - Tool `bash_output`: new output of a background shell (`shells.ts`).
 * - Tool `agent`: starts a subagent (`agents.ts`).
 * - Tool `agent_message`: more instructions for an agent (`agents.ts`).
 * - Tool `task_stop`: stops a background shell or agent.
 * - Tools `task_log`, `task_list`: a task's saved record (a shell's command
 *   and output, an agent's conversation), and the list of tasks.
 * - Command `/tasks`: pick any task, finished ones too, and open it.
 * - Message renderers for the "task finished" messages (`ui.ts`).
 * - Event `session_start`: registers this session to receive task messages
 *   and, at the top level, to record tasks; restores the tasks recorded in
 *   the session. In the TUI, shows the list below the prompt and takes ↓ in
 *   an empty prompt to move into it (enter opens a task, x stops it, esc
 *   goes back).
 * - Event `input`: hides finished tasks from the list once you send a prompt.
 * - Event `session_shutdown`: stops the session's tasks, recording them as
 *   interrupted, and ends its agents' sessions (not on /reload).
 *
 * Tasks live in a registry shared by every session in the process
 * (`registry.ts`), so subagents, which load this extension too, show up with
 * their own shells and agents nested under them.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { AGENT_DONE, registerAgents } from "./agents.ts";
import {
	changed,
	elapsed,
	formatLine,
	RECORD,
	type TaskRecord,
	recordEnd,
	registry,
	restore,
	root,
	stopTask,
	type Task,
	tree,
} from "./registry.ts";
import { registerShells, SHELL_DONE } from "./shells.ts";
import { label, type ListState, renderDone, TaskList, TaskView, visibleTasks } from "./ui.ts";

// Characters of output or conversation task_log returns at most.
const LOG_CHARS = 30_000;

/** A component drawn by a closure. */
const lines = (draw: (width: number) => string[]) => ({ render: draw, invalidate() {} });

export default function (pi: ExtensionAPI) {
	let owner = "";
	const session = () => ({ owner, parent: registry.sessions.get(owner) });
	let cleanup: (() => void)[] = [];

	registerShells(pi, session);
	registerAgents(pi, session);

	pi.registerTool({
		name: "task_stop",
		label: "stop task",
		description: "Stop a background shell or agent (and anything it started) by its id.",
		promptSnippet: "Stop a background shell or agent",
		parameters: Type.Object({ id: Type.String({ description: "Task id, such as shell-1 or agent-2" }) }),
		async execute(_toolCallId, params) {
			const task = registry.tasks.get(params.id);
			if (!task) throw new Error(`No task ${params.id}`);
			if (task.status !== "running") {
				return { content: [{ type: "text", text: `${task.id} already ended (${task.status}).` }], details: undefined };
			}
			task.quiet = true;
			await stopTask(task);
			return { content: [{ type: "text", text: `Stopped ${task.id}.` }], details: undefined };
		},
	});

	pi.registerTool({
		name: "task_log",
		// Lets read-only mode (modes.ts) allow it; never sent to the model.
		annotations: { readOnlyHint: true },
		label: "task log",
		description:
			"The record of a background shell or agent, also after it was stopped, or interrupted by a restart: a shell's command, status and output; an agent's conversation (your messages to it, its replies, and its tool calls with their results, shortened).",
		promptSnippet: "Read a background task's command and output, or an agent's conversation",
		parameters: Type.Object({ id: Type.String({ description: "Task id, such as shell-1 or agent-2" }) }),
		async execute(_toolCallId, params) {
			const task = registry.tasks.get(params.id);
			if (!task) throw new Error(`No task ${params.id}`);
			const head = `${task.id}: ${task.status}, ${elapsed(task)}, in ${task.cwd}`;
			let text: string;
			if (task.kind === "shell") {
				const output = task.output.slice(-LOG_CHARS).trimEnd();
				text = [
					head + (task.exitCode === undefined ? "" : `, exit code ${task.exitCode ?? "?"}`),
					`Command: ${task.command}`,
					output ? `Output${task.output.length > LOG_CHARS ? " (end)" : ""}:\n${output}` : "No output.",
					`Log file (may be gone after a restart): ${task.logPath}`,
				].join("\n");
			} else {
				const lines = task.log.map(formatLine).join("\n\n");
				text = [
					`${head}, ${task.toolUses} tool uses: "${task.description}"`,
					task.error ? `Error: ${task.error}` : "",
					lines.length > LOG_CHARS ? `[Earlier conversation left out]\n${lines.slice(-LOG_CHARS)}` : lines,
				]
					.filter(Boolean)
					.join("\n\n");
			}
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	pi.registerTool({
		name: "task_list",
		// Lets read-only mode (modes.ts) allow it; never sent to the model.
		annotations: { readOnlyHint: true },
		label: "task list",
		description: "List the background shells and agents of this session, with their ids and status.",
		promptSnippet: "List background shells and agents",
		parameters: Type.Object({}),
		async execute() {
			const rows = tree();
			const text = rows.length
				? rows.map(({ task, depth }) => `${"  ".repeat(depth)}${task.id} (${task.status}, ${elapsed(task)}): ${label(task)}`).join("\n")
				: "No background tasks.";
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	for (const [type, kind] of [
		[SHELL_DONE, "shell"],
		[AGENT_DONE, "agent"],
	] as const) {
		pi.registerMessageRenderer<Record<string, unknown>>(type, (message, options, theme) =>
			lines((width) => renderDone(kind, message.details, options.expanded, theme, width)),
		);
	}

	const open = (ctx: ExtensionContext, task: Task) =>
		ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) =>
				new TaskView(tui, theme, task, () => done(undefined), (t) => void stopTask(t)),
			{ overlay: true, overlayOptions: { width: "95%", maxHeight: "90%", anchor: "center" } },
		);

	pi.registerCommand("tasks", {
		description: "Background shells and agents: open one to see its output",
		handler: async (_args, ctx) => {
			const rows = tree();
			if (rows.length === 0) return ctx.ui.notify("No background tasks", "info");
			const names = rows.map(({ task, depth }) => `${"  ".repeat(depth)}${task.id} · ${task.status} · ${label(task)}`);
			const choice = await ctx.ui.select("Tasks", names);
			const row = choice === undefined ? undefined : rows[names.indexOf(choice)];
			if (row) await open(ctx, row.task);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		owner = ctx.sessionManager.getSessionId();
		// Subagents' tasks are recorded in the top-level session.
		if (!registry.sessions.has(owner)) {
			registry.recorders.set(owner, (data) => pi.appendEntry(RECORD, data));
			const records = ctx.sessionManager
				.getBranch()
				.flatMap((e) => (e.type === "custom" && e.customType === RECORD && e.data ? [e.data as TaskRecord] : []));
			restore(records, owner);
		}
		registry.notifiers.set(owner, (customType, content, details) =>
			pi.sendMessage({ customType, content, display: true, details }, { triggerTurn: true, deliverAs: "followUp" }),
		);
		for (const [customType, content, details] of registry.pending.get(owner) ?? []) {
			registry.notifiers.get(owner)!(customType, content, details);
		}
		registry.pending.delete(owner);
		if (ctx.mode !== "tui") return;

		const state: ListState = { focused: false, selected: 0 };
		let tui: TUI | undefined;
		let viewing = false;
		let queued = false;
		const render = () => {
			if (queued || !tui) return;
			queued = true;
			setTimeout(() => {
				queued = false;
				tui?.requestRender();
			}, 100);
		};
		registry.listeners.add(render);
		// Elapsed times move on while anything runs.
		const timer = setInterval(() => {
			if ([...registry.tasks.values()].some((t) => t.status === "running")) render();
		}, 1000);
		ctx.ui.setWidget(
			"tasks",
			(t, theme) => {
				tui = t;
				return new TaskList(theme, state);
			},
			{ placement: "belowEditor" },
		);

		const unsubscribe = ctx.ui.onTerminalInput((data) => {
			if (viewing) return undefined;
			const rows = visibleTasks();
			if (!state.focused) {
				if (!matchesKey(data, "down") || rows.length === 0 || ctx.ui.getEditorText() !== "") return undefined;
				state.focused = true;
				state.selected = 0;
			} else if (rows.length === 0 || matchesKey(data, "escape")) {
				state.focused = false;
			} else if (matchesKey(data, "up")) {
				if (state.selected === 0) state.focused = false;
				else state.selected--;
			} else if (matchesKey(data, "down")) {
				state.selected = Math.min(state.selected + 1, rows.length - 1);
			} else if (matchesKey(data, "enter")) {
				const task = rows[state.selected]?.task;
				if (task) {
					viewing = true;
					void open(ctx, task).finally(() => {
						viewing = false;
						render();
					});
				}
			} else if (data === "x" || matchesKey(data, "delete")) {
				const task = rows[state.selected]?.task;
				if (task) void stopTask(task);
			} else {
				// Anything else goes back to the prompt and is typed there.
				state.focused = false;
				render();
				return undefined;
			}
			render();
			return { consume: true };
		});

		cleanup = [
			unsubscribe,
			() => clearInterval(timer),
			() => registry.listeners.delete(render),
			() => ctx.ui.setWidget("tasks", undefined),
		];
	});

	pi.on("input", async () => {
		let any = false;
		for (const task of registry.tasks.values()) {
			if (task.status !== "running" && !task.dismissed) {
				task.dismissed = true;
				any = true;
			}
		}
		if (any) changed();
	});

	pi.on("session_shutdown", async (event) => {
		for (const fn of cleanup) fn();
		cleanup = [];
		if (event.reason === "reload") {
			registry.notifiers.delete(owner);
			return;
		}
		const top = !registry.sessions.has(owner);
		for (const task of [...registry.tasks.values()]) {
			const mine = top ? root(task).owner === owner : task.owner === owner;
			if (!mine) continue;
			if (task.status === "running") {
				task.quiet = true;
				await stopTask(task, "interrupted");
				recordEnd(task);
			}
			if (!top) continue;
			// The session ends: so do its agents' sessions, and its tasks leave the list.
			if (task.kind === "agent" && task.live) {
				task.live.dispose();
				task.live = undefined;
			}
			registry.tasks.delete(task.id);
		}
		registry.notifiers.delete(owner);
		registry.recorders.delete(owner);
		changed();
	});
}
