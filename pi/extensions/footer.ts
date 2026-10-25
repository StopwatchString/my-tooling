/**
 * Footer: one line in the style of the Claude Code status line
 * (claude/statusline.sh), in place of pi's two-line footer.
 *
 *   mspeck@socrates:~/my-tooling · swift (medium) · ctx 8%
 *
 * - Event `session_start`: installs the footer (TUI only).
 * - Events `model_select`, `thinking_level_select`, `message_end`: re-render.
 *
 * user@host:dir is styled like the zsh prompt (shell/zsh/p10k.zsh). The
 * thinking level is shown only for models that reason. ctx turns yellow from
 * 70% and red from 90%. The status keyed `mode` (`modes.ts`) goes at the
 * right of the line; other statuses set by extensions (ctx.ui.setStatus) go
 * on a second line, as in pi's footer. The same line, for an agent, is at the
 * bottom of the task view (`tasks/ui.ts`), through `globalThis`. While
 * `context-bar.ts` is loaded, its bar goes above the line.
 */
import { homedir, hostname, userInfo } from "node:os";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// The zsh prompt's colors: bold green user@host, grey colon, bold blue dir.
const GREEN = "\x1b[1;32m";
const BLUE = "\x1b[1;34m";
const GREY = "\x1b[38;5;244m";
const RESET = "\x1b[0m";

function displayPath(path: string): string {
	const home = homedir();
	return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** What a status line shows: footer.ts draws the main session's, tasks/ an agent's. */
export interface StatusInfo {
	cwd: string;
	model?: { id: string; reasoning?: boolean };
	thinking?: string;
	percent?: number | null;
	/** Text at the right; the main session's `mode` status if left out. */
	mode?: string;
}

type StatusLine = (info: StatusInfo, width: number, theme: Theme) => string;
/** Set by `context-bar.ts` while it is loaded. */
type Bar = (percent: number | null | undefined, width: number, theme: Theme) => string;

const KEY = Symbol.for("my-tooling.footer");
const shared = globalThis as typeof globalThis & { [KEY]?: { line?: StatusLine; bar?: Bar; mode?: string } };
const state = (shared[KEY] ??= {});

/** Context fill, yellow from 70% and red from 90%; "" if unknown. */
function contextText(percent: number | null | undefined, theme: Theme): string {
	if (percent == null) return "";
	const value = `${Math.round(percent)}%`;
	const color = percent >= 90 ? "error" : percent >= 70 ? "warning" : undefined;
	return `ctx ${color ? theme.fg(color, value) : value}`;
}

const statusLine: StatusLine = (info, width, theme) => {
	const sep = theme.fg("dim", " · ");
	const parts = [
		`${GREEN}${userInfo().username}@${hostname().split(".")[0]}${RESET}${GREY}:${RESET}${BLUE}${displayPath(info.cwd)}${RESET}`,
	];
	if (info.model) {
		const thinking = info.model.reasoning && info.thinking ? ` ${theme.fg("dim", `(${info.thinking})`)}` : "";
		parts.push(info.model.id + thinking);
	}
	const ctx = contextText(info.percent, theme);
	if (ctx) parts.push(ctx);
	const mode = (info.mode ?? state.mode)?.replace(/[\r\n\t]+/g, " ");
	let line = parts.join(sep);
	if (mode) {
		const room = width - visibleWidth(mode) - 2;
		line = room > 10 ? truncateToWidth(line, room, theme.fg("dim", "...")) : "";
		line += " ".repeat(Math.max(1, width - visibleWidth(line) - visibleWidth(mode))) + mode;
	}
	return truncateToWidth(line, width, theme.fg("dim", "..."));
};
// Other extensions (tasks/) draw the same line through globalThis, so they
// don't import this file.
state.line = statusLine;

export default function (pi: ExtensionAPI) {
	let requestRender = () => {};

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			return {
				render(width: number): string[] {
					const all = footerData.getExtensionStatuses();
					state.mode = all.get("mode");
					const percent = ctx.getContextUsage()?.percent;
					const lines = [
						...(state.bar ? [state.bar(percent, width, theme)] : []),
						statusLine({ cwd: ctx.cwd, model: ctx.model, thinking: pi.getThinkingLevel(), percent }, width, theme),
					];
					const statuses = [...all.entries()]
						.filter(([key]) => key !== "mode")
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text.replace(/[\r\n\t]+/g, " "));
					if (statuses.length > 0) lines.push(statuses.join(" "));
					return lines.map((line) => truncateToWidth(line, width, theme.fg("dim", "...")));
				},
				invalidate() {},
			};
		});
	});

	pi.on("model_select", async () => requestRender());
	pi.on("thinking_level_select", async () => requestRender());
	pi.on("message_end", async () => requestRender());
}
