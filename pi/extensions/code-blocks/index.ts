/**
 * Code blocks in markdown (assistant replies and anything else pi renders as
 * markdown) drawn as a tinted panel instead of between ``` fences:
 *
 *   ╭─ ts ──────────────────────────────────────────╮
 *   │ 1  export function sum(xs: number[]) {        │
 *   │ 2  │ return xs.reduce((a, b) => a + b, 0);     │
 *   │ 3  }                                          │
 *   ╰───────────────────────────────────────────────╯
 *
 * - Command `/code-theme [name]`: picks the code theme (`themes.ts`: the
 *   JSON files in `themes/`, or `pi`; `light/dark` picks by pi's theme),
 *   saved in `code-blocks.json` in pi's agent dir. Default: Visual Studio's
 *   (`vs-light/vs-dark`).
 * - Event `session_start`: keeps pi's UI for the theme (TUI only); without
 *   it (print mode) pi's own rendering stays. Starts loading the tree-sitter
 *   grammars, and redraws markdown each time one is ready.
 *
 * Inside the panel: tree-sitter highlighting for the languages pinned in
 * `vendor/` (`treesitter.ts`: bash, c, cpp, go, javascript, json, lua,
 * python, rust, tsx, typescript), pi's highlight.js for the rest (its
 * colours swapped for the theme's), line numbers (blocks of more than one
 * line), indent guides, and brackets coloured by depth (an unmatched one in
 * the theme's error colour). Brackets in
 * strings and comments are left alone, by a rough per-language scan. Long
 * lines wrap inside the panel. Inline `code` and the rest of the text are
 * left as pi draws them.
 *
 * pi has no hook for this, so it patches pi-tui's exported Markdown
 * component's private `renderToken` for `code` tokens. The original is kept
 * on the prototype so /reload doesn't wrap the patch twice; `render` is
 * patched too, to drop a Markdown's cache once a grammar has loaded. Check
 * them after a pi upgrade. Delete this directory to go back to pi's fences.
 */
import type { ExtensionAPI, ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { highlightCode } from "@earendil-works/pi-coding-agent";
import { Markdown, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { TUI } from "@earendil-works/pi-tui";
import { chosenTheme, currentStyle, DEFAULT_THEME, knownTheme, saveTheme, themeChoices } from "./themes.ts";
import { highlight, load } from "./treesitter.ts";

const ORIGINAL = Symbol.for("my-tooling.code-blocks.renderToken");
const ORIGINAL_RENDER = Symbol.for("my-tooling.code-blocks.render");
const GENERATION = Symbol.for("my-tooling.code-blocks.generation");
const TAB = "    ";
const OPEN = "([{";
const CLOSE = ")]}";
// Comment syntax by language; anything else gets C's.
const HASH = new Set(["python", "py", "sh", "bash", "zsh", "shell", "yaml", "yml", "toml", "ruby", "rb", "r", "perl", "make", "makefile", "dockerfile", "nix", "conf", "ini", "fish", "elixir", "powershell", "ps1"]);
const DASH = new Set(["sql", "lua", "haskell", "hs", "elm"]);
// Languages where `'` is not (only) a string quote.
const NO_SINGLE = new Set(["rust", "rs", "ocaml", "ml", "lisp", "clojure", "scheme", "elm", "haskell", "hs"]);

type Token = { type: string; text: string; lang?: string };
type MarkdownInternals = {
	renderToken(token: Token, width: number, nextTokenType?: string, styleContext?: unknown): string[];
	render(width: number): string[];
	invalidate(): void;
	[GENERATION]?: number;
};

let ui: ExtensionUIContext | undefined;
let screen: TUI | undefined;
// Goes up each time a grammar loads or the theme changes, so markdown drawn before that redraws.
let generation = 0;

/** Where each bracket outside strings and comments sits, line by line, and its depth (-1: unmatched). */
function scanBrackets(lines: string[], lang: string): Map<number, number>[] {
	const line = HASH.has(lang) ? "#" : DASH.has(lang) ? "--" : "//";
	const block = HASH.has(lang) && lang !== "nix" ? undefined : ["/*", "*/"];
	const quotes = NO_SINGLE.has(lang) ? "\"`" : "\"'`";
	const stack: string[] = [];
	let quote = "";
	let inBlock = false;
	return lines.map((text) => {
		const found = new Map<number, number>();
		// Only template strings run across lines.
		if (quote !== "`") quote = "";
		for (let i = 0; i < text.length; i++) {
			const c = text[i]!;
			if (inBlock) {
				if (block && text.startsWith(block[1]!, i)) {
					inBlock = false;
					i += block[1]!.length - 1;
				}
			} else if (quote) {
				if (c === "\\") i++;
				else if (c === quote) quote = "";
			} else if (text.startsWith(line, i)) {
				break;
			} else if (block && text.startsWith(block[0]!, i)) {
				inBlock = true;
				i += block[0]!.length - 1;
			} else if (quotes.includes(c)) {
				quote = c;
			} else if (OPEN.includes(c)) {
				found.set(i, stack.length);
				stack.push(c);
			} else if (CLOSE.includes(c)) {
				const match = stack.at(-1) === OPEN[CLOSE.indexOf(c)];
				if (match) stack.pop();
				found.set(i, match ? stack.length : -1);
			}
		}
		return found;
	});
}

/** `ansi` without its first `count` visible characters (leading spaces). */
function dropColumns(ansi: string, count: number): string {
	let out = "";
	let dropped = 0;
	for (let i = 0; i < ansi.length; ) {
		const esc = /^\x1b\[[0-9;]*m/.exec(ansi.slice(i, i + 32));
		if (esc) {
			out += esc[0];
			i += esc[0].length;
		} else {
			if (dropped < count) dropped++;
			else out += ansi[i];
			i++;
		}
	}
	return out;
}

/** Recolour the brackets at visible columns in `colors`, then put the highlighting back. */
function colourBrackets(ansi: string, colors: Map<number, string>, plain: string): string {
	if (colors.size === 0) return ansi;
	let out = "";
	let active = "";
	let col = 0;
	for (let i = 0; i < ansi.length; ) {
		const esc = /^\x1b\[[0-9;]*m/.exec(ansi.slice(i, i + 32));
		if (esc) {
			out += esc[0];
			active = /^\x1b\[(0|39)?m$/.test(esc[0]) ? "" : active + esc[0];
			i += esc[0].length;
			continue;
		}
		const color = colors.get(col);
		out += color ? `${color}${ansi[i]}${plain}${active}` : ansi[i];
		col++;
		i++;
	}
	return out;
}

/** Keep `bg` on across the highlighter's resets. */
function keepBackground(ansi: string, bg: string): string {
	return bg + ansi.replace(/\x1b\[(0|49)?m/g, (m) => m + bg);
}

function renderPanel(token: Token, width: number, theme: Theme): string[] {
	const lang = (token.lang ?? "").trim().split(/\s/)[0]!.toLowerCase();
	const raw = token.text.replace(/\t/g, TAB).split("\n");
	const code = raw.join("\n");
	const style = currentStyle(theme);
	const highlighted = highlight(code, lang, style) ?? highlightCode(code, lang || undefined).map(style.remap);
	const border = (s: string) => `${style.border}${s}\x1b[39m`;

	// Indent: blank lines take the smaller indent of their neighbours, so guides run through them.
	const lead = raw.map((l) => (l.trim() ? l.length - l.trimStart().length : -1));
	for (let i = 0; i < lead.length; i++) {
		if (lead[i]! >= 0) continue;
		const before = lead.slice(0, i).reverse().find((n) => n >= 0) ?? 0;
		const after = lead.slice(i + 1).find((n) => n >= 0) ?? 0;
		lead[i] = Math.min(before, after);
	}
	const unit = Math.max(2, Math.min(...lead.filter((n) => n > 0), 8));
	const brackets = scanBrackets(raw, lang);

	const numbered = raw.length > 1;
	const numWidth = numbered ? String(raw.length).length : 0;
	const gutter = numbered ? numWidth + 2 : 0;
	const inner = width - 4;
	const codeWidth = inner - gutter;
	if (codeWidth < 10) return [];

	const label = lang ? ` ${style.label}${lang}\x1b[39m ` : "";
	const out = [border("╭─") + label + border(`${"─".repeat(Math.max(0, width - 3 - visibleWidth(label)))}╮`)];
	raw.forEach((_, i) => {
		const indent = lead[i]!;
		const guides = Array.from({ length: indent }, (_, c) => (c % unit === 0 ? `${style.guide}│${style.plain}` : " ")).join("");
		const colors = new Map<number, string>();
		for (const [col, depth] of brackets[i]!) {
			if (col >= indent) colors.set(col - indent, depth < 0 ? style.unmatched : style.brackets[depth % style.brackets.length]!);
		}
		const code = colourBrackets(dropColumns(highlighted[i] ?? "", indent), colors, style.plain);
		const parts = wrapTextWithAnsi(guides + code, codeWidth);
		parts.forEach((part, k) => {
			const num = numbered ? `${style.lineNumber}${k === 0 ? String(i + 1).padStart(numWidth) : " ".repeat(numWidth)}  ${style.plain}` : "";
			const fill = " ".repeat(Math.max(0, codeWidth - visibleWidth(part)));
			out.push(`${border("│")}${keepBackground(` ${num}${part}${fill} `, style.background)}\x1b[49m${border("│")}`);
		});
	});
	out.push(border(`╰${"─".repeat(Math.max(0, width - 2))}╯`));
	return out;
}

const proto = Markdown.prototype as unknown as MarkdownInternals & {
	[ORIGINAL]?: MarkdownInternals["renderToken"];
	[ORIGINAL_RENDER]?: MarkdownInternals["render"];
};
const renderToken = (proto[ORIGINAL] ??= proto.renderToken);
const render = (proto[ORIGINAL_RENDER] ??= proto.render);

proto.render = function (this: MarkdownInternals, width) {
	if (this[GENERATION] !== generation) {
		this[GENERATION] = generation;
		this.invalidate();
	}
	return render.call(this, width);
};

proto.renderToken = function (this: MarkdownInternals, token, width, nextTokenType, styleContext) {
	const theme = ui?.theme;
	if (theme && token.type === "code") {
		const lines = renderPanel(token, width, theme);
		if (lines.length) {
			if (nextTokenType && nextTokenType !== "space") lines.push("");
			return lines;
		}
	}
	return renderToken.call(this, token, width, nextTokenType, styleContext);
};

const redraw = () => {
	generation++;
	screen?.requestRender();
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("code-theme", {
		description: "Pick the colour theme of code blocks (saved for later sessions)",
		getArgumentCompletions: (prefix) =>
			themeChoices()
				.map(([name]) => name)
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({ value: name, label: name })),
		handler: async (args, ctx) => {
			let name = args.trim();
			if (!name) {
				const options = [`${DEFAULT_THEME} · Visual Studio, light or dark to match pi`];
				for (const [theme, description] of themeChoices()) options.push(description ? `${theme} · ${description}` : theme);
				const pick = await ctx.ui.select(`Code theme (now: ${chosenTheme()})`, options);
				if (pick === undefined) return;
				name = pick.split(" · ")[0]!;
			}
			const parts = name.split("/").map((part) => part.trim());
			if (parts.length > 2 || !parts.every(knownTheme)) {
				const names = themeChoices().map(([theme]) => theme).join(", ");
				return ctx.ui.notify(`Unknown code theme ${name} (${names}; or light/dark)`, "error");
			}
			saveTheme(parts.join("/"));
			redraw();
			ctx.ui.notify(`Code theme: ${parts.join("/")}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ui = ctx.ui;
		// An empty widget, only to get the TUI for redraws.
		ctx.ui.setWidget("code-blocks", (tui) => {
			screen = tui;
			return { render: () => [], invalidate() {} };
		});
		load(redraw);
	});
}
