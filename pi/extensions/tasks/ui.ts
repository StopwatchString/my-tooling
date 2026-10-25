/**
 * The task list below the prompt, the full-screen task viewer, and how the
 * "task finished" messages look in the transcript.
 *
 * The viewer ends with the main footer's status line (`footer.ts`, through
 * `globalThis`), here for the task: its directory, and an agent's model and
 * context fill, under the context bar (`context-bar.ts`) if that is loaded.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { type AgentTask, elapsed, registry, type Status, type Task, tokens, tree } from "./registry.ts";

const DOT = "⏺";
const ELBOW = "  ⎿  ";
const INDENT = "     ";
// Rows of the list below the prompt before it scrolls.
const LIST_ROWS = 5;

// footer.ts's status line, if it is loaded.
type StatusLine = (
	info: { cwd: string; model?: { id: string; reasoning?: boolean }; thinking?: string; percent?: number | null },
	width: number,
	theme: Theme,
) => string;
type Bar = (percent: number | null | undefined, width: number, theme: Theme) => string;
const FOOTER = Symbol.for("my-tooling.footer");

type Content = { type: string; text?: string; name?: string; arguments?: Record<string, unknown> };

export function dot(status: Status, theme: Theme): string {
	if (status === "running") return theme.fg("accent", DOT);
	if (status === "done") return theme.fg("success", DOT);
	if (status === "failed") return theme.fg("error", DOT);
	if (status === "interrupted") return theme.fg("warning", DOT);
	return theme.fg("dim", DOT);
}

export function label(task: Task): string {
	return task.kind === "shell" ? task.command.split("\n")[0]! : task.description;
}

/** How full an agent's context is, while its session lives. */
function contextPercent(task: AgentTask): number | null | undefined {
	return task.live?.getContextUsage()?.percent;
}

/** `ctx 12%`, yellow from 70% and red from 90% as in the footer; "" if unknown. */
function contextText(task: Task, theme: Theme): string {
	const percent = task.kind === "agent" ? contextPercent(task) : undefined;
	if (percent == null) return "";
	const color = percent >= 90 ? "error" : percent >= 70 ? "warning" : "dim";
	return theme.fg("dim", " · ctx ") + theme.fg(color, `${Math.round(percent)}%`);
}

function meta(task: Task): string {
	if (task.kind === "shell") {
		const exit =
			task.status === "stopped" ? " · stopped" : task.status === "running" ? "" : ` · exit ${task.exitCode ?? "?"}`;
		return `shell · ${elapsed(task)}${exit}`;
	}
	const parts = [`agent · ${elapsed(task)}`, `${task.toolUses} tools`];
	if (task.tokens) parts.push(`↓ ${tokens(task.tokens)}`);
	return parts.join(" · ");
}

/** Shell output as plain lines: colours kept, `\r` redraws resolved, other escapes dropped. */
function cleanOutput(text: string): string[] {
	return text
		.replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, "")
		.replace(/\x1b\][^\x07]*\x07/g, "")
		.split("\n")
		.map((line) => (line.includes("\r") ? line.split("\r").filter(Boolean).at(-1) ?? "" : line))
		.map((line) => line.replace(/\t/g, "   "));
}

function dropLeadingBlank(lines: string[]): string[] {
	const first = lines.findIndex((line) => line.trim() !== "");
	return first <= 0 ? lines : lines.slice(first);
}

function wrap(text: string, width: number): string[] {
	return text ? wrapTextWithAnsi(text, Math.max(10, width)) : [""];
}

/** Lines under a bullet: `⎿` on the first, the rest indented to match. */
function hang(lines: string[], width: number, theme: Theme): string[] {
	return lines
		.flatMap((line) => wrap(line, width - INDENT.length))
		.map((line, i) => (i === 0 ? theme.fg("dim", ELBOW) : INDENT) + line);
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	return ((content ?? []) as Content[])
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n");
}

function callText(c: Content, cwd: string): string {
	const args = c.arguments ?? {};
	const main = args.command ?? args.path ?? args.pattern ?? args.description ?? args.query ?? args.id;
	let text = typeof main === "string" ? main.split("\n")[0]! : Object.keys(args).length ? JSON.stringify(args) : "";
	if (text.startsWith(`${cwd}/`)) text = text.slice(cwd.length + 1);
	const name = c.name ?? "tool";
	return `${name.charAt(0).toUpperCase()}${name.slice(1)}(${text})`;
}

/** An agent's transcript, in the transcript's own style. */
function transcript(task: AgentTask, width: number, theme: Theme): string[] {
	const out: string[] = [];
	// Restored after a restart: only the saved conversation is left.
	if (task.messages.length === 0 && !task.live) {
		for (const line of task.log.slice(1)) {
			if (line.tool) {
				out.push("", truncateToWidth(`${theme.fg("dim", DOT)} ${theme.bold(`${line.tool.name}(${line.tool.args})`)}`, width, "…"));
				const lines = line.text.split("\n");
				const shown = lines.slice(0, 3).map((l) => theme.fg(line.tool!.isError ? "error" : "toolOutput", l));
				if (lines.length > 3) shown.push(theme.fg("dim", `… +${lines.length - 3} lines`));
				out.push(...hang(shown, width, theme));
				continue;
			}
			out.push("");
			const text = line.from === "orchestrator" ? `> ${line.text}` : line.text;
			dropLeadingBlank(wrap(text, width - 2)).forEach((l, i) =>
				out.push(line.from === "orchestrator" ? theme.fg("muted", l) : `${i === 0 ? `${theme.fg("text", DOT)} ` : "  "}${l}`),
			);
		}
		return out;
	}
	const messages: AgentMessage[] = [...task.messages, ...(task.streaming ? [task.streaming] : [])];
	let first = true;
	for (const message of messages) {
		if (message.role === "user") {
			// The first one is the task, shown in the header.
			if (!first) for (const line of wrap(`> ${textOf(message.content)}`, width)) out.push(theme.fg("muted", line));
			first = false;
		} else if (message.role === "assistant") {
			for (const c of message.content as Content[]) {
				if (c.type === "text" && c.text?.trim()) {
					out.push("");
					dropLeadingBlank(wrap(c.text.trim(), width - 2)).forEach((line, i) => out.push(`${i === 0 ? `${theme.fg("text", DOT)} ` : "  "}${line}`));
				} else if (c.type === "toolCall") {
					out.push("");
					out.push(truncateToWidth(`${theme.fg("dim", DOT)} ${theme.bold(callText(c, task.cwd))}`, width, "…"));
				}
			}
		} else if (message.role === "toolResult") {
			const lines = textOf(message.content).trim().split("\n");
			const shown = lines.slice(0, 3).map((l) => theme.fg(message.isError ? "error" : "toolOutput", l));
			if (lines.length > 3) shown.push(theme.fg("dim", `… +${lines.length - 3} lines`));
			out.push(...hang(shown, width, theme));
		} else if (message.role === "custom") {
			out.push("");
			wrap(textOf(message.content).split("\n")[0] ?? "", width - 2).forEach((line, i) =>
				out.push(theme.fg("muted", `${i === 0 ? `${DOT} ` : "  "}${line}`)),
			);
		}
	}
	return out;
}

/** Full-screen view of one task: what it runs, then its live output. */
export class TaskView implements Component {
	private top = 0;
	private follow = true;
	private bodyHeight = 10;
	private timer: ReturnType<typeof setInterval>;
	private readonly listener = () => this.tui.requestRender();

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly task: Task,
		private readonly close: () => void,
		private readonly stop: (task: Task) => void,
	) {
		registry.listeners.add(this.listener);
		this.timer = setInterval(this.listener, 1000);
	}

	dispose(): void {
		registry.listeners.delete(this.listener);
		clearInterval(this.timer);
	}

	invalidate(): void {}

	private header(inner: number): string[] {
		const t = this.theme;
		const task = this.task;
		const status = `${dot(task.status, t)} ${task.status} · ${meta(task)}${contextText(task, t)}`;
		if (task.kind === "shell") {
			return [
				...wrap(t.bold(`$ ${task.command}`), inner).slice(0, 6),
				t.fg("dim", `${task.cwd} · `) + status,
				t.fg("dim", `log: ${task.logPath}`),
			];
		}
		const prompt = wrap(task.log[0]?.text ?? "", inner);
		return [
			t.bold(`${task.id} · ${task.description}`),
			t.fg("dim", `${task.cwd} · `) + status + (task.allowSubagents ? t.fg("dim", " · may start subagents") : ""),
			...prompt.slice(0, 4).map((l) => t.fg("muted", l)),
			...(prompt.length > 4 ? [t.fg("dim", `… +${prompt.length - 4} lines of prompt`)] : []),
		];
	}

	private body(inner: number): string[] {
		const task = this.task;
		if (task.kind === "agent") {
			const lines = transcript(task, inner, this.theme);
			if (task.status === "running" && task.activity) lines.push("", this.theme.fg("dim", `… ${task.activity}`));
			if (task.answer && task.status === "done") lines.push("", this.theme.fg("success", "Finished."));
			if (task.error) lines.push("", ...wrap(this.theme.fg("error", task.error), inner));
			return lines;
		}
		const lines = cleanOutput(task.output).flatMap((line) => wrap(line, inner));
		if (lines.at(-1) === "") lines.pop();
		if (task.dropped) lines.unshift(this.theme.fg("dim", `[${task.dropped} earlier characters in the log file]`));
		return lines.length ? lines : [this.theme.fg("dim", "(no output yet)")];
	}

	/** The footer's lines for this task: the context bar if loaded, then the status line. */
	private status(width: number): string[] {
		const footer = (globalThis as Record<symbol, { line?: StatusLine; bar?: Bar } | undefined>)[FOOTER];
		if (!footer?.line) return [];
		const task = this.task;
		const live = task.kind === "agent" ? task.live : undefined;
		const percent = live?.getContextUsage()?.percent;
		return [
			...(footer.bar && live ? [footer.bar(percent, width, this.theme)] : []),
			footer.line({ cwd: task.cwd, model: live?.model, thinking: live?.thinkingLevel, percent }, width, this.theme),
		];
	}

	render(width: number): string[] {
		const t = this.theme;
		const inner = Math.max(20, width - 2);
		const rule = (title = "") => t.fg("borderMuted", `──${title ? t.bold(title) : ""}${"─".repeat(Math.max(0, width - visibleWidth(title) - 2))}`);
		const row = (s: string) => ` ${truncateToWidth(s, inner, "…", true)}`;
		const title = ` ${this.task.kind === "shell" ? `Shell ${this.task.id}` : `Agent ${this.task.id}`} `;
		const head = this.header(inner);
		const status = this.status(width);
		// The whole screen: title, header, rule, body, rule, hint, status line.
		const height = Math.max(12, this.tui.terminal.rows);
		this.bodyHeight = Math.max(3, height - head.length - 4 - status.length);
		const body = this.body(inner);
		const maxTop = Math.max(0, body.length - this.bodyHeight);
		if (this.follow) this.top = maxTop;
		this.top = Math.min(Math.max(0, this.top), maxTop);
		const visible = body.slice(this.top, this.top + this.bodyHeight);
		while (visible.length < this.bodyHeight) visible.push("");
		const position = body.length > this.bodyHeight ? ` · ${this.top + 1}-${this.top + this.bodyHeight} of ${body.length}` : "";
		const hint = `↑↓ PgUp PgDn scroll · g/G top/bottom${this.task.status === "running" ? " · x stop" : ""} · esc close`;
		return [
			rule(title),
			...head.map(row),
			rule(),
			...visible.map(row),
			rule(),
			row(t.fg("dim", hint + position)),
			...status,
		];
	}

	handleInput(data: string): void {
		const page = Math.max(1, this.bodyHeight - 1);
		const scroll = (by: number) => {
			this.follow = false;
			this.top += by;
		};
		if (matchesKey(data, "escape") || data === "q") return this.close();
		if (matchesKey(data, "up") || data === "k") scroll(-1);
		else if (matchesKey(data, "down") || data === "j") scroll(1);
		else if (matchesKey(data, "pageUp")) scroll(-page);
		else if (matchesKey(data, "pageDown") || data === " ") scroll(page);
		else if (matchesKey(data, "home") || data === "g") {
			this.follow = false;
			this.top = 0;
		} else if (matchesKey(data, "end") || data === "G") this.follow = true;
		else if (data === "x" && this.task.status === "running") this.stop(this.task);
		else return;
		// Scrolling back to the end follows the output again.
		if (!this.follow) {
			const body = this.body(Math.max(20, this.tui.terminal.columns - 2));
			if (this.top >= body.length - this.bodyHeight) this.follow = true;
		}
		this.tui.requestRender();
	}
}

/** Selection state of the list below the prompt. */
export interface ListState {
	focused: boolean;
	selected: number;
}

export function visibleTasks(): { task: Task; depth: number }[] {
	return tree((task) => !task.dismissed);
}

/** The list below the prompt: one row per task, children under their agent. */
export class TaskList implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly state: ListState,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.theme;
		const rows = visibleTasks();
		if (rows.length === 0) {
			this.state.focused = false;
			return [];
		}
		this.state.selected = Math.min(this.state.selected, rows.length - 1);
		const sel = this.state.selected;
		const start = Math.min(Math.max(0, sel - LIST_ROWS + 1), Math.max(0, rows.length - LIST_ROWS));
		const shown = rows.slice(start, start + LIST_ROWS);
		const out = shown.map(({ task, depth }, i) => {
			const selected = this.state.focused && start + i === sel;
			const pointer = selected ? t.fg("accent", "›") : " ";
			const activity = task.kind === "agent" && task.status === "running" && task.activity ? ` · ${task.activity}` : "";
			const text = `${pointer} ${"  ".repeat(depth)}${dot(task.status, t)} ${label(task)}${t.fg("dim", `${activity} · ${meta(task)}`)}${contextText(task, t)}`;
			const line = truncateToWidth(text, width, "…", selected);
			return selected ? t.bg("selectedBg", line) : line;
		});
		const more = rows.length - shown.length;
		const hint = this.state.focused
			? `↑↓ select · enter view · x stop · esc back${more ? ` · ${rows.length} tasks` : ""}`
			: `${more ? `+${more} more · ` : ""}↓ to manage`;
		out.push(t.fg("dim", `  ${hint}`));
		return out;
	}
}

/** Transcript line for a "task finished" message, with its answer or output under it. */
export function renderDone(
	kind: "shell" | "agent",
	details: Record<string, unknown> | undefined,
	expanded: boolean,
	theme: Theme,
	width: number,
): string[] {
	if (!details) return [];
	const status = details.status as Status;
	const bullet = dot(status, theme);
	let head: string;
	let body: string;
	if (kind === "shell") {
		const how = status === "stopped" ? "was stopped by the user" : `exited with code ${details.exitCode ?? "?"}`;
		head = `Shell ${details.id} ${how} ${theme.fg("dim", `· ${details.elapsed}`)}`;
		body = [`$ ${details.command}`, String(details.tail ?? "")].filter(Boolean).join("\n");
	} else {
		const how = status === "done" ? "finished" : status === "stopped" ? "was stopped" : "failed";
		const stats = `· ${details.elapsed} · ${details.toolUses} tool uses · ↓ ${tokens(Number(details.tokens) || 0)} tokens`;
		head = `Agent "${details.description}" ${how} ${theme.fg("dim", stats)}`;
		body = String(details.answer ?? "");
	}
	const lines = body.split("\n").map((l) => theme.fg(status === "failed" ? "error" : "toolOutput", l));
	const wrapped = lines.flatMap((l) => wrap(l, width - INDENT.length));
	const shown = expanded ? wrapped : wrapped.slice(0, 3);
	if (wrapped.length > shown.length) {
		shown.push(theme.fg("dim", `… +${wrapped.length - shown.length} lines (${keyText("app.tools.expand")} to expand)`));
	}
	return [truncateToWidth(`${bullet} ${head}`, width, "…"), ...shown.map((l, i) => (i === 0 ? theme.fg("dim", ELBOW) : INDENT) + l)];
}
