/**
 * Command `/exit`: quit Pi cleanly via ctx.shutdown().
 *
 * - Event `session_start`: hides commands the user doesn't use from the `/`
 *   menu (TUI only): `/quit` (so `/exit` is the one listed) and the HIDDEN
 *   list below. Typing one in full still works: pi runs its built-ins before
 *   extensions see the input.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HIDDEN = new Set(["quit", "share", "bug", "fork", "clone", "llama", "tree", "export", "import", "changelog"]);

export default function (pi: ExtensionAPI) {
	pi.registerCommand("exit", {
		description: "Quit Pi",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.addAutocompleteProvider((current) => ({
			...current,
			getSuggestions: async (lines, cursorLine, cursorCol, options) => {
				const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
				if (!suggestions?.prefix.startsWith("/")) return suggestions;
				const items = suggestions.items.filter((item) => !HIDDEN.has(item.value.replace(/^\//, "")));
				return items.length > 0 ? { ...suggestions, items } : null;
			},
			applyCompletion: (...args) => current.applyCompletion(...args),
		}));
	});
}
