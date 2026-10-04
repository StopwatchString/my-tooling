/**
 * Live transcript overlay for one subagent run (opened from /agents), and
 * the one-line-per-agent widget text.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Run } from "./index.ts";

export function elapsed(run: Run): string {
	if (!run.startedAt) return "queued";
	const s = Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

const ICON: Record<Run["status"], string> = { queued: "…", running: "⏳", done: "✓", failed: "✗", stopped: "■" };

export function statusIcon(run: Run): string {
	return ICON[run.status];
}

function count(n: number): string {
	return n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`;
}

/** Tokens used so far and context fill, e.g. "↑41k ↓2.3k · ctx 18%"; empty before the session exists. */
export function usage(run: Run): string {
	if (!run.session) return "";
	try {
		const t = run.session.getSessionStats().tokens;
		const ctx = run.session.getContextUsage();
		const parts = [`↑${count(t.input + t.cacheRead + t.cacheWrite)} ↓${count(t.output)}`];
		if (ctx?.percent != null) parts.push(`ctx ${Math.round(ctx.percent)}%`);
		return parts.join(" · ");
	} catch {
		return ""; // session disposed
	}
}

export function oneLine(run: Run): string {
	const who = run.personality ? `${run.id} ${run.personality}` : run.id;
	const parts = [`${statusIcon(run)} ${who}`, run.description, `${run.toolCalls} tools`, usage(run), elapsed(run)].filter(Boolean);
	if (run.status === "running" && run.activity) parts.push(run.activity);
	return parts.join(" · ");
}

type Block = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown };

function blocks(content: unknown): Block[] {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return Array.isArray(content) ? (content as Block[]) : [];
}

export function summarizeArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const a = args as Record<string, unknown>;
	const main = a.command ?? a.path ?? a.pattern ?? a.query ?? a.url ?? Object.values(a)[0];
	return typeof main === "string" ? main.replace(/\s+/g, " ") : JSON.stringify(main ?? "");
}

export class AgentView implements Component {
	private scroll = 0; // lines up from the bottom
	private run: Run;
	private tui: TUI;
	private theme: Theme;
	private close: () => void;

	constructor(run: Run, tui: TUI, theme: Theme, close: () => void) {
		this.run = run;
		this.tui = tui;
		this.theme = theme;
		this.close = close;
	}

	handleInput(data: string): void {
		const page = Math.max(1, this.height() - 4);
		if (matchesKey(data, "escape") || data === "q") return this.close();
		if (matchesKey(data, "up") || data === "k") this.scroll += 1;
		else if (matchesKey(data, "down") || data === "j") this.scroll = Math.max(0, this.scroll - 1);
		else if (matchesKey(data, "pageUp")) this.scroll += page;
		else if (matchesKey(data, "pageDown")) this.scroll = Math.max(0, this.scroll - page);
		else if (data === "G") this.scroll = 0;
		else return;
		this.tui.requestRender();
	}

	private height(): number {
		return Math.max(10, Math.floor((process.stdout.rows || 40) * 0.85));
	}

	private transcript(width: number): string[] {
		const th = this.theme;
		const out: string[] = [];
		const add = (text: string, color?: Parameters<Theme["fg"]>[0]) => {
			for (const l of wrapTextWithAnsi(text, width)) out.push(color ? th.fg(color, l) : l);
		};
		for (const m of this.run.session?.messages ?? []) {
			const msg = m as { role?: string; content?: unknown; toolName?: string; isError?: boolean };
			if (msg.role === "user") {
				add(th.bold("Task"), "accent");
				for (const b of blocks(msg.content)) if (b.text) add(b.text);
			} else if (msg.role === "assistant") {
				for (const b of blocks(msg.content)) {
					if (b.type === "text" && b.text?.trim()) add(b.text);
					else if (b.type === "toolCall") add(`→ ${b.name} ${summarizeArgs(b.arguments)}`, "accent");
				}
			} else if (msg.role === "toolResult") {
				const text = blocks(msg.content)
					.map((b) => b.text ?? "")
					.join("")
					.trim();
				const lines = text.split("\n");
				const shown = lines.slice(0, 3).join("\n") + (lines.length > 3 ? `\n… (${lines.length} lines)` : "");
				add(shown || "(no output)", msg.isError ? "error" : "dim");
			} else continue;
			out.push("");
		}
		if (!this.run.session) add(this.run.status === "queued" ? "Waiting for a free slot…" : (this.run.error ?? ""), "dim");
		return out;
	}

	render(width: number): string[] {
		const th = this.theme;
		const inner = Math.max(20, width - 4);
		const h = this.height();
		const body = this.transcript(inner);
		const view = h - 4;
		this.scroll = Math.min(this.scroll, Math.max(0, body.length - view));
		const end = body.length - this.scroll;
		const shown = body.slice(Math.max(0, end - view), end);
		while (shown.length < view) shown.push("");
		const row = (s: string) =>
			`${th.fg("border", "│")} ${truncateToWidth(s, inner, "…", true)} ${th.fg("border", "│")}`;
		const title = truncateToWidth(` ${oneLine(this.run)} `, inner + 2, "…", false);
		return [
			th.fg("border", "╭") + th.fg("accent", title) + th.fg("border", `${"─".repeat(Math.max(0, inner + 2 - visibleWidth(title)))}╮`),
			...shown.map(row),
			row(th.fg("dim", `↑↓/jk scroll · PgUp/PgDn · G bottom · Esc close${this.scroll ? ` · ${this.scroll} lines up` : ""}`)),
			th.fg("border", `╰${"─".repeat(inner + 2)}╯`),
		];
	}

	invalidate(): void {}
}
