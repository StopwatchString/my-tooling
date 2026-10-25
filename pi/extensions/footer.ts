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
 * on a second line, as in pi's footer.
 */
import { homedir, hostname, userInfo } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

export default function (pi: ExtensionAPI) {
	let requestRender = () => {};

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const identity =
			`${GREEN}${userInfo().username}@${hostname().split(".")[0]}${RESET}` +
			`${GREY}:${RESET}${BLUE}${displayPath(ctx.cwd)}${RESET}`;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			return {
				render(width: number): string[] {
					const sep = theme.fg("dim", " · ");
					const parts = [identity];
					const model = ctx.model;
					if (model) {
						const thinking = model.reasoning ? ` ${theme.fg("dim", `(${pi.getThinkingLevel()})`)}` : "";
						parts.push(model.id + thinking);
					}
					const percent = ctx.getContextUsage()?.percent;
					if (percent != null) {
						const value = `${Math.round(percent)}%`;
						const color = percent >= 90 ? "error" : percent >= 70 ? "warning" : undefined;
						parts.push(`ctx ${color ? theme.fg(color, value) : value}`);
					}
					const all = footerData.getExtensionStatuses();
					const mode = all.get("mode")?.replace(/[\r\n\t]+/g, " ");
					let first = parts.join(sep);
					if (mode) {
						const room = width - visibleWidth(mode) - 2;
						first = room > 10 ? truncateToWidth(first, room, theme.fg("dim", "...")) : "";
						first += " ".repeat(Math.max(1, width - visibleWidth(first) - visibleWidth(mode))) + mode;
					}
					const lines = [first];
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
