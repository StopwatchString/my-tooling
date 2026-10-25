/**
 * Background shells: `bash` with `run_in_background`, and `bash_output` to
 * read what a background shell has printed since the last look. When a
 * background shell exits, the session that started it gets a message, which
 * starts a turn if it is idle.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { changed, elapsed, nextId, notify, record, recordEnd, registry, type ShellTask } from "./registry.ts";

// Output kept in memory per shell; the log file has all of it.
const MAX_OUTPUT = 1_000_000;
// What bash_output and the exit message return at most.
const MAX_REPORT = 30_000;
const TAIL_LINES = 40;
const TAIL_CHARS = 6_000;

export const SHELL_DONE = "task-shell-done";

function tail(text: string, lines: number, chars: number): string {
	const cut = text.slice(-chars);
	return cut.split("\n").slice(-lines).join("\n").trimEnd();
}

function startShell(command: string, cwd: string, owner: string, parent: string | undefined): ShellTask {
	const id = nextId("shell");
	const dir = join(tmpdir(), "pi-tasks");
	mkdirSync(dir, { recursive: true });
	const logPath = join(dir, `${process.pid}-${id}.log`);
	const log = createWriteStream(logPath);
	const proc = spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
	const task: ShellTask = {
		kind: "shell",
		id,
		owner,
		parent,
		status: "running",
		started: Date.now(),
		command,
		cwd,
		output: "",
		dropped: 0,
		reported: 0,
		logPath,
		proc,
	};
	const append = (chunk: Buffer) => {
		const text = chunk.toString();
		log.write(text);
		task.output += text;
		if (task.output.length > MAX_OUTPUT) {
			const cut = task.output.length - MAX_OUTPUT;
			task.output = task.output.slice(cut);
			task.dropped += cut;
		}
		changed();
	};
	proc.stdout?.on("data", append);
	proc.stderr?.on("data", append);
	let finished = false;
	const finish = (code: number | null, error?: Error) => {
		if (finished) return;
		finished = true;
		log.end();
		if (error) task.output += `\n${error.message}\n`;
		task.exitCode = code;
		task.proc = undefined;
		if (task.status === "running") {
			task.status = code === 0 ? "done" : "failed";
			task.ended = Date.now();
		}
		changed();
		recordEnd(task);
		if (task.quiet) return;
		const how = task.status === "stopped" ? "was stopped by the user" : `exited with code ${code ?? "?"}`;
		const last = tail(task.output, TAIL_LINES, TAIL_CHARS);
		notify(
			owner,
			SHELL_DONE,
			[
				`Background shell ${id} ${how} after ${elapsed(task)}.`,
				`Command: ${command}`,
				last ? `Last output:\n${last}` : "No output.",
				`Full output: ${logPath}`,
			].join("\n"),
			{ id, command, status: task.status, exitCode: code, elapsed: elapsed(task), tail: last },
		);
	};
	proc.on("close", (code) => finish(code));
	proc.on("error", (error) => finish(null, error));
	registry.tasks.set(id, task);
	record(task, { event: "start", id, kind: "shell", parent, started: task.started, command, cwd, logPath });
	changed();
	return task;
}

export function registerShells(pi: ExtensionAPI, session: () => { owner: string; parent?: string }) {
	const base = createBashToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		outputSchema: undefined,
		description: `${base.description} Set run_in_background for long-running commands (servers, watchers, long builds or tests): the call returns at once with a shell id, and you get a message with the exit code and the last output when the shell exits.`,
		parameters: Type.Object({
			...base.parameters.properties,
			run_in_background: Type.Optional(
				Type.Boolean({ description: "Run the command in the background and return its shell id at once." }),
			),
		}),
		promptGuidelines: [
			...(base.promptGuidelines ?? []),
			"Use bash with run_in_background for commands that run long or never exit. Don't poll or sleep waiting for it: end your turn, and you will be told when it exits. Use bash_output to look at its output meanwhile, task_stop to end it.",
		],
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { run_in_background, ...rest } = params;
			if (!run_in_background) {
				return createBashToolDefinition(ctx.cwd).execute(toolCallId, rest, signal, onUpdate, ctx);
			}
			const { owner, parent } = session();
			const task = startShell(rest.command, ctx.cwd, owner, parent);
			return {
				content: [
					{
						type: "text",
						text: `Started background shell ${task.id}. It is still running, so its output is not known yet. Do other work or end your turn: a message with its exit code and output comes when it exits. bash_output with id ${task.id} shows its output so far.`,
					},
				],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "bash_output",
		// Lets read-only mode (modes.ts) allow it; never sent to the model.
		annotations: { readOnlyHint: true },
		label: "bash output",
		description:
			"Output a background shell has printed since the last bash_output call for it, with its status and exit code.",
		promptSnippet: "Read new output from a background shell",
		parameters: Type.Object({ id: Type.String({ description: "Shell id, as returned by bash with run_in_background" }) }),
		async execute(_toolCallId, params) {
			const task = registry.tasks.get(params.id);
			if (!task || task.kind !== "shell") throw new Error(`No background shell ${params.id}`);
			const from = Math.max(task.reported - task.dropped, 0);
			let fresh = task.output.slice(from);
			task.reported = task.dropped + task.output.length;
			let note = "";
			if (fresh.length > MAX_REPORT) {
				fresh = fresh.slice(-MAX_REPORT);
				note = `\n[Earlier new output left out; full output: ${task.logPath}]`;
			}
			const state =
				task.status === "running"
					? `running for ${elapsed(task)}`
					: `${task.status}, exit code ${task.exitCode ?? "?"}, after ${elapsed(task)}`;
			return {
				content: [{ type: "text", text: `Shell ${task.id} (${state}).\n${fresh.trimEnd() || "(no new output)"}${note}` }],
				details: undefined,
			};
		},
	});
}
