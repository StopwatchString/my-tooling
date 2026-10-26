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
 * Esc twice in a row clears the text, as in Claude Code: the first marks the
 * bottom rule "Esc again to clear", a second within DOUBLE_ESC_MS clears it
 * and keeps it in the prompt history (↑ brings it back). Only while pi is
 * idle: while it works, Esc still interrupts.
 *
 * Text starting with `!` (pi's bash mode) turns the rules and the prompt the
 * bash-mode colour, as Claude Code does. Wrapped lines are indented under the
 * text.
 */
import { CustomEditor, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI, visibleWidth } from "@earendil-works/pi-tui";

// Columns before the text; the first visible line puts the prompt there.
const INDENT = 2;
// How soon the second Esc must follow the first to clear the text.
const DOUBLE_ESC_MS = 800;
const CLEAR_HINT = " Esc again to clear ";

/** Set by `context-bar.ts` while it is loaded. */
type Bar = (percent: number | null | undefined, width: number, theme: Theme) => string;
const FOOTER = Symbol.for("my-tooling.footer");
const shared = globalThis as typeof globalThis & { [FOOTER]?: { bar?: Bar } };

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		class PromptEditor extends CustomEditor {
			private escAt = 0;
			private escTimer?: ReturnType<typeof setTimeout>;
			screen?: TUI;

			// pi applies its editorPaddingX setting; the prompt needs INDENT.
			setPaddingX(_padding: number): void {
				super.setPaddingX(INDENT);
			}

			protected renderTopBorder(width: number, hidden: number): string {
				return this.contextBar(width, hidden) ?? super.renderTopBorder(width, hidden);
			}

			protected renderBottomBorder(width: number, hidden: number): string {
				return this.contextBar(width, hidden) ?? super.renderBottomBorder(width, hidden);
			}

			private contextBar(width: number, hidden: number): string | undefined {
				const bar = shared[FOOTER]?.bar;
				if (!bar || hidden > 0 || this.getText().trimStart().startsWith("!")) return undefined;
				return bar(ctx.getContextUsage()?.percent, width, ctx.ui.theme);
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
				if (this.escAt && lines.length >= 2 && width > visibleWidth(CLEAR_HINT) + 4) {
					lines[lines.length - 1] = theme.fg(color, "──") + theme.fg("dim", CLEAR_HINT) +
						theme.fg(color, "─".repeat(width - visibleWidth(CLEAR_HINT) - 2));
				}
				return lines;
			}

			handleInput(data: string): void {
				const text = this.getText();
				if (!matchesKey(data, "escape") || !ctx.isIdle() || !text.trim() || text.trimStart().startsWith("!")) {
					this.forgetEsc();
					return super.handleInput(data);
				}
				if (this.escAt && Date.now() - this.escAt < DOUBLE_ESC_MS) {
					this.forgetEsc();
					this.addToHistory(text);
					this.setText("");
				} else {
					this.forgetEsc();
					this.escAt = Date.now();
					this.escTimer = setTimeout(() => {
						this.forgetEsc();
						this.screen?.requestRender();
					}, DOUBLE_ESC_MS);
				}
				this.screen?.requestRender();
			}

			private forgetEsc(): void {
				clearTimeout(this.escTimer);
				this.escAt = 0;
			}
		}

		ctx.ui.setEditorComponent(
			(tui, theme, keybindings) => {
				const editor = new PromptEditor(tui, theme, keybindings, { paddingX: INDENT });
				editor.screen = tui;
				return editor;
			},
		);
	});
}
