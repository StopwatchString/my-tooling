/**
 * Background tasks (shells and agents), shared by every pi session in the
 * process: the interactive session and the subagents it spawns, which load
 * this extension too. Kept on globalThis so /reload and the subagents' own
 * copies of these modules all see the same tasks.
 *
 * Tasks are also recorded in the top-level session as hidden `task` entries
 * (never sent to the model), so they survive a restart: a shell's command
 * and the end of its output, an agent's conversation with its orchestrator
 * (what it was told and what it answered, no thinking or tool calls).
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ChildProcess } from "node:child_process";

/** "interrupted": pi quit while it ran, or it was restored from the session file. */
export type Status = "running" | "done" | "failed" | "stopped" | "interrupted";

interface Base {
	id: string;
	/** Session that is told when the task ends. */
	owner: string;
	/** Agent task whose session started this one, if any. */
	parent?: string;
	status: Status;
	started: number;
	ended?: number;
	/** Hidden from the list below the prompt (still in /tasks). */
	dismissed?: boolean;
	/** Stopped by its owner's own tool call, so the owner needs no message. */
	quiet?: boolean;
	/** Its end is recorded (until an agent is continued). */
	saved?: boolean;
}

export interface ShellTask extends Base {
	kind: "shell";
	command: string;
	cwd: string;
	output: string;
	/** Characters of `output` dropped from its start to keep it bounded. */
	dropped: number;
	/** Position (counting dropped characters) up to which bash_output has reported. */
	reported: number;
	logPath: string;
	exitCode?: number | null;
	proc?: ChildProcess;
}

export interface LogLine {
	/** "tool": one of the agent's tool calls; `text` is its result. */
	from: "orchestrator" | "agent" | "tool";
	text: string;
	at: number;
	tool?: ToolLine;
}

export interface ToolLine {
	name: string;
	/** Arguments as JSON, cut short. */
	args: string;
	isError: boolean;
}

export interface AgentTask extends Base {
	kind: "agent";
	description: string;
	cwd: string;
	allowSubagents: boolean;
	/** The orchestrator's messages, the agent's replies and its tool calls: what gets saved. */
	log: LogLine[];
	/** The agent's own session id, once it exists. */
	session?: string;
	/** Its full transcript while its session lives (not saved). */
	messages: AgentMessage[];
	/** The message being streamed, not yet in `messages`. */
	streaming?: AgentMessage;
	toolUses: number;
	tokens: number;
	/** Latest tool call, as `Name(args)`. */
	activity?: string;
	answer?: string;
	error?: string;
	/** The agent's session, kept after it finishes so it can be messaged again. */
	live?: AgentSession;
	stop?: () => Promise<void>;
}

export type Task = ShellTask | AgentTask;

/** A `task` entry in the session file. */
export type TaskRecord =
	| { event: "start"; id: string; kind: "shell"; parent?: string; started: number; command: string; cwd: string; logPath: string }
	| {
			event: "start";
			id: string;
			kind: "agent";
			parent?: string;
			started: number;
			description: string;
			cwd: string;
			allowSubagents: boolean;
	  }
	| { event: "message"; id: string; from: LogLine["from"]; text: string; at: number; tool?: ToolLine }
	| {
			event: "end";
			id: string;
			status: Status;
			ended: number;
			exitCode?: number | null;
			output?: string;
			toolUses?: number;
			tokens?: number;
			error?: string;
	  };

export const RECORD = "task";

/** Sends a message into a session, starting a turn if it is idle. */
export type Notifier = (customType: string, content: string, details: unknown) => void;

interface Registry {
	tasks: Map<string, Task>;
	counters: { shell: number; agent: number };
	listeners: Set<() => void>;
	notifiers: Map<string, Notifier>;
	/** Top-level sessions' appendEntry, by session id. */
	recorders: Map<string, (record: TaskRecord) => void>;
	/** Agent session id -> its agent task id. */
	sessions: Map<string, string>;
	/** Messages for sessions without a notifier at the time (mid-reload). */
	pending: Map<string, [string, string, unknown][]>;
}

const KEY = Symbol.for("my-tooling.tasks.registry");
const store = globalThis as typeof globalThis & { [KEY]?: Registry };

export const registry: Registry = (store[KEY] ??= {
	tasks: new Map(),
	counters: { shell: 0, agent: 0 },
	listeners: new Set(),
	notifiers: new Map(),
	recorders: new Map(),
	sessions: new Map(),
	pending: new Map(),
});
registry.recorders ??= new Map();

export function nextId(kind: "shell" | "agent"): string {
	return `${kind}-${++registry.counters[kind]}`;
}

export function changed(): void {
	for (const listener of registry.listeners) listener();
}

export function notify(owner: string, customType: string, content: string, details: unknown): void {
	const notifier = registry.notifiers.get(owner);
	if (notifier) notifier(customType, content, details);
	else registry.pending.set(owner, [...(registry.pending.get(owner) ?? []), [customType, content, details]]);
}

/** The top-level task a task belongs to (itself if it has no parent). */
export function root(task: Task): Task {
	let t = task;
	while (t.parent) {
		const parent = registry.tasks.get(t.parent);
		if (!parent) break;
		t = parent;
	}
	return t;
}

/** Save a record in the top-level session the task belongs to. */
export function record(task: Task, data: TaskRecord): void {
	try {
		registry.recorders.get(root(task).owner)?.(data);
	} catch {
		// The session is gone (quit mid-write); the task still works.
	}
}

/** Record how a task ended: once, with what is worth keeping. */
export function recordEnd(task: Task): void {
	if (task.saved) return;
	task.saved = true;
	const end: Extract<TaskRecord, { event: "end" }> = { event: "end", id: task.id, status: task.status, ended: task.ended ?? Date.now() };
	if (task.kind === "shell") {
		end.exitCode = task.exitCode;
		end.output = task.output.slice(-SAVED_OUTPUT);
	} else {
		end.toolUses = task.toolUses;
		end.tokens = task.tokens;
		if (task.error) end.error = task.error;
	}
	record(task, end);
}

// Characters of a shell's output saved in the session when it ends.
export const SAVED_OUTPUT = 20_000;
// Characters saved per agent tool call: its arguments, and its result.
export const SAVED_ARGS = 2_000;
export const SAVED_RESULT = 4_000;

/** Text cut to `max` characters, keeping its start and end. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	return `${text.slice(0, half)}\n[… ${text.length - max} characters left out …]\n${text.slice(-half)}`;
}

/** One log line as plain text, for the model (task_log, a restarted agent). */
export function formatLine(line: LogLine): string {
	if (line.tool) {
		return `[tool call] ${line.tool.name}(${line.tool.args})\n[${line.tool.isError ? "error" : "result"}]\n${line.text}`;
	}
	return `[${line.from}]\n${line.text}`;
}

/** Add a line to an agent's conversation and save it. */
export function logLine(task: AgentTask, from: LogLine["from"], text: string, tool?: ToolLine): void {
	const line: LogLine = { from, text, at: Date.now(), ...(tool ? { tool } : {}) };
	task.log.push(line);
	record(task, { event: "message", id: task.id, ...line });
}

/** Tasks still running that the session started. */
export function runningOwnedBy(session: string): Task[] {
	return [...registry.tasks.values()].filter((t) => t.owner === session && t.status === "running");
}

/** Tasks in display order: each parent followed by its children. */
export function tree(filter: (task: Task) => boolean = () => true): { task: Task; depth: number }[] {
	const all = [...registry.tasks.values()];
	const out: { task: Task; depth: number }[] = [];
	const walk = (parent: string | undefined, depth: number) => {
		for (const task of all) {
			if (task.parent !== parent) continue;
			if (filter(task)) out.push({ task, depth });
			walk(task.id, depth + 1);
		}
	};
	walk(undefined, 0);
	// Tasks whose parent is gone (restored without it) still show.
	for (const task of all) {
		if (task.parent && !registry.tasks.has(task.parent) && filter(task)) out.push({ task, depth: 0 });
	}
	return out;
}

export function elapsed(task: Task): string {
	const s = Math.floor(((task.ended ?? Date.now()) - task.started) / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function tokens(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

/** Stop a task and everything it started; `as` is the status it ends with. */
export async function stopTask(task: Task, as: Status = "stopped"): Promise<void> {
	for (const child of registry.tasks.values()) {
		if (child.parent === task.id && child.status === "running") {
			child.quiet ||= task.quiet;
			await stopTask(child, as);
		}
	}
	if (task.status !== "running") return;
	task.status = as;
	task.ended = Date.now();
	if (task.kind === "shell") {
		const pid = task.proc?.pid;
		if (pid) {
			try {
				process.kill(-pid, "SIGTERM");
			} catch {
				task.proc?.kill("SIGTERM");
			}
		}
	} else {
		await task.stop?.();
	}
	changed();
}

/** Restore the tasks recorded in a session, those not already known. */
export function restore(records: TaskRecord[], owner: string): void {
	const restored = new Map<string, Task>();
	for (const r of records) {
		if (registry.tasks.has(r.id) && !restored.has(r.id)) continue;
		if (r.event === "start") {
			const base = { id: r.id, owner, parent: r.parent, status: "running" as Status, started: r.started, dismissed: true };
			restored.set(
				r.id,
				r.kind === "shell"
					? { ...base, kind: "shell", command: r.command, cwd: r.cwd, logPath: r.logPath, output: "", dropped: 0, reported: 0 }
					: { ...base, kind: "agent", description: r.description, cwd: r.cwd, allowSubagents: r.allowSubagents, log: [], messages: [], toolUses: 0, tokens: 0 },
			);
		}
		const task = restored.get(r.id);
		if (!task) continue;
		if (r.event === "message" && task.kind === "agent") {
			task.log.push({ from: r.from, text: r.text, at: r.at, ...(r.tool ? { tool: r.tool } : {}) });
			// A message after it ended continued it.
			if (r.from === "orchestrator" && task.status !== "running") {
				task.status = "running";
				task.ended = undefined;
			}
			if (r.from === "agent") task.answer = r.text;
		} else if (r.event === "end") {
			task.status = r.status;
			task.ended = r.ended;
			if (task.kind === "shell") {
				task.exitCode = r.exitCode;
				task.output = r.output ?? "";
			} else {
				task.toolUses = r.toolUses ?? task.toolUses;
				task.tokens = r.tokens ?? task.tokens;
				task.error = r.error;
			}
		}
	}
	for (const task of restored.values()) {
		if (task.status === "running") task.status = "interrupted";
		registry.tasks.set(task.id, task);
		const n = Number(/-(\d+)$/.exec(task.id)?.[1] ?? 0);
		if (n > registry.counters[task.kind]) registry.counters[task.kind] = n;
	}
	if (restored.size) changed();
}
