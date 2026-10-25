/**
 * Working status in the style of Claude Code: an animated spinner with a
 * verb, elapsed time and output tokens while pi works, thinking kept out of
 * the transcript, and a summary line when the run is done.
 *
 *   ✢ Gesticulating… (13s · ↓ 624 tokens · esc to interrupt)
 *   ✻ Churned for 19s · ↓ 1.2k tokens · done 12:04 AM
 *
 * - Event `session_start`: sets the spinner frames (TUI only).
 * - Event `agent_start`: picks a verb and starts the clock (once per run;
 *   retries and follow-ups inside a run start the agent again).
 * - Events `message_update`, `message_end`: count output tokens.
 * - Event `agent_settled`: appends the summary as a custom entry, which
 *   shows in the transcript but never goes to the model.
 *
 * Tokens while streaming are estimated (4 characters per token, thinking and
 * tool arguments included); each finished message swaps in the provider's
 * `usage.output` when it reports one. Thinking is removed by patching the
 * exported AssistantMessageComponent (pi only offers a "Thinking..." label
 * in its place), so it disappears whatever `hideThinkingBlock` says. The
 * verb lists, frames and glyphs are Claude Code's (v2.1.310).
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, keyText } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const VERBS = [
	"Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming", "Beboppin'", "Befuddling",
	"Billowing", "Blanching", "Bloviating", "Boogieing", "Boondoggling", "Booping", "Bootstrapping", "Brewing",
	"Bunning", "Burrowing", "Calculating", "Caramelizing", "Cascading", "Catapulting", "Cerebrating", "Channeling",
	"Choreographing", "Churning", "Coalescing", "Cogitating", "Combobulating", "Composing", "Computing",
	"Concocting", "Considering", "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
	"Cultivating", "Deciphering", "Deliberating", "Determining", "Dilly-dallying", "Discombobulating", "Doing",
	"Doodling", "Drizzling", "Ebbing", "Effecting", "Elucidating", "Embellishing", "Enchanting", "Envisioning",
	"Fermenting", "Fiddle-faddling", "Finagling", "Flambéing", "Flibbertigibbeting", "Flowing", "Flummoxing",
	"Fluttering", "Forging", "Forming", "Frolicking", "Frosting", "Gallivanting", "Galloping", "Garnishing",
	"Generating", "Gesticulating", "Germinating", "Gitifying", "Grooving", "Gusting", "Harmonizing", "Hashing",
	"Hatching", "Herding", "Honking", "Hullaballooing", "Hyperspacing", "Ideating", "Imagining", "Improvising",
	"Incubating", "Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning", "Kerfuffling", "Kneading",
	"Leavening", "Levitating", "Lollygagging", "Manifesting", "Marinating", "Meandering", "Metamorphosing",
	"Misting", "Moonwalking", "Moseying", "Mulling", "Mustering", "Nebulizing", "Nesting", "Newspapering",
	"Noodling", "Nucleating", "Onioning", "Orbiting", "Orchestrating", "Osmosing", "Perambulating", "Percolating",
	"Perusing", "Philosophizing", "Photosynthesizing", "Polishing", "Pollinating", "Pondering", "Pontificating",
	"Pouncing", "Precipitating", "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering",
	"Puzzling", "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating", "Roosting",
	"Ruminating", "Sautéing", "Scampering", "Schlepping", "Scurrying", "Seasoning", "Shenaniganing", "Shimmying",
	"Simmering", "Skedaddling", "Sketching", "Slithering", "Smooshing", "Sock-hopping", "Spelunking", "Spinning",
	"Sprouting", "Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting", "Synthesizing", "Tempering",
	"Thinking", "Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying", "Transfiguring", "Transmogrifying",
	"Transmuting", "Twisting", "Undulating", "Unfurling", "Unraveling", "Vibing", "Waddling", "Wandering",
	"Warping", "Whatchamacalliting", "Whirlpooling", "Whirring", "Whisking", "Wibbling", "Working", "Wrangling",
	"Zesting", "Zigzagging",
];
const DONE_VERBS = ["Baked", "Brewed", "Churned", "Cogitated", "Cooked", "Crunched", "Sautéed", "Worked"];
const FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"];
const ENTRY = "working-summary";
const ORIGINAL = Symbol.for("my-tooling.working.updateContent");

type Summary = { verb: string; ms: number; tokens: number; done: number };
type Content = { type: string; text?: string; thinking?: string; arguments?: unknown };

// pi spells the key "escape"; Claude Code says "esc".
const interruptKey = () => keyText("app.interrupt").replace(/^escape$/, "esc");

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

function elapsed(ms: number): string {
	const s = Math.floor(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function tokens(n: number): string {
	return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}

function estimate(message: AgentMessage): number {
	if (message.role !== "assistant") return 0;
	let chars = 0;
	for (const c of message.content as Content[]) {
		if (c.type === "text") chars += c.text?.length ?? 0;
		else if (c.type === "thinking") chars += c.thinking?.length ?? 0;
		else if (c.type === "toolCall") chars += JSON.stringify(c.arguments ?? {}).length;
	}
	return Math.round(chars / 4);
}

// Drop thinking before pi lays the message out.
type Patchable = { updateContent(message: { content: Content[] }, isStreaming?: boolean): void };
const proto = AssistantMessageComponent.prototype as unknown as Patchable & {
	[ORIGINAL]?: Patchable["updateContent"];
};
const updateContent = (proto[ORIGINAL] ??= proto.updateContent);
proto.updateContent = function (this: Patchable, message, isStreaming) {
	const content = message.content.filter((c) => c.type !== "thinking");
	updateContent.call(this, { ...message, content }, isStreaming);
};

export default function (pi: ExtensionAPI) {
	let theme: Theme | undefined;
	let setMessage: (message?: string) => void = () => {};
	let timer: ReturnType<typeof setInterval> | undefined;
	let start = 0;
	let verb = "";
	let done = 0; // tokens of finished messages
	let streaming = 0; // estimate for the message being streamed

	const refresh = () => {
		if (!theme || !start) return;
		const detail = `(${elapsed(Date.now() - start)} · ↓ ${tokens(done + streaming)} tokens · ${interruptKey()} to interrupt)`;
		setMessage(`${theme.fg("accent", `${verb}…`)} ${theme.fg("dim", detail)}`);
	};

	pi.registerEntryRenderer<Summary>(ENTRY, (entry, _options, t) => {
		const s = entry.data;
		if (!s) return undefined;
		const at = new Date(s.done).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		const line = `✻ ${s.verb} for ${elapsed(s.ms)} · ↓ ${tokens(s.tokens)} tokens · done ${at}`;
		return new Text(t.fg("dim", line), 0, 0);
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		theme = ctx.ui.theme;
		setMessage = (message) => ctx.ui.setWorkingMessage(message);
		const frames = [...FRAMES, ...[...FRAMES].reverse()].map((f) => ctx.ui.theme.fg("accent", f));
		ctx.ui.setWorkingIndicator({ frames, intervalMs: 120 });
	});

	pi.on("agent_start", async () => {
		if (start) return;
		start = Date.now();
		verb = pick(VERBS);
		done = 0;
		streaming = 0;
		refresh();
		timer = setInterval(refresh, 1000);
	});

	pi.on("message_update", async (event) => {
		streaming = estimate(event.message);
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		done += event.message.usage?.output || estimate(event.message);
		streaming = 0;
	});

	pi.on("agent_settled", async () => {
		if (!start) return;
		clearInterval(timer);
		timer = undefined;
		const summary: Summary = { verb: pick(DONE_VERBS), ms: Date.now() - start, tokens: done, done: Date.now() };
		start = 0;
		setMessage();
		if (theme) pi.appendEntry(ENTRY, summary);
	});

	pi.on("session_shutdown", async () => {
		clearInterval(timer);
	});
}
