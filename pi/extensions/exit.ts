/**
 * Command `/exit`: alias for /quit, shuts pi down cleanly via ctx.shutdown().
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("exit", {
		description: "Quit Pi (same as /quit)",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});
}
