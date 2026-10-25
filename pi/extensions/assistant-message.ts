/**
 * Assistant text in the style of Claude Code's transcript: a `⏺` before each
 * block of text, the same bullet tool calls get (`tools.ts`), with wrapped
 * lines indented under the text.
 *
 *   ⏺ The test failed because the fixture path
 *     was relative; fixed and re-ran it.
 *
 * - Event `session_start`: keeps the current theme for the renderer (TUI only).
 *
 * pi has no hook for this, so it patches the exported
 * AssistantMessageComponent's `render` (`working.ts` patches its
 * `updateContent`): each text block's Markdown gets 2 columns of padding,
 * and the bullet goes into them on its first line. The original is kept on
 * the prototype so /reload doesn't wrap the patch twice.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

// Columns before the text; the first line puts the bullet there.
const INDENT = 2;
const ORIGINAL = Symbol.for("my-tooling.assistant-message.render");
const BULLETED = Symbol.for("my-tooling.assistant-message.bulleted");

// The private bits of pi's components this patch touches.
type Patchable = { render(width: number): string[]; contentContainer: { children: unknown[] } };
type MarkdownInternals = {
	paddingX: number;
	render: Markdown["render"];
	[BULLETED]?: true;
};

let theme: Theme | undefined;

const proto = AssistantMessageComponent.prototype as unknown as Patchable & {
	[ORIGINAL]?: Patchable["render"];
};
const render = (proto[ORIGINAL] ??= proto.render);

proto.render = function (this: Patchable, width: number) {
	const current = theme;
	if (current) {
		for (const child of this.contentContainer.children) {
			if (!(child instanceof Markdown)) continue;
			const md = child as unknown as MarkdownInternals;
			if (md[BULLETED]) continue;
			md[BULLETED] = true;
			md.paddingX = INDENT;
			const draw = md.render.bind(md);
			md.render = (w: number) => {
				const lines = draw(w);
				if (lines.length === 0) return lines;
				const bullet = `${current.fg("text", "⏺")} `;
				// Leading SGR codes, then the padding to swap.
				const first = lines[0]!.replace(/^((?:\x1b\[[0-9;]*m)*) {2}/, `$1${bullet}`);
				return [first, ...lines.slice(1)];
			};
		}
	}
	return render.call(this, width);
};

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		theme = ctx.ui.theme;
	});
}
