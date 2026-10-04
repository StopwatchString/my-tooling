/**
 * Live thinking token estimate appended to the working indicator row.
 *
 * The default "Working..." wording is kept; while the model is thinking a
 * token count is appended, e.g. "Working (214 tok)". The default is restored
 * when thinking ends. The transcript shows no thinking lines at
 * all: the hidden-thinking label is set to an empty string, which renders
 * nothing.
 *
 * Why the working row: Pi's hidden-thinking label is a single global string
 * shared by every collapsed thinking block (see
 * interactive-mode.js setHiddenThinkingLabel), so per-message counts on the
 * transcript lines are not possible.
 *
 * Token counts are an estimate (~4 chars per token).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

export default function (pi: ExtensionAPI) {
	let thinkingChars = 0;
	let thinking = false;

	const reset = (ctx: ExtensionContext) => {
		thinkingChars = 0;
		thinking = false;
		ctx.ui.setWorkingMessage();
	};

	pi.on("session_start", (_event, ctx) => {
		reset(ctx);
		ctx.ui.setHiddenThinkingLabel("");
	});

	pi.on("message_update", (event, ctx) => {
		const e = event.assistantMessageEvent;
		if (e.type === "thinking_start") {
			thinking = true;
			thinkingChars = 0;
			ctx.ui.setWorkingMessage("Working (0 tok)");
		} else if (e.type === "thinking_delta") {
			thinkingChars += e.delta.length;
			ctx.ui.setWorkingMessage(`Working (${estimateTokens(thinkingChars)} tok)`);
		} else if (thinking && (e.type === "thinking_end" || e.type === "text_delta")) {
			reset(ctx);
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant" && thinking) {
			reset(ctx);
		}
	});
}
