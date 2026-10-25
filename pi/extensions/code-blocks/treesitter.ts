/**
 * Tree-sitter syntax highlighting for code blocks, from the files pinned in
 * `vendor/` (web-tree-sitter, grammar .wasm files and their highlight
 * queries; see `vendor/manifest`). Everything is read from disk and handed
 * to tree-sitter as bytes: nothing is fetched or sent anywhere.
 *
 * `load()` reads the grammars in the background; until a language is ready
 * (or if it fails), `highlight()` returns undefined and the caller falls
 * back to pi's highlight.js. Captures map onto the theme's `syntax*`
 * colours. Where captures overlap, the smaller node wins, and for the same
 * node the later pattern (the queries list generic patterns first).
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Language, Parser, Query } from "web-tree-sitter";

type ThemeColor = Parameters<Theme["getFgAnsi"]>[0];

const VENDOR = fileURLToPath(new URL("./vendor/", import.meta.url));

// Grammar file and its queries, generic first. typescript and cpp use the
// javascript and c queries of the versions they depend on.
const JS_023 = "tree-sitter-javascript@0.23.1";
const GRAMMARS: Record<string, { wasm: string; queries: string[] }> = {
	bash: { wasm: "bash", queries: ["tree-sitter-bash@0.25.1/highlights.scm"] },
	c: { wasm: "c", queries: ["tree-sitter-c@0.24.2/highlights.scm"] },
	cpp: { wasm: "cpp", queries: ["tree-sitter-c@0.23.6/highlights.scm", "tree-sitter-cpp@0.23.4/highlights.scm"] },
	go: { wasm: "go", queries: ["tree-sitter-go@0.25.0/highlights.scm"] },
	javascript: {
		wasm: "javascript",
		queries: ["highlights.scm", "highlights-jsx.scm", "highlights-params.scm"].map((f) => `tree-sitter-javascript@0.25.0/${f}`),
	},
	json: { wasm: "json", queries: ["tree-sitter-json@0.24.8/highlights.scm"] },
	lua: { wasm: "lua", queries: ["tree-sitter-lua@0.5.0/highlights.scm"] },
	python: { wasm: "python", queries: ["tree-sitter-python@0.25.0/highlights.scm"] },
	rust: { wasm: "rust", queries: ["tree-sitter-rust@0.24.2/highlights.scm"] },
	tsx: {
		wasm: "tsx",
		queries: [`${JS_023}/highlights.scm`, `${JS_023}/highlights-jsx.scm`, "tree-sitter-typescript@0.23.2/highlights.scm"],
	},
	typescript: { wasm: "typescript", queries: [`${JS_023}/highlights.scm`, "tree-sitter-typescript@0.23.2/highlights.scm"] },
};

// Fence languages that name one of the grammars.
const ALIASES: Record<string, string> = {
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	console: "bash",
	h: "c",
	"c++": "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	hh: "cpp",
	golang: "go",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsonc: "json",
	py: "python",
	python3: "python",
	rs: "rust",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
};

// Capture name (or its first parts) -> theme colour; "" leaves the text plain.
const COLORS = new Map<string, ThemeColor | "">([
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

type Lib = typeof import("web-tree-sitter");
interface Loaded {
	language: Language;
	query: Query;
}

let parser: Parser | undefined;
const ready = new Map<string, Loaded>();
let started = false;

/** The grammar for a fence language, if there is one. */
export function grammarFor(lang: string): string | undefined {
	const name = ALIASES[lang] ?? lang;
	return GRAMMARS[name] ? name : undefined;
}

/** Load web-tree-sitter and every grammar in the background; `done` runs after each one is ready. */
export function load(done: () => void): void {
	if (started) return;
	started = true;
	void (async () => {
		try {
			const lib = (await import(pathToFileURL(`${VENDOR}web-tree-sitter/web-tree-sitter.js`).href)) as Lib;
			// Handing it the bytes keeps it from looking the file up itself.
			await lib.Parser.init({ wasmBinary: readFileSync(`${VENDOR}web-tree-sitter/web-tree-sitter.wasm`) } as object);
			parser = new lib.Parser();
			for (const [name, grammar] of Object.entries(GRAMMARS)) {
				try {
					const language = await lib.Language.load(new Uint8Array(readFileSync(`${VENDOR}grammars/tree-sitter-${grammar.wasm}.wasm`)));
					const source = grammar.queries.map((q) => readFileSync(`${VENDOR}queries/${q}`, "utf8")).join("\n");
					ready.set(name, { language, query: new lib.Query(language, source) });
					done();
				} catch {
					// That language stays on highlight.js.
				}
			}
		} catch {
			// No tree-sitter at all: everything stays on highlight.js.
		}
	})();
}

function colorFor(capture: string, theme: Theme): string | undefined {
	for (let name = capture; name; name = name.slice(0, Math.max(0, name.lastIndexOf(".")))) {
		const color = COLORS.get(name);
		if (color !== undefined) return color ? theme.getFgAnsi(color) : "";
		if (!name.includes(".")) break;
	}
	return undefined;
}

/** Highlighted lines of `code`, or undefined when the language has no grammar ready. */
export function highlight(code: string, lang: string, theme: Theme): string[] | undefined {
	const name = grammarFor(lang);
	const grammar = name ? ready.get(name) : undefined;
	if (!grammar || !parser) return undefined;
	parser.setLanguage(grammar.language);
	const tree = parser.parse(code);
	if (!tree) return undefined;
	try {
		const color: (string | undefined)[] = new Array(code.length);
		const size: number[] = new Array(code.length);
		const pattern: number[] = new Array(code.length);
		for (const capture of grammar.query.captures(tree.rootNode)) {
			const ansi = colorFor(capture.name, theme);
			if (ansi === undefined) continue;
			const { startIndex: start, endIndex: end } = capture.node;
			const span = end - start;
			for (let i = start; i < end && i < code.length; i++) {
				const s = size[i];
				if (s === undefined || span < s || (span === s && capture.patternIndex >= pattern[i]!)) {
					color[i] = ansi;
					size[i] = span;
					pattern[i] = capture.patternIndex;
				}
			}
		}
		const lines: string[] = [];
		let line = "";
		let current = "";
		for (let i = 0; i < code.length; i++) {
			const ch = code[i]!;
			if (ch === "\n") {
				lines.push(current ? `${line}\x1b[39m` : line);
				line = current;
				continue;
			}
			const want = color[i] ?? "";
			if (want !== current) {
				line += want || "\x1b[39m";
				current = want;
			}
			line += ch;
		}
		lines.push(current ? `${line}\x1b[39m` : line);
		return lines;
	} finally {
		tree.delete();
	}
}
