/**
 * Animated, colorful status glyphs in the pi logo's colors (coral, yellow, blue).
 * Frames are derived from the clock, so any redraw shows the current frame; the
 * caller only has to redraw often (see FRAME_MS).
 */
import { type Color, foregroundAnsi, getTerminalColorMode, mixColors, rgbColor } from "@earendil-works/pi-tui";

export const FRAME_MS = 80;

// From pi's own logo (easter-egg-3d.js).
const LOGO: Color[] = [rgbColor(228, 138, 122), rgbColor(234, 182, 93), rgbColor(79, 142, 179)];
const STEPS = 48; // gradient resolution around the full cycle
const CYCLE_MS = 2400; // one trip coral → yellow → blue → coral
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const RESET = "\x1b[39m";

let ramp: string[] | undefined;

/** Foreground escape codes around the cyclic gradient, built once (mode is fixed per terminal). */
function colors(): string[] {
	if (ramp) return ramp;
	const mode = getTerminalColorMode();
	ramp = [];
	for (let i = 0; i < STEPS; i++) {
		const pos = (i / STEPS) * LOGO.length;
		const from = Math.floor(pos);
		const color = mixColors(LOGO[from]!, LOGO[(from + 1) % LOGO.length]!, pos - from, "oklch");
		ramp.push(foregroundAnsi(color, mode));
	}
	return ramp;
}

/** Color at the current time, shifted by `offset` (a fraction of the cycle). */
function at(offset: number, now: number): string {
	const c = colors();
	const t = (((now / CYCLE_MS + offset) % 1) + 1) % 1; // offset may be negative
	return c[Math.floor(t * c.length)]!;
}

/** A single spinner glyph that cycles through the logo colors. */
export function spinner(now = Date.now()): string {
	return `${at(0, now)}${SPINNER[Math.floor(now / FRAME_MS) % SPINNER.length]}${RESET}`;
}

/** `text` with the logo gradient sweeping across it. */
export function shimmer(text: string, now = Date.now()): string {
	const chars = [...text];
	// Spread the gradient over about one word, flowing right to left so it reads as moving forward.
	const spread = 1 / Math.max(8, chars.length * 1.5);
	return chars.map((ch, i) => (ch === " " ? ch : `${at(-i * spread, now)}${ch}`)).join("") + RESET;
}
