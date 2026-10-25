/**
 * Code themes for the code-block panels: the JSON files in `themes/` (name =
 * file name), plus `pi`, which follows pi's own theme (its `syntax*`
 * colours, a tint of the terminal's background). The choice is saved in
 * `code-blocks.json` in pi's agent dir; `light/dark` picks by pi's theme
 * appearance, like pi's own theme setting.
 *
 * A theme file sets the panel's colours and maps tree-sitter capture names
 * (`keyword`, `function.method`, ...) to colours; a capture not listed uses
 * its first parts (`function.method` -> `function`), and one with no match
 * is left to the captures around it. `keyword.control` colours keywords
 * that change control flow (if, return, ...), as Visual Studio does.
 *
 *   {
 *     "description": "Visual Studio 2022 Dark",
 *     "background": "#1e1e1e",            panel background (null: a tint of the terminal's)
 *     "text": "#dcdcdc",                  plain code
 *     "lineNumber": "#2b91af", "guide": "#404040", "border": "#3f3f46", "label": "#9b9b9b",
 *     "brackets": ["#ffd700", "#da70d6", "#179fff"], "unmatched": "#f44747",
 *     "syntax": { "keyword": "#569cd6", "keyword.control": "#d8a0df", ... }
 *   }
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { backgroundAnsi, foregroundAnsi, mixColors, parseColor } from "@earendil-works/pi-tui";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type ThemeColor = Parameters<Theme["getFgAnsi"]>[0];

export const DEFAULT_THEME = "vs-light/vs-dark";
const THEMES_DIR = fileURLToPath(new URL("./themes/", import.meta.url));
const configPath = () => join(getAgentDir(), "code-blocks.json");
// How far the `pi` panel's background moves from the terminal's toward the text colour.
const TINT = 0.08;
// Bracket colours for `pi`, VS Code's defaults.
const PI_BRACKETS = {
	dark: ["#ffd700", "#da70d6", "#179fff"],
	light: ["#0431fa", "#319331", "#7b3814"],
};

/** How a panel and its code are coloured; all colours are ANSI sequences. */
export interface Style {
	background: string;
	/** Foreground of plain code. */
	plain: string;
	lineNumber: string;
	guide: string;
	border: string;
	label: string;
	brackets: string[];
	unmatched: string;
	/** Colour for a capture over `text`: "" plain, undefined no say. */
	color(capture: string, text: string): string | undefined;
	/** pi's highlight.js output recoloured for this style. */
	remap(ansi: string): string;
}

interface ThemeFile {
	description?: string;
	background?: string | null;
	text: string;
	lineNumber: string;
	guide: string;
	border: string;
	label: string;
	brackets: string[];
	unmatched: string;
	syntax: Record<string, string>;
}

// Captures of keywords, and the keywords among them that change control flow.
const KEYWORDISH = /^(keyword|conditional|repeat|exception)(\.|$)/;
const CONTROL = new Set(
	"if else elif for foreach while do switch case default break continue return goto try catch finally throw raise except yield await match loop then fi done esac".split(
		" ",
	),
);

// `pi`: capture -> pi theme colour; "" leaves the text plain.
const PI_COLORS = new Map<string, ThemeColor | "">([
	["comment", "syntaxComment"],
	["keyword", "syntaxKeyword"],
	["conditional", "syntaxKeyword"],
	["repeat", "syntaxKeyword"],
	["include", "syntaxKeyword"],
	["exception", "syntaxKeyword"],
	["preproc", "syntaxKeyword"],
	["label", "syntaxKeyword"],
	["tag", "syntaxKeyword"],
	["variable.builtin", "syntaxKeyword"],
	["operator", "syntaxOperator"],
	["string", "syntaxString"],
	["string.special.key", "syntaxVariable"],
	["escape", "syntaxNumber"],
	["string.escape", "syntaxNumber"],
	["character", "syntaxString"],
	["number", "syntaxNumber"],
	["float", "syntaxNumber"],
	["boolean", "syntaxNumber"],
	["constant", "syntaxNumber"],
	["function", "syntaxFunction"],
	["method", "syntaxFunction"],
	["attribute", "syntaxFunction"],
	["constructor", "syntaxType"],
	["type", "syntaxType"],
	["module", "syntaxType"],
	["namespace", "syntaxType"],
	["variable", ""],
	["property", ""],
	["field", ""],
	["parameter", ""],
	["punctuation", "syntaxPunctuation"],
	["delimiter", "syntaxPunctuation"],
]);

// pi's syntax colours, as highlight.js uses them, and the capture each stands for.
const HLJS: [ThemeColor, string][] = [
	["syntaxComment", "comment"],
	["syntaxString", "string"],
	["syntaxNumber", "number"],
	["syntaxKeyword", "keyword"],
	["syntaxFunction", "function"],
	["syntaxType", "type"],
	["syntaxOperator", "operator"],
	["syntaxPunctuation", "punctuation"],
	["syntaxVariable", "variable"],
	["mdCodeBlock", ""],
];

function lookup<T>(map: Map<string, T>, capture: string): T | undefined {
	for (let name = capture; ; ) {
		const value = map.get(name);
		if (value !== undefined) return value;
		const dot = name.lastIndexOf(".");
		if (dot < 0) return undefined;
		name = name.slice(0, dot);
	}
}

function readThemes(): Map<string, ThemeFile> {
	const themes = new Map<string, ThemeFile>();
	try {
		for (const file of readdirSync(THEMES_DIR).sort()) {
			if (!file.endsWith(".json")) continue;
			try {
				themes.set(file.slice(0, -5), JSON.parse(readFileSync(join(THEMES_DIR, file), "utf8")) as ThemeFile);
			} catch {
				// A broken theme file is left out.
			}
		}
	} catch {
		// No themes dir: only `pi`.
	}
	return themes;
}

const themes = readThemes();

/** Theme names to choose from, with a description. */
export function themeChoices(): [string, string][] {
	return [["pi", "pi's own theme colours"], ...[...themes].map(([name, t]): [string, string] => [name, t.description ?? ""])];
}

export function knownTheme(name: string): boolean {
	return name === "pi" || themes.has(name);
}

function readChoice(): string {
	try {
		const theme = JSON.parse(readFileSync(configPath(), "utf8")).theme;
		return typeof theme === "string" && theme ? theme : DEFAULT_THEME;
	} catch {
		return DEFAULT_THEME;
	}
}

let choice = readChoice();

export function chosenTheme(): string {
	return choice;
}

export function saveTheme(theme: string): void {
	writeFileSync(configPath(), `${JSON.stringify({ theme }, null, 2)}\n`);
	choice = theme;
	cached = undefined;
}

/** highlight.js output with pi's syntax colours swapped for `color`'s. */
function remapper(pi: Theme, plain: string, color: (capture: string) => string | undefined): (ansi: string) => string {
	const swap = new Map<string, string>();
	for (const [token, capture] of HLJS) {
		const ansi = pi.getFgAnsi(token);
		if (!swap.has(ansi)) swap.set(ansi, capture ? (color(capture) ?? plain) || plain : plain);
	}
	return (ansi) =>
		plain +
		ansi.replace(/\x1b\[[0-9;]*m/g, (seq) => {
			if (seq === "\x1b[39m") return plain;
			if (seq === "\x1b[0m" || seq === "\x1b[m") return seq + plain;
			return swap.get(seq) ?? seq;
		});
}

function piStyle(pi: Theme): Style {
	const mode = pi.getColorMode();
	const colors = pi.colors;
	return {
		// toolPendingBg is "" in the Claude themes: the terminal's own background.
		background: backgroundAnsi(mixColors(colors.toolPendingBg, colors.text, TINT, "srgb"), mode),
		plain: "\x1b[39m",
		lineNumber: pi.getFgAnsi("dim"),
		guide: pi.getFgAnsi("dim"),
		border: pi.getFgAnsi("mdCodeBlockBorder"),
		label: pi.getFgAnsi("muted"),
		brackets: PI_BRACKETS[pi.appearance === "light" ? "light" : "dark"].map((hex) => foregroundAnsi(parseColor(hex), mode)),
		unmatched: foregroundAnsi(colors.error, mode),
		color(capture) {
			const color = lookup(PI_COLORS, capture);
			return color === undefined ? undefined : color ? pi.getFgAnsi(color) : "";
		},
		remap: (ansi) => ansi,
	};
}

function fileStyle(pi: Theme, file: ThemeFile): Style {
	const mode = pi.getColorMode();
	const fg = (hex: string) => foregroundAnsi(parseColor(hex), mode);
	const syntax = new Map(Object.entries(file.syntax ?? {}).map(([capture, hex]) => [capture, fg(hex)]));
	const plain = fg(file.text);
	const color = (capture: string, text: string) => {
		if (KEYWORDISH.test(capture) && CONTROL.has(text)) {
			const control = syntax.get("keyword.control");
			if (control) return control;
		}
		return lookup(syntax, capture);
	};
	return {
		background: file.background ? backgroundAnsi(parseColor(file.background), mode) : piStyle(pi).background,
		plain,
		lineNumber: fg(file.lineNumber),
		guide: fg(file.guide),
		border: fg(file.border),
		label: fg(file.label),
		brackets: file.brackets.map(fg),
		unmatched: fg(file.unmatched),
		color,
		remap: remapper(pi, plain, (capture) => color(capture, "")),
	};
}

let cached: { pi: Theme; choice: string; style: Style } | undefined;

/** The style for the chosen code theme under pi's theme `pi`. */
export function currentStyle(pi: Theme): Style {
	if (cached && cached.pi === pi && cached.choice === choice) return cached.style;
	const [light, dark] = choice.includes("/") ? choice.split("/", 2) : [choice, choice];
	const name = (pi.appearance === "light" ? light : dark)!.trim();
	const file = themes.get(name);
	let style: Style;
	try {
		style = file ? fileStyle(pi, file) : piStyle(pi);
	} catch {
		// A theme file with a bad colour: fall back to pi's.
		style = piStyle(pi);
	}
	cached = { pi, choice, style };
	return style;
}
