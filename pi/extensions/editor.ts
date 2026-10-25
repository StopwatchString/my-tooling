/**
 * Input editor in the style of Claude Code's prompt: grey rules above and
 * below and a `>` in front of the text, in place of pi's rules coloured by
 * thinking level.
 *
 *   ────────────────────────────
 *   > fix the failing test
 *   ────────────────────────────
 *
 * - Event `session_start`: installs the editor (TUI only).
 *
 * Text starting with `!` (pi's bash mode) turns the rules and the prompt the
 * bash-mode colour, as Claude Code does. Wrapped lines are indented under the
 * text.
 */
import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Columns before the text; the first visible line puts the prompt there.
const INDENT = 2;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		class PromptEditor extends CustomEditor {
			// pi applies its editorPaddingX setting; the prompt needs INDENT.
			setPaddingX(_padding: number): void {
				super.setPaddingX(INDENT);
			}

			render(width: number): string[] {
				const theme = ctx.ui.theme;
				const bash = this.getText().trimStart().startsWith("!");
				const color = bash ? "bashMode" : "borderMuted";
				// pi reassigns borderColor on thinking and bash-mode changes; this wins.
				this.borderColor = (text: string) => theme.fg(color, text);
				const lines = super.render(width);
				if (lines.length >= 3 && width > INDENT * 2) {
					const prompt = theme.fg(bash ? "bashMode" : "muted", "> ");
					lines[1] = prompt + lines[1]!.slice(INDENT);
				}
				return lines;
			}
		}

		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => new PromptEditor(tui, theme, keybindings, { paddingX: INDENT }),
		);
	});
}
