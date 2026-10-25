/**
 * Tree-sitter syntax highlighting for code blocks, from the files pinned in
 * `vendor/` (web-tree-sitter, grammar .wasm files and their highlight
 * queries; see `vendor/manifest`). Everything is read from disk and handed
 * to tree-sitter as bytes: nothing is fetched or sent anywhere.
 *
 * `load()` reads the grammars in the background; until a language is ready
 * (or if it fails), `highlight()` returns undefined and the caller falls
 * back to pi's highlight.js. Captures get their colours from the code theme
 * (`themes.ts`). Where captures overlap, the smaller node wins, and for the same
 * node the later pattern (the queries list generic patterns first).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Language, Parser, Query } from "web-tree-sitter";
import type { Style } from "./themes.ts";

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

// Nodes some grammars capture as plain `type` that are built into the language.
const BUILTIN_TYPES = new Set(["primitive_type", "predefined_type", "builtin_type", "sized_type_specifier"]);

/** The capture name a theme sees: `type.builtin` for built-in types, `preproc` for `#include` and the like. */
function refine(capture: string, nodeType: string, text: string): string {
	if (capture === "type" && BUILTIN_TYPES.has(nodeType)) return "type.builtin";
	if (capture.startsWith("keyword") && text.startsWith("#")) return "preproc";
	return capture;
}

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

/** Highlighted lines of `code`, or undefined when the language has no grammar ready. */
export function highlight(code: string, lang: string, style: Style): string[] | undefined {
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
			const { startIndex: start, endIndex: end } = capture.node;
			const text = code.slice(start, end);
			const ansi = style.color(refine(capture.name, capture.node.type, text), text);
			if (ansi === undefined) continue;
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
		let line = style.plain;
		let current = "";
		for (let i = 0; i < code.length; i++) {
			const ch = code[i]!;
			if (ch === "\n") {
				lines.push(line);
				line = current || style.plain;
				continue;
			}
			const want = color[i] ?? "";
			if (want !== current) {
				line += want || style.plain;
				current = want;
			}
			line += ch;
		}
		lines.push(line);
		return lines;
	} finally {
		tree.delete();
	}
}
