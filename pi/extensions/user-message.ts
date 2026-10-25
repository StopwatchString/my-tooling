/**
 * Sent user messages in the style of Claude Code's transcript: a `>` before
 * the text on a grey band, in place of pi's padded blue block.
 *
 *   > fix the failing test
 *     and run it again
 *
 * - Event `session_start`: keeps the current theme for the renderer (TUI only).
 *
 * pi has no hook for this, so it patches the exported UserMessageComponent:
 * after each rebuild the inner Markdown gets 2 columns of padding (the prompt
 * goes there), no blank padding lines, and the tool-pending grey as its
 * background. The originals are kept on the prototype so /reload doesn't wrap
 * the patch twice.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Markdown } from "@earendil-works/pi-tui";

// Columns before the text; the first line puts the prompt there.
const INDENT = 2;
const ORIGINAL = Symbol.for("my-tooling.user-message.rebuild");

// The private bits of pi's components this patch touches.
type Patchable = { rebuild(): void; children: unknown[] };
type MarkdownInternals = {
	paddingX: number;
	paddingY: number;
	defaultTextStyle?: { bgColor?: (text: string) => string };
	render: Markdown["render"];
};

let theme: Theme | undefined;

const proto = UserMessageComponent.prototype as unknown as Patchable & { [ORIGINAL]?: () => void };
const rebuild = (proto[ORIGINAL] ??= proto.rebuild);

proto.rebuild = function (this: Patchable) {
	rebuild.call(this);
	const md = this.children[0] as MarkdownInternals | undefined;
	const current = theme;
	if (!md || !current) return;
	md.paddingX = INDENT;
	md.paddingY = 0;
	if (md.defaultTextStyle) md.defaultTextStyle.bgColor = (text) => current.bg("userMessageBg", text);
	const render = md.render.bind(md);
	md.render = (width: number) => {
		const lines = render(width);
		if (lines.length === 0) return lines;
		const prompt = `${current.fg("muted", ">")} `;
		// Leading SGR codes (the background), then the padding to swap.
		const first = lines[0]!.replace(/^((?:\x1b\[[0-9;]*m)*) {2}/, `$1${prompt}`);
		return [first, ...lines.slice(1)];
	};
};

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		theme = ctx.ui.theme;
	});
}
