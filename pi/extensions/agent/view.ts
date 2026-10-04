/**
 * Agent UI pieces: the one-line-per-agent widget text, the agent switcher
 * overlay (Alt+A or /agents), and the live transcript tail shown in an
 * expanded agent tool block.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	matchesKey,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { Run } from "./index.ts";
import { FRAME_MS, spinner } from "./shimmer.ts";

export function elapsed(run: Run): string {
	if (!run.startedAt) return "queued";
	const s = Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

const ICON: Record<Run["status"], string> = { queued: "…", running: "⏳", done: "✓", failed: "✗", stopped: "■" };

/** Queued, running, or done but still in a review pipeline (`stage`). */
export function isLive(run: Run): boolean {
	return run.status === "queued" || run.status === "running" || !!run.stage;
}

/** `animate`: a working agent gets the colored spinner instead of a static glyph. */
export function statusIcon(run: Run, animate = false): string {
	return animate && (run.status === "running" || run.stage) ? spinner() : ICON[run.status];
}

function count(n: number): string {
	return n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`;
}

const usageCache = new WeakMap<Run, { at: number; text: string }>();

/** Tokens used so far and context fill, e.g. "↑41k ↓2.3k · ctx 18%"; empty before the session exists. */
export function usage(run: Run): string {
	if (!run.session) return "";
	// Animation redraws many times a second; the stats only change per model response.
	const hit = usageCache.get(run);
	if (hit && Date.now() - hit.at < 500) return hit.text;
	const text = computeUsage(run.session);
	usageCache.set(run, { at: Date.now(), text });
	return text;
}

function computeUsage(session: NonNullable<Run["session"]>): string {
	try {
		const t = session.getSessionStats().tokens;
		const ctx = session.getContextUsage();
		const parts = [`↑${count(t.input + t.cacheRead + t.cacheWrite)} ↓${count(t.output)}`];
		if (ctx?.percent != null) parts.push(`ctx ${Math.round(ctx.percent)}%`);
		return parts.join(" · ");
	} catch {
		return ""; // session disposed
	}
}

/** `animate` for live UI only; the plain form is stored in tool results and used in menus. */
export function oneLine(run: Run, animate = false): string {
	return `${statusIcon(run, animate)} ${lineBody(run)}`;
}

/** oneLine without the status icon, for callers that style the two separately. */
export function lineBody(run: Run): string {
	const who = run.personality ? `${run.id} ${run.personality}` : run.id;
	const parts = [who, run.description, `${run.toolCalls} tools`, usage(run), elapsed(run)].filter(Boolean);
	if (run.stage) parts.push(`${run.stage}${run.reviewer ? ` (${run.reviewer.id})` : ""}`);
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

/** One transcript message as wrapped lines plus a blank separator; [] for messages not shown. */
function messageLines(m: unknown, theme: Theme, width: number, fullTools: boolean): string[] {
	const out: string[] = [];
	const add = (text: string, color?: Parameters<Theme["fg"]>[0]) => {
		for (const l of wrapTextWithAnsi(text, width)) out.push(color ? theme.fg(color, l) : l);
	};
	const msg = m as { role?: string; content?: unknown; toolName?: string; isError?: boolean };
	if (msg.role === "user") {
		add(theme.bold("Task"), "accent");
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
		const shown = fullTools || lines.length <= 3 ? text : `${lines.slice(0, 3).join("\n")}\n… (${lines.length} lines)`;
		add(shown || "(no output)", msg.isError ? "error" : "dim");
	} else return out;
	out.push("");
	return out;
}

/** Placeholder text for a run without a session to show. */
function noTranscript(run: Run): string {
	if (run.expired) return `Session closed to free resources.${run.transcript ? ` Transcript file: ${run.transcript}` : ""}`;
	return run.status === "queued" ? "Waiting for a free slot…" : (run.error ?? "");
}

/** The whole transcript as wrapped lines. */
export function transcriptLines(run: Run, theme: Theme, width: number, fullTools = false): string[] {
	if (!run.session) return [theme.fg("dim", noTranscript(run))];
	return run.session.messages.flatMap((m) => messageLines(m, theme, width, fullTools));
}

/** The last `n` transcript lines, rendering only as many messages from the end as needed. */
export function tailLines(run: Run, theme: Theme, width: number, n: number): string[] {
	if (!run.session) return [theme.fg("dim", noTranscript(run))];
	const msgs = run.session.messages;
	let out: string[] = [];
	for (let i = msgs.length - 1; i >= 0 && out.length <= n; i--) out = [...messageLines(msgs[i], theme, width, false), ...out];
	while (out.length && out[out.length - 1] === "") out.pop();
	return out.slice(-n);
}

/**
 * Expanded tool block for an agent: status line plus a live tail of its transcript.
 * Stateless, so every render shows the current state.
 */
export class AgentTail implements Component {
	private run: Run;
	private theme: Theme;
	private lines: number;

	constructor(run: Run, theme: Theme, lines: number) {
		this.run = run;
		this.theme = theme;
		this.lines = lines;
	}

	render(width: number): string[] {
		const th = this.theme;
		const w = Math.max(10, width);
		const head = truncateToWidth(`${statusIcon(this.run, true)} ${th.fg("dim", lineBody(this.run))}`, w, "…");
		const body = tailLines(this.run, th, w - 2, this.lines).map((l) => `${th.fg("borderMuted", "│")} ${l}`);
		const hint = th.fg("dim", `last ${this.lines} lines · Alt+A or /agents ${this.run.id} for the full history · click to collapse`);
		return [head, ...body, truncateToWidth(hint, w, "…")];
	}

	invalidate(): void {}
}

/**
 * Full-screen agent switcher, like Claude Code's: a tab per agent, ←/→ to switch,
 * the selected agent's whole transcript below, live while it runs.
 */
export class AgentSwitcher implements Component {
	private id: string;
	private scroll = 0; // lines up from the bottom
	private fullTools = false;
	private tabHits: Array<{ from: number; to: number; id: string }> = [];
	private cache?: { key: string; lines: string[] };
	private timer: ReturnType<typeof setInterval>;
	private runs: () => Run[];
	private tui: TUI;
	private theme: Theme;
	private close: () => void;
	private stop: (run: Run) => void;

	constructor(runs: () => Run[], startId: string, tui: TUI, theme: Theme, close: () => void, stop: (run: Run) => void) {
		this.runs = runs;
		this.id = startId;
		this.tui = tui;
		this.theme = theme;
		this.close = close;
		this.stop = stop;
		// Redraw for the spinners and for transcript growth.
		this.timer = setInterval(() => this.tui.requestRender(), FRAME_MS);
	}

	dispose(): void {
		clearInterval(this.timer);
	}

	private list(): Run[] {
		return this.runs();
	}

	private current(): Run | undefined {
		const list = this.list();
		return list.find((r) => r.id === this.id) ?? list[list.length - 1];
	}

	private select(delta: number): void {
		const list = this.list();
		if (!list.length) return;
		const i = Math.max(0, list.findIndex((r) => r.id === this.current()?.id));
		this.id = list[(i + delta + list.length) % list.length]!.id;
		this.scroll = 0;
	}

	handleInput(data: string): void {
		const page = Math.max(1, this.height() - 7);
		if (matchesKey(data, "escape") || data === "q") return this.close();
		if (matchesKey(data, "left") || data === "h" || matchesKey(data, "shift+tab")) this.select(-1);
		else if (matchesKey(data, "right") || data === "l" || matchesKey(data, "tab")) this.select(1);
		else if (matchesKey(data, "up") || data === "k") this.scroll += 1;
		else if (matchesKey(data, "down") || data === "j") this.scroll = Math.max(0, this.scroll - 1);
		else if (matchesKey(data, "pageUp")) this.scroll += page;
		else if (matchesKey(data, "pageDown")) this.scroll = Math.max(0, this.scroll - page);
		else if (data === "g") this.scroll = Number.MAX_SAFE_INTEGER; // clamped in render
		else if (data === "G") this.scroll = 0;
		else if (data === "e") this.fullTools = !this.fullTools;
		else if (data === "s") {
			const run = this.current();
			if (run) this.stop(run);
		} else return;
		this.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel" && event.wheelDelta) {
			this.scroll = Math.max(0, this.scroll - event.wheelDelta);
			return { handled: true };
		}
		if (event.type === "click" && event.button === "left" && event.y === 1) {
			const hit = this.tabHits.find((t) => event.x >= t.from && event.x < t.to);
			if (hit) {
				this.id = hit.id;
				this.scroll = 0;
				return { handled: true };
			}
		}
		return undefined;
	}

	private height(): number {
		return Math.max(12, Math.floor((process.stdout.rows || 40) * 0.85));
	}

	/** Tab strip that keeps the selected tab visible; records click ranges (x relative to the overlay). */
	private tabs(list: Run[], sel: Run | undefined, inner: number): string {
		const th = this.theme;
		const labels = list.map((r) => ({ run: r, text: ` ${statusIcon(r, true)} ${r.id} ${r.description} ` }));
		const widths = labels.map((l) => Math.min(visibleWidth(l.text), 28));
		const si = Math.max(0, list.findIndex((r) => r === sel));
		let start = si;
		let used = widths[si] ?? 0;
		while (start > 0 && used + widths[start - 1]! + 1 <= inner) used += widths[--start]! + 1;
		let out = "";
		let x = 2; // after "│ "
		this.tabHits = [];
		for (let i = start; i < labels.length; i++) {
			const w = widths[i]!;
			if (visibleWidth(out) + w > inner) break;
			const text = truncateToWidth(labels[i]!.text, w, "…");
			out += i === si ? th.bg("selectedBg", th.bold(text)) : th.fg("muted", text);
			this.tabHits.push({ from: x, to: x + w, id: labels[i]!.run.id });
			out += " ";
			x += w + 1;
		}
		return out;
	}

	private transcript(run: Run, width: number): string[] {
		const key = `${run.id}|${run.session?.messages.length ?? -1}|${run.status}|${width}|${this.fullTools}`;
		if (this.cache?.key !== key) this.cache = { key, lines: transcriptLines(run, this.theme, width, this.fullTools) };
		return this.cache.lines;
	}

	render(width: number): string[] {
		const th = this.theme;
		const inner = Math.max(20, width - 4);
		const h = this.height();
		const list = this.list();
		const run = this.current();
		const row = (s: string) => `${th.fg("border", "│")} ${truncateToWidth(s, inner, "…", true)} ${th.fg("border", "│")}`;
		const title = " Agents ";
		const top = th.fg("border", "╭─") + th.fg("accent", th.bold(title)) + th.fg("border", `${"─".repeat(Math.max(0, inner + 1 - visibleWidth(title)))}╮`);
		const bottom = th.fg("border", `╰${"─".repeat(inner + 2)}╯`);
		if (!run) return [top, row(th.fg("dim", "No agents in this session. Esc to close.")), bottom];

		const view = h - 7; // top, tabs, status, rule, (view), hint, bottom
		const body = this.transcript(run, inner);
		this.scroll = Math.min(this.scroll, Math.max(0, body.length - view));
		const end = body.length - this.scroll;
		const shown = body.slice(Math.max(0, end - view), end);
		while (shown.length < view) shown.push("");
		const hints = [
			this.scroll > 0 && `${this.scroll} lines up`,
			list.length > 1 && "←→ agent",
			"↑↓/wheel scroll",
			"g/G top/bottom",
			`e ${this.fullTools ? "short" : "full"} tool output`,
			isLive(run) && "s stop",
			"Esc close",
		].filter(Boolean);
		return [
			top,
			row(this.tabs(list, run, inner)),
			row(`${statusIcon(run, true)} ${th.fg("dim", lineBody(run))}`),
			row(th.fg("borderMuted", "─".repeat(inner))),
			...shown.map(row),
			row(th.fg("dim", hints.join(" · "))),
			bottom,
		];
	}

	invalidate(): void {
		this.cache = undefined;
	}
}
