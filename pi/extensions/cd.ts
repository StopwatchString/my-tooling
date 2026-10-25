/**
 * Command `/cd <dir>`: move the conversation to another working directory.
 *
 * pi binds the cwd to a session (its file header) and rebuilds the tools,
 * system prompt and context files from it when a session opens. So `/cd`
 * copies the current session into a new one for `<dir>` (stored with that
 * directory's sessions, parent = the old file) and switches to it. The
 * history is kept; tasks end, as on any session switch. It also chdirs the
 * process, for paths pi resolves against it, and adds a note for the model
 * to the conversation.
 *
 * `<dir>` may be relative, `~`-prefixed, `-` (the previous one) or empty
 * (home). Directory names complete on tab.
 *
 * - Message renderer `cd`: the note as a transcript line, like a tool call
 *   (`tools.ts`):
 *
 *     ⏺ cd ~/dev/project
 *       ⎿  from ~/my-tooling
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getAgentDir, SessionManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

// Survives the extension reload that comes with the session switch.
const STATE = Symbol.for("my-tooling.cd");
const state: { previous?: string } = ((globalThis as Record<symbol, unknown>)[STATE] ??= {}) as { previous?: string };

function expand(arg: string, base: string): string {
	if (arg === "" || arg === "~") return homedir();
	if (arg.startsWith("~/")) return join(homedir(), arg.slice(2));
	return resolve(base, arg);
}

type Details = { from: string; to: string };

function tilde(path: string): string {
	const home = homedir();
	return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function isDir(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerMessageRenderer<Details>("cd", (message, _options, theme) => {
		const { details } = message;
		if (!details) return undefined;
		const line = `${theme.fg("success", "⏺")} ${theme.bold(theme.fg("toolTitle", "cd"))} ${tilde(details.to)}`;
		return new Text(`${line}\n${theme.fg("dim", `  ⎿  from ${tilde(details.from)}`)}`, 0, 0);
	});

	pi.registerCommand("cd", {
		description: "Change the working directory, keeping the conversation",
		getArgumentCompletions: (prefix) => {
			// The typed part up to the last slash is kept; names in it complete.
			const cut = prefix.lastIndexOf("/") + 1;
			const head = prefix.slice(0, cut);
			const partial = prefix.slice(cut);
			const dir = expand(head || ".", process.cwd());
			let names: string[];
			try {
				names = readdirSync(dir).filter((name) => name.startsWith(partial) && (partial.startsWith(".") || !name.startsWith(".")));
			} catch {
				return null;
			}
			const items = names
				.filter((name) => isDir(join(dir, name)))
				.sort()
				.map((name) => ({ value: `${head}${name}/`, label: `${name}/` }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg === "-" && !state.previous) {
				ctx.ui.notify("cd: no previous directory", "error");
				return;
			}
			const target = arg === "-" ? state.previous! : expand(arg, ctx.cwd);
			if (!isDir(target)) {
				ctx.ui.notify(`cd: not a directory: ${target}`, "error");
				return;
			}
			const from = ctx.cwd;
			if (target === from) return;
			if (!ctx.isIdle()) {
				ctx.ui.notify("cd: wait for the agent to finish (or press esc)", "error");
				return;
			}
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile || !existsSync(sessionFile)) {
				// Nothing to copy yet (no messages) or --no-session.
				ctx.ui.notify("cd: needs a saved session; send a message first, or restart pi there", "error");
				return;
			}

			// Keep a custom --session-dir; otherwise store with target's sessions.
			const current = ctx.sessionManager.getSessionDir();
			const sessionDir = dirname(current) === join(getAgentDir(), "sessions") ? undefined : current;
			const copy = SessionManager.forkFrom(sessionFile, target, sessionDir).getSessionFile();
			if (!copy) {
				ctx.ui.notify("cd: couldn't copy the session", "error");
				return;
			}

			await ctx.switchSession(copy, {
				withSession: async (next) => {
					state.previous = from;
					process.chdir(target);
					await next.sendMessage({
						customType: "cd",
						content: `The working directory changed from ${from} to ${target}. Relative paths now resolve against ${target}.`,
						display: true,
						details: { from, to: target } satisfies Details,
					});
				},
			});
		},
	});
}
