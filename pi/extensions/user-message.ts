/**
 * Sent user messages in the style of Claude Code's transcript: a `>` before
 * the text on a grey band, in place of pi's padded blue block.
 *
 *   > fix the failing test
 *     and run it again
 *
 * - Event `session_start`: keeps the current theme for the renderer (TUI only).
 *
 * pi has no hook for this, so it patches the exported UserMessageComponent's
 * `render`: the inner Markdown (new after each rebuild) gets 2 columns of
 * padding (the prompt goes there), no blank padding lines, and the
 * tool-pending grey as its background. It's styled at render time, not in
 * `rebuild`, because on a session switch (/resume, /cd) pi rebuilds the
 * transcript before this extension's `session_start` hands it the theme.
 * The originals are kept on the prototype so /reload doesn't wrap the patch
 * twice.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Markdown } from "@earendil-works/pi-tui";

// Columns before the text; the first line puts the prompt there.
const INDENT = 2;
const ORIGINAL_RENDER = Symbol.for("my-tooling.user-message.render");
// Earlier versions patched `rebuild`; put the original back.
const ORIGINAL_REBUILD = Symbol.for("my-tooling.user-message.rebuild");
const STYLED = Symbol.for("my-tooling.user-message.styled");

// The private bits of pi's components this patch touches.
type Patchable = { render(width: number): string[]; rebuild(): void; children: unknown[] };
type MarkdownInternals = {
	paddingX: number;
	paddingY: number;
	defaultTextStyle?: { bgColor?: (text: string) => string };
	render: Markdown["render"];
	invalidate(): void;
	[STYLED]?: true;
};

let theme: Theme | undefined;

const proto = UserMessageComponent.prototype as unknown as Patchable & {
	[ORIGINAL_RENDER]?: Patchable["render"];
	[ORIGINAL_REBUILD]?: Patchable["rebuild"];
};
if (proto[ORIGINAL_REBUILD]) proto.rebuild = proto[ORIGINAL_REBUILD];
const render = (proto[ORIGINAL_RENDER] ??= proto.render);

proto.render = function (this: Patchable, width: number) {
	const md = this.children[0] as MarkdownInternals | undefined;
	const current = theme;
	if (md && current && !md[STYLED]) {
		md[STYLED] = true;
		md.paddingX = INDENT;
		md.paddingY = 0;
		if (md.defaultTextStyle) md.defaultTextStyle.bgColor = (text) => current.bg("userMessageBg", text);
		md.invalidate();
		const draw = md.render.bind(md);
		md.render = (w: number) => {
			const lines = draw(w);
			if (lines.length === 0) return lines;
			const prompt = `${current.fg("muted", ">")} `;
			// Leading SGR codes (the background), then the padding to swap.
			const first = lines[0]!.replace(/^((?:\x1b\[[0-9;]*m)*) {2}/, `$1${prompt}`);
			return [first, ...lines.slice(1)];
		};
	}
	return render.call(this, width);
};

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		theme = ctx.ui.theme;
	});
}
