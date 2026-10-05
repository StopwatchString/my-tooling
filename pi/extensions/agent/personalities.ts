/**
 * Subagent personalities: markdown files with frontmatter, read fresh on
 * every dispatch so edits apply without /reload.
 *
 *   ~/.pi/agent/agents/*.md   user-level (pi/agents/ in the dotfiles repo)
 *   <cwd>/.pi/agents/*.md     project-level, only in trusted projects; wins on name clash
 *
 *   ---
 *   name: reviewer                 # defaults to the file name
 *   description: Reviews a diff    # shown to the dispatching model
 *   tools: -write, -edit, +grep    # +add / -remove from the defaults; bare names = exact list
 *   model: home/swift              # provider/id; defaults to the main session's model
 *   thinking: high                 # defaults to the main session's level
 *   then: reviewer                 # after each finished task, this personality reviews it
 *   rounds: 2                      # most reviews per task; failed ones go back for fixes
 *   tester: tester                 # writes tests before the review when dispatched with tests: true
 *   merger: merger                 # rebases the work when the main branch moved before merge-back
 *   default: true                  # use for agents that may edit files and name no personality
 *   ---
 *   Extra system prompt, appended after the standard subagent brief.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type Personality = {
	name: string;
	description: string;
	tools?: string;
	model?: string;
	thinking?: string;
	then?: string;
	rounds?: number;
	tester?: string;
	merger?: string;
	default: boolean;
	prompt: string;
	path: string;
};

function parse(path: string): Personality | undefined {
	const text = readFileSync(path, "utf8");
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	const meta: Record<string, string> = {};
	for (const line of (m?.[1] ?? "").split(/\r?\n/)) {
		const kv = line.match(/^\s*([A-Za-z_]+)\s*:\s*(.*?)(?:\s+#.*)?\s*$/);
		if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.replace(/^(["'])(.*)\1$/, "$2");
	}
	const name = meta.name || basename(path, ".md");
	if (!/^[\w-]+$/.test(name)) return undefined;
	return {
		name,
		description: meta.description || "(no description)",
		tools: meta.tools || undefined,
		model: meta.model || undefined,
		thinking: meta.thinking || undefined,
		then: meta.then || undefined,
		rounds: Number(meta.rounds) >= 1 ? Math.floor(Number(meta.rounds)) : undefined,
		tester: meta.tester || undefined,
		merger: meta.merger || undefined,
		default: /^(true|yes)$/i.test(meta.default ?? ""),
		prompt: (m ? m[2]! : text).trim(),
		path,
	};
}

function loadDir(dir: string, into: Map<string, Personality>) {
	if (!existsSync(dir)) return;
	for (const f of readdirSync(dir).sort()) {
		if (!f.endsWith(".md")) continue;
		try {
			const p = parse(join(dir, f));
			if (p) into.set(p.name, p);
		} catch {
			// unreadable file: skip it rather than break dispatch
		}
	}
}

export function loadPersonalities(agentDir: string, cwd: string, projectTrusted: boolean): Map<string, Personality> {
	const out = new Map<string, Personality>();
	loadDir(join(agentDir, "agents"), out);
	if (projectTrusted) loadDir(join(cwd, ".pi", "agents"), out);
	return out;
}

/**
 * Turn a `tools` spec into createAgentSession options plus tools to activate
 * afterwards (`+name` for tools that are registered but inactive by default).
 */
export function toolOptions(spec: string | undefined, readonly: boolean) {
	const items = (spec ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const exact = items.filter((s) => !/^[+-]/.test(s));
	const add = items.filter((s) => s.startsWith("+")).map((s) => s.slice(1));
	const remove = items.filter((s) => s.startsWith("-")).map((s) => s.slice(1));
	if (readonly) remove.push("edit", "write");
	return {
		tools: exact.length ? [...exact, ...add] : undefined,
		exclude: [...new Set(remove)],
		add: exact.length ? [] : add,
	};
}
