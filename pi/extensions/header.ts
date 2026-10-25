/**
 * Startup header: the pi logo, version, working directory and the loaded
 * context files, in place of the built-in one (logo, key hints,
 * onboarding text) and pi's [Context] listing.
 *
 *   ▀▀█  pi v1.4.0
 *   █▀ █ ~/my-tooling · ~/.pi/agent/AGENTS.md, ~/AGENTS.md, AGENTS.md
 *
 * - Event `session_start`: installs the header (TUI only).
 *
 * Context files that don't fit after the directory wrap onto lines of their
 * own. pi's other listings ([Skills], [Extensions], ...) are hidden by
 * `quietStartup: "header"` in settings.json; its warnings still show. The
 * logo is drawn like pi's (dist/.../pi-logo.js), which isn't exported; Apple
 * Terminal gets the "Pi" wordmark, as in pi.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir, loadProjectContextFiles, VERSION } from "@earendil-works/pi-coding-agent";
import {
	backgroundAnsi,
	foregroundAnsi,
	isAppleTerminalSession,
	rgbColor,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const CORAL = rgbColor(228, 138, 122);
const BLUE = rgbColor(79, 142, 179);
const YELLOW = rgbColor(234, 182, 93);
const RESET = "\x1b[0m";

function logoLines(theme: Theme): [string, string] {
	const mode = theme.getColorMode();
	const fg = (color: typeof CORAL) => foregroundAnsi(color, mode);
	if (isAppleTerminalSession()) {
		return [`${fg(CORAL)}P${RESET}${fg(YELLOW)}i${RESET}  `, "    "];
	}
	const top = `${fg(CORAL)}${backgroundAnsi(BLUE, mode)}▀${RESET}${fg(CORAL)}▀█${RESET} `;
	const bottom = `${fg(BLUE)}█▀${RESET} ${fg(YELLOW)}█${RESET}`;
	return [top, bottom];
}

function displayPath(path: string): string {
	const home = homedir();
	return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

// The files pi lists under [Context]: SYSTEM.md, APPEND_SYSTEM.md (project
// one only when trusted, as in pi's resource loader), then the AGENTS.md chain.
function contextFiles(ctx: ExtensionContext): string[] {
	const agentDir = getAgentDir();
	const promptFile = (name: string) => {
		const project = join(ctx.cwd, CONFIG_DIR_NAME, name);
		if (ctx.isProjectTrusted() && existsSync(project)) return [project];
		const global = join(agentDir, name);
		return existsSync(global) ? [global] : [];
	};
	return [
		...promptFile("SYSTEM.md"),
		...promptFile("APPEND_SYSTEM.md"),
		...loadProjectContextFiles({ cwd: ctx.cwd, agentDir }).map((f) => f.path),
	];
}

// Relative to cwd when inside it, like pi's own listing; else ~-shortened.
function contextPath(path: string, cwd: string): string {
	const rel = relative(resolve(cwd), resolve(path));
	return rel && !rel.startsWith("..") && !rel.startsWith("/") ? rel : displayPath(path);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const cwd = displayPath(ctx.cwd);
		const context = contextFiles(ctx).map((path) => contextPath(path, ctx.cwd)).join(", ");
		ctx.ui.setHeader((_tui, theme) => {
			return {
				render(width: number): string[] {
					const [top, bottom] = logoLines(theme);
					const sep = theme.fg("dim", " · ");
					const first = `${top} ${theme.bold("pi")} ${theme.fg("dim", `v${VERSION}`)}`;
					const second = `${bottom} ${theme.fg("muted", cwd)}`;
					const lines = [first, second];
					if (context) {
						const inline = `${second}${sep}${theme.fg("dim", context)}`;
						if (visibleWidth(inline) <= width) {
							lines[1] = inline;
						} else {
							const indent = " ".repeat(visibleWidth(bottom) + 1);
							const wrapped = wrapTextWithAnsi(context, Math.max(1, width - indent.length));
							lines.push(...wrapped.map((line) => indent + theme.fg("dim", line)));
						}
					}
					return lines.map((line) => truncateToWidth(line, width));
				},
				invalidate() {},
			};
		});
	});
}
