/**
 * Tool calls in the style of Claude Code's transcript: one bullet line per
 * call with a short result hanging under it, no panel.
 *
 *   ⏺ Bash(git status --short)
 *     ⎿   M AGENTS.md
 *         M layer.sh
 *        … +8 lines (ctrl+o to expand)
 *
 *   ⏺ Update(pi/README.md)
 *     ⎿  Updated pi/README.md with 3 additions and 1 removal
 *         44  | `theme` | ...
 *
 *   ⏺ Read 3 files (ctrl+o to expand)
 *
 * The bullet blinks while the call runs, then turns green, or red on an error.
 * Read, grep, find and ls only summarise their result ("Read 125 lines"); a
 * run of two or more of them with no text in between folds into one line
 * ("Searched for 1 pattern, read 2 files"). Expanding (pi's expand key, or a
 * click on the row) shows every call and its full output. MCP tools read
 * `server - tool (MCP)(args)`.
 *
 * - `registerToolRenderer`: draws every tool, built-in, MCP or extension.
 * - Events `session_start`, `session_tree`, `session_compact`,
 *   `message_start`, `message_update`, `message_end`: track the order of
 *   tool calls and text, to find the runs to fold.
 * - Events `agent_start`, `agent_settled`: blink only while pi works.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath, highlightCode, keyText, renderDiff } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";

const DOT = "⏺";
const ELBOW = "  ⎿  ";
const INDENT = "     ";
const BLINK_MS = 500;
// Collapsed output: lines shown for bash and other tools, and for a new file.
const PREVIEW_LINES = 3;
const WRITE_PREVIEW_LINES = 10;

type Kind = "read" | "search" | "list";
const KINDS: Record<string, Kind> = { read: "read", grep: "search", find: "search", ls: "list" };
const TITLES: Record<string, string> = {
	bash: "Bash",
	powershell: "PowerShell",
	read: "Read",
	write: "Write",
	edit: "Update",
	grep: "Search",
	find: "Search",
	ls: "List",
	agent: "Agent",
	bash_output: "BashOutput",
	task_stop: "Stop",
	agent_message: "SendMessage",
	task_log: "TaskLog",
	task_list: "Tasks",
};

type Args = Record<string, unknown>;
type Result = { content: { type: string; text?: string; mimeType?: string }[]; details?: unknown };
type Content = { type: string; text?: string; id?: string; name?: string };
type Status = "running" | "done" | "error";
type Row = { timer?: ReturnType<typeof setInterval> };
// pi exports the renderers' type but not their context's.
type ToolRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

/** A component drawn by a closure, so a row can swap what it draws. */
class Lines implements Component {
	draw: (width: number) => string[] = () => [];
	render(width: number): string[] {
		return this.draw(width);
	}
	invalidate(): void {}
}

const lines = (context: ToolRenderContext, draw: (width: number) => string[]) => {
	const component = context.lastComponent instanceof Lines ? context.lastComponent : new Lines();
	component.draw = draw;
	return component;
};

const expandKey = () => keyText("app.tools.expand");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const str = (value: unknown) => (typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value));

function shortPath(path: unknown, cwd: string): string {
	const p = str(path);
	if (!p) return "";
	if (isAbsolute(p)) {
		const rel = relative(cwd, p);
		if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
		const home = homedir();
		if (p === home || p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
	}
	return p;
}

function resultText(result: Result | undefined): string {
	return (result?.content ?? [])
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n")
		.trim();
}

/** Output without pi's trailing `[...]` notices (limits, "Use offset=..."). */
function withoutNotices(text: string): string {
	let out = text;
	for (;;) {
		const next = out.replace(/\n*\[[^\n]*\]$/, "");
		if (next === out) return out;
		out = next;
	}
}

function countLines(text: string): number {
	return text ? text.split("\n").length : 0;
}

/**
 * Body lines under the call: the first after `⎿`, the rest indented to
 * match, wrapped to the width. With `max`, only that many visual lines and a
 * "+N lines" hint; `keepEnd` keeps the last ones instead (streaming output).
 */
function body(text: string[], width: number, theme: Theme, max?: number, keepEnd = false): string[] {
	const inner = Math.max(10, width - INDENT.length);
	let wrapped = text.flatMap((line) => (line ? wrapTextWithAnsi(line, inner) : [""]));
	let hint: string | undefined;
	if (max !== undefined && wrapped.length > max) {
		const hidden = wrapped.length - max;
		wrapped = keepEnd ? wrapped.slice(-max) : wrapped.slice(0, max);
		hint = theme.fg("dim", `… +${plural(hidden, "line")} (${expandKey()} to expand)`);
	}
	const out = keepEnd && hint ? [hint, ...wrapped] : hint ? [...wrapped, hint] : wrapped;
	return out.map((line, i) => (i === 0 ? theme.fg("dim", ELBOW) : INDENT) + line);
}

/** The bullet, blinking while the call runs. */
function dot(status: Status, theme: Theme, busy: boolean): string {
	if (status === "error") return theme.fg("error", DOT);
	if (status === "done") return theme.fg("success", DOT);
	if (busy && Math.floor(Date.now() / BLINK_MS) % 2 === 1) return " ";
	return theme.fg("dim", DOT);
}

/** The call line: bullet, bold title, arguments; wrapped when expanded, else cut. */
function header(bullet: string, title: string, args: string, width: number, expanded: boolean, theme: Theme): string[] {
	const text = `${bullet} ${theme.bold(theme.fg("toolTitle", title))}${args ? `(${args})` : ""}`;
	if (!expanded) return [truncateToWidth(text, width, "…")];
	return wrapTextWithAnsi(text, Math.max(10, width - 2)).map((line, i) => (i === 0 ? line : `  ${line}`));
}

function mcpLabel(pi: ExtensionAPI, toolName: string): string | undefined {
	const match = /^mcp__(.+?)__(.+)$/.exec(toolName);
	if (!match) return undefined;
	const info = pi.getAllTools().find((t) => t.name === toolName);
	const server = info?.namespace?.aliases?.[0] ?? match[1];
	return `${server} - ${match[2]} (MCP)`;
}

/** Arguments as `key: value`, each value cut short unless expanded. */
function pairs(args: Args, expanded: boolean): string {
	return Object.entries(args ?? {})
		.map(([key, value]) => {
			const v = JSON.stringify(value) ?? "";
			return `${key}: ${expanded || v.length <= 80 ? v : `${v.slice(0, 79)}…`}`;
		})
		.join(", ");
}

function callArgs(toolName: string, args: Args, cwd: string, expanded: boolean): string {
	switch (toolName) {
		case "bash":
		case "powershell": {
			const command = str(args.command).trim();
			const [first = "", ...rest] = command.split("\n");
			return expanded || rest.length === 0 ? command : `${first} …`;
		}
		case "read":
		case "write":
		case "edit":
			return shortPath(args.path ?? args.file_path, cwd);
		case "ls":
			return shortPath(args.path, cwd) || ".";
		case "agent":
			return str(args.description);
		case "bash_output":
		case "task_stop":
		case "task_log":
			return str(args.id);
		case "agent_message":
			return `${str(args.id)}: ${JSON.stringify(str(args.message))}`;
		case "task_list":
			return "";
		case "grep":
		case "find": {
			const parts = [`pattern: ${JSON.stringify(str(args.pattern))}`];
			if (args.path) parts.push(`path: ${JSON.stringify(shortPath(args.path, cwd))}`);
			if (args.glob) parts.push(`glob: ${JSON.stringify(str(args.glob))}`);
			return parts.join(", ");
		}
		default:
			return pairs(args, expanded);
	}
}

/** What the result says, per tool. */
function resultLines(toolName: string, result: Result, context: ToolRenderContext, theme: Theme, width: number): string[] {
	const { expanded, isPartial, isError, cwd } = context;
	const args = (context.args ?? {}) as Args;
	const output = resultText(result);
	const plain = (text: string, color: "toolOutput" | "error" | "dim" = "toolOutput") =>
		text.split("\n").map((line) => theme.fg(color, line.replace(/\t/g, "   ")));

	if (isError) {
		// Shells end with "Command exited with code N"; Claude Code leads with it.
		const exit = /\n*Command exited with code (\d+)$/.exec(output);
		const rest = (exit ? output.slice(0, exit.index) : output).replace(/\n{3,}/g, "\n\n");
		const text = exit ? `Error: Exit code ${exit[1]}${rest ? `\n${rest}` : ""}` : output || "Error";
		return body(plain(text, "error"), width, theme, expanded ? undefined : PREVIEW_LINES);
	}
	if (isPartial) return output ? body(plain(output, "dim"), width, theme, expanded ? undefined : PREVIEW_LINES, true) : [];

	const summary = (text: string, full?: string) =>
		expanded && full ? body([text, ...plain(full)], width, theme) : body([text], width, theme);
	const bold = (n: number) => theme.bold(`${n}`);

	switch (toolName) {
		case "read": {
			if (result.content.some((c) => c.type === "image")) return summary("Read image");
			const text = withoutNotices(output);
			return summary(`Read ${bold(countLines(text))} ${countLines(text) === 1 ? "line" : "lines"}`, text);
		}
		case "grep": {
			const text = withoutNotices(output);
			if (!text || text === "No matches found") return summary("No matches");
			const n = countLines(text);
			return summary(`Found ${bold(n)} ${n === 1 ? "line" : "lines"}`, text);
		}
		case "find": {
			const text = withoutNotices(output);
			if (!text || text.startsWith("No files found")) return summary("No files found");
			const n = countLines(text);
			return summary(`Found ${bold(n)} ${n === 1 ? "file" : "files"}`, text);
		}
		case "ls": {
			const text = withoutNotices(output);
			const n = text === "(empty directory)" ? 0 : countLines(text);
			return summary(`Listed ${bold(n)} ${n === 1 ? "path" : "paths"}`, text);
		}
		case "write": {
			const path = shortPath(args.path ?? args.file_path, cwd);
			const content = str(args.content).replace(/\n$/, "");
			const total = countLines(content);
			const lang = getLanguageFromPath(str(args.path ?? args.file_path));
			const code = content ? highlightCode(content, lang) : [];
			const shown = expanded ? code : code.slice(0, WRITE_PREVIEW_LINES);
			const pad = `${shown.length}`.length;
			const numbered = shown.map((line, i) => `${theme.fg("dim", `${i + 1}`.padStart(pad))} ${line}`);
			const rest = total - shown.length;
			if (rest > 0) numbered.push(theme.fg("dim", `… +${plural(rest, "line")} (${expandKey()} to expand)`));
			return body([`Wrote ${bold(total)} ${total === 1 ? "line" : "lines"} to ${theme.bold(path)}`, ...numbered], width, theme);
		}
		case "edit": {
			const path = shortPath(args.path ?? args.file_path, cwd);
			const diff = (result.details as { diff?: string } | undefined)?.diff ?? "";
			const diffLines = diff ? diff.split("\n") : [];
			const added = diffLines.filter((l) => l.startsWith("+")).length;
			const removed = diffLines.filter((l) => l.startsWith("-")).length;
			const counts = [
				added ? `${bold(added)} ${added === 1 ? "addition" : "additions"}` : "",
				removed ? `${bold(removed)} ${removed === 1 ? "removal" : "removals"}` : "",
			].filter(Boolean);
			const line = counts.length ? `Updated ${theme.bold(path)} with ${counts.join(" and ")}` : `Updated ${theme.bold(path)}`;
			return body([line, ...(diff ? renderDiff(diff).split("\n") : [])], width, theme);
		}
		default: {
			const lines = output ? plain(output) : [theme.fg("dim", "(No content)")];
			const details = result.details as { fullOutputPath?: string } | undefined;
			if (details?.fullOutputPath) lines.push(theme.fg("dim", `Full output: ${details.fullOutputPath}`));
			return body(lines, width, theme, expanded ? undefined : PREVIEW_LINES);
		}
	}
}

/** "Read 3 files", "Searching for 1 pattern, reading 2 files…" */
function groupSummary(kinds: Kind[], running: boolean): string {
	const counts = new Map<Kind, number>();
	for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
	const parts = [...counts].map(([kind, n]) => {
		if (kind === "read") return `${running ? "reading" : "read"} ${plural(n, "file")}`;
		if (kind === "search") return `${running ? "searching" : "searched"} for ${plural(n, "pattern")}`;
		return `${running ? "listing" : "listed"} ${plural(n, "directory", "directories")}`;
	});
	const text = parts.join(", ");
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}${running ? "…" : ""}`;
}

export default function (pi: ExtensionAPI) {
	// Transcript order: one slot per message (null for a user message).
	let messages: (Content[] | null)[] = [];
	let live = -1; // slot of the assistant message being streamed
	// Folded runs: tool call id -> the ids of its run, leader first.
	let groups = new Map<string, string[]>();
	let roles = new Map<string, string>();
	const kinds = new Map<string, Kind>();
	const status = new Map<string, Status>();
	const expandedLeaders = new Set<string>();
	const invalidators = new Map<string, () => void>();
	let busy = false;

	const invalidate = (id: string | undefined) => {
		const fn = id === undefined ? undefined : invalidators.get(id);
		if (fn) queueMicrotask(fn);
	};

	const regroup = () => {
		const next = new Map<string, string[]>();
		let run: string[] = [];
		const flush = () => {
			if (run.length >= 2) for (const id of run) next.set(id, run);
			run = [];
		};
		for (const message of messages) {
			if (!message) {
				flush();
				continue;
			}
			for (const c of message) {
				if (c.type === "text" && c.text?.trim()) flush();
				else if (c.type === "toolCall" && c.id) {
					const kind = c.name ? KINDS[c.name] : undefined;
					if (kind) kinds.set(c.id, kind);
					if (kind && status.get(c.id) !== "error") run.push(c.id);
					else flush();
				}
			}
		}
		flush();
		const nextRoles = new Map<string, string>();
		for (const [id, ids] of next) nextRoles.set(id, ids[0] === id ? `lead:${ids.join(",")}` : `member:${ids[0]}`);
		for (const id of new Set([...roles.keys(), ...nextRoles.keys()])) {
			if (roles.get(id) !== nextRoles.get(id)) invalidate(id);
		}
		groups = next;
		roles = nextRoles;
	};

	const load = (ctx: { sessionManager: { getBranch(): unknown[] } }) => {
		messages = [];
		live = -1;
		for (const entry of ctx.sessionManager.getBranch() as { type: string; message?: { role: string; content: unknown } }[]) {
			if (entry.type !== "message" || !entry.message) continue;
			if (entry.message.role === "user") messages.push(null);
			else if (entry.message.role === "assistant") messages.push(entry.message.content as Content[]);
		}
		regroup();
	};

	/** Track the row's status; a change can fold or unfold it and redraws its run. */
	const track = (context: ToolRenderContext) => {
		const id = context.toolCallId;
		invalidators.set(id, context.invalidate);
		const now: Status = context.isPartial ? "running" : context.isError ? "error" : "done";
		if (status.get(id) === now) return;
		status.set(id, now);
		if (now === "error" && kinds.has(id)) regroup();
		const run = groups.get(id);
		if (run && run[0] !== id) invalidate(run[0]);
	};

	/** Keep a running row blinking; stop once it settles or pi goes idle. */
	const blink = (context: ToolRenderContext, running: boolean) => {
		const state = context.state as Row;
		if (running && busy && !state.timer) {
			state.timer = setInterval(context.invalidate, BLINK_MS);
			state.timer.unref?.();
		} else if ((!running || !busy) && state.timer) {
			clearInterval(state.timer);
			state.timer = undefined;
		}
	};

	const renderers = (toolName: string): ToolRenderers => ({
		renderShell: "self",
		renderCall(args: unknown, theme: Theme, context: ToolRenderContext) {
			track(context);
			const id = context.toolCallId;
			const run = groups.get(id);
			if (run) {
				const leader = run[0]!;
				if (id === leader) {
					const was = expandedLeaders.has(id);
					if (context.expanded) expandedLeaders.add(id);
					else expandedLeaders.delete(id);
					if (was !== context.expanded) for (const member of run.slice(1)) invalidate(member);
				}
				if (!expandedLeaders.has(leader)) {
					if (id !== leader) {
						blink(context, false);
						return lines(context, () => []);
					}
					const states = run.map((m) => status.get(m) ?? "running");
					const running = states.includes("running");
					blink(context, running);
					const summary = groupSummary(run.map((m) => kinds.get(m)!), running);
					return lines(context, (width) => [
						truncateToWidth(
							`${dot(running ? "running" : "done", theme, busy)} ${summary} ${theme.fg("dim", `(${expandKey()} to expand)`)}`,
							width,
							"…",
						),
					]);
				}
			}
			const running = context.isPartial;
			blink(context, running);
			const title = mcpLabel(pi, toolName) ?? TITLES[toolName] ?? toolName;
			const text = callArgs(toolName, (args ?? {}) as Args, context.cwd, context.expanded);
			const state: Status = running ? "running" : context.isError ? "error" : "done";
			return lines(context, (width) => header(dot(state, theme, busy), title, text, width, context.expanded, theme));
		},
		renderResult(result: Result, _options, theme: Theme, context: ToolRenderContext) {
			const run = groups.get(context.toolCallId);
			if (run && !expandedLeaders.has(run[0]!)) return lines(context, () => []);
			return lines(context, (width) => resultLines(toolName, result, context, theme, width));
		},
	});

	pi.registerToolRenderer((toolName) => renderers(toolName));

	pi.on("session_start", async (_event, ctx) => {
		invalidators.clear();
		status.clear();
		kinds.clear();
		expandedLeaders.clear();
		roles = new Map();
		load(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => load(ctx));
	pi.on("session_compact", async (_event, ctx) => load(ctx));

	pi.on("message_start", async (event) => {
		if (event.message.role === "user") {
			messages.push(null);
			live = -1;
		} else if (event.message.role === "assistant") {
			live = messages.push(event.message.content as Content[]) - 1;
		}
		regroup();
	});

	const update = (message: AgentMessage) => {
		if (message.role !== "assistant" || live < 0) return;
		messages[live] = message.content as Content[];
		regroup();
	};
	pi.on("message_update", async (event) => update(event.message));
	pi.on("message_end", async (event) => update(event.message));

	pi.on("agent_start", async () => {
		busy = true;
	});
	pi.on("agent_settled", async () => {
		busy = false;
		for (const fn of invalidators.values()) queueMicrotask(fn);
	});
}
