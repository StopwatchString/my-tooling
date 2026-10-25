/**
 * Context bar: a line the width of the terminal, above the footer's status
 * line, that fills as the context does.
 *
 *   ━━━━━━━━━━━━━━━━━━━━━━╸───────────────────────────────────────────
 *
 * - Event `session_start`: hands the bar to `footer.ts` (TUI only), which
 *   draws it above its line, as the task view (`tasks/ui.ts`) does for an
 *   agent.
 * - Event `session_shutdown`: takes it back, so deleting this file and
 *   running /reload removes the bar.
 *
 * Filled cells shade from the theme's success colour through warning (at
 * 70%) to error (at 90% and up), by where they sit on the bar, so the tip
 * shows how close the context is to full. Half a cell of precision (`╸`).
 * The empty part is a dim rule. Experimental: delete the file to drop it.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Color, foregroundAnsi, mixColors } from "@earendil-works/pi-tui";

// Where the gradient reaches each colour, as a share of the bar.
const STOPS: [number, "success" | "warning" | "error"][] = [
	[0, "success"],
	[0.7, "warning"],
	[0.9, "error"],
];
const FULL = "━";
const HALF = "╸";
const EMPTY = "─";
const RESET_FG = "\x1b[39m";

type Bar = (percent: number | null | undefined, width: number, theme: Theme) => string;

const KEY = Symbol.for("my-tooling.footer");
const shared = globalThis as typeof globalThis & { [KEY]?: { bar?: Bar } };

/** The gradient's colour at `at` (0 to 1) along the bar. */
function colorAt(at: number, theme: Theme): Color {
	const colors = theme.colors;
	for (let i = 1; i < STOPS.length; i++) {
		const [end, to] = STOPS[i]!;
		const [start, from] = STOPS[i - 1]!;
		if (at <= end) return mixColors(colors[from], colors[to], (at - start) / (end - start), "oklch");
	}
	return colors[STOPS.at(-1)![1]];
}

const bar: Bar = (percent, width, theme) => {
	const halves = Math.round((Math.min(100, Math.max(0, percent ?? 0)) / 100) * width * 2);
	const full = Math.floor(halves / 2);
	const mode = theme.getColorMode();
	let out = "";
	for (let i = 0; i < full; i++) out += foregroundAnsi(colorAt((i + 0.5) / width, theme), mode) + FULL;
	if (halves % 2) out += foregroundAnsi(colorAt((full + 0.25) / width, theme), mode) + HALF;
	out += RESET_FG;
	const rest = width - full - (halves % 2);
	return rest > 0 ? out + theme.fg("borderMuted", EMPTY.repeat(rest)) : out;
};

export default function (pi: ExtensionAPI) {
	let mine = false;

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		(shared[KEY] ??= {}).bar = bar;
		mine = true;
	});

	pi.on("session_shutdown", async () => {
		if (mine && shared[KEY]?.bar === bar) delete shared[KEY].bar;
		mine = false;
	});
}
