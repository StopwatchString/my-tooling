/**
 * Compact tool renderer for the built-in tools (read, bash, edit, write).
 *
 * Re-registers each built-in tool with the same name, delegating execution
 * to the original implementation and overriding only the renderers.
 *
 * - renderCall(): one line with the tool name and its main argument
 * - renderResult(): bash and read show one compact line (e.g. "done (12 lines)",
 *   "200 lines"); the full output is revealed with the expand toggle (Ctrl+O).
 *   edit always shows the full diff; write shows the tool's one-line result
 *   ("Successfully wrote to <path>").
 */

import type {
	BashToolDetails,
	EditToolDetails,
	ExtensionAPI,
	ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
	const c = result.content[0];
	return c?.type === "text" ? (c.text ?? "") : "";
}

function truncate(s: string, max: number): string {
	return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	// --- read: path in, line count out ---
	const originalRead = createReadToolDefinition(cwd);
	pi.registerTool({
		...originalRead,

		renderCall(args, theme, _ctx) {
			return new Text(
				theme.fg("toolTitle", theme.bold("read ")) + theme.fg("accent", truncate(String(args.path), 80)),
				0,
				0,
			);
		},

		renderResult(result, { expanded, isPartial }, theme, _ctx) {
			if (isPartial) return new Text(theme.fg("warning", "Reading..."), 0, 0);

			const content = result.content[0];
			if (content?.type === "image") return new Text(theme.fg("success", "image loaded"), 0, 0);
			if (content?.type !== "text") return new Text(theme.fg("error", "no content"), 0, 0);

			const lines = content.text.split("\n");
			let text = theme.fg("success", `${lines.length} lines`);
			const details = result.details as ReadToolDetails | undefined;
			if (details?.truncation?.truncated) {
				text += theme.fg("warning", ` (of ${details.truncation.totalLines})`);
			}
			if (expanded) {
				for (const line of lines.slice(0, 20)) text += `\n${theme.fg("dim", line)}`;
				if (lines.length > 20) text += `\n${theme.fg("muted", `... ${lines.length - 20} more`)}`;
			}
			return new Text(text, 0, 0);
		},
	});

	// --- bash: command in, status out ---
	const originalBash = createBashToolDefinition(cwd);
	pi.registerTool({
		...originalBash,

		renderCall(args, theme, _ctx) {
			const cmd = truncate(args.command.replace(/\s+/g, " ").trim(), 100);
			return new Text(theme.fg("toolTitle", theme.bold("$ ")) + theme.fg("accent", cmd), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, _ctx) {
			if (isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);

			const output = firstText(result);
			const exitMatch = output.match(/exit code: (\d+)/);
			const exitCode = exitMatch ? parseInt(exitMatch[1], 10) : 0;
			const lineCount = output.split("\n").filter((l) => l.trim()).length;

			let text =
				exitCode === 0 ? theme.fg("success", "done") : theme.fg("error", `exit ${exitCode}`);
			text += theme.fg("dim", ` (${lineCount} lines)`);
			const details = result.details as BashToolDetails | undefined;
			if (details?.truncation?.truncated) text += theme.fg("warning", " [truncated]");

			if (expanded) {
				const lines = output.split("\n");
				for (const line of lines.slice(0, 20)) text += `\n${theme.fg("dim", line)}`;
				if (lines.length > 20) text += `\n${theme.fg("muted", `... ${lines.length - 20} more`)}`;
			}
			return new Text(text, 0, 0);
		},
	});

	// --- edit: path in, +/- counts out ---
	const originalEdit = createEditToolDefinition(cwd);
	pi.registerTool({
		...originalEdit,

		renderCall(args, theme, _ctx) {
			return new Text(
				theme.fg("toolTitle", theme.bold("edit ")) + theme.fg("accent", truncate(String(args.path), 80)),
				0,
				0,
			);
		},

		renderResult(result, { expanded: _expanded, isPartial }, theme, _ctx) {
			if (isPartial) return new Text(theme.fg("warning", "Editing..."), 0, 0);

			const textOut = firstText(result);
			if (textOut.startsWith("Error")) return new Text(theme.fg("error", truncate(textOut.split("\n")[0], 100)), 0, 0);

			const details = result.details as EditToolDetails | undefined;
			if (!details?.diff) return new Text(theme.fg("success", "applied"), 0, 0);

			const diffLines = details.diff.split("\n");
			let add = 0;
			let del = 0;
			for (const line of diffLines) {
				if (line.startsWith("+") && !line.startsWith("+++")) add++;
				if (line.startsWith("-") && !line.startsWith("---")) del++;
			}

			// File edits are always shown in full, expanded or not.
			let text = theme.fg("success", `+${add}`) + theme.fg("dim", " / ") + theme.fg("error", `-${del}`);
			for (const line of diffLines) {
				if (line.startsWith("+") && !line.startsWith("+++")) text += `\n${theme.fg("success", line)}`;
				else if (line.startsWith("-") && !line.startsWith("---")) text += `\n${theme.fg("error", line)}`;
				else text += `\n${theme.fg("dim", line)}`;
			}
			return new Text(text, 0, 0);
		},
	});

	// --- write: path in, confirmation out ---
	const originalWrite = createWriteToolDefinition(cwd);
	pi.registerTool({
		...originalWrite,

		renderCall(args, theme, _ctx) {
			return new Text(
				theme.fg("toolTitle", theme.bold("write ")) +
					theme.fg("accent", truncate(String(args.path), 80)) +
					theme.fg("dim", ` (${args.content.split("\n").length} lines)`),
				0,
				0,
			);
		},

		renderResult(result, { isPartial }, theme, _ctx) {
			if (isPartial) return new Text(theme.fg("warning", "Writing..."), 0, 0);
			const textOut = firstText(result);
			if (textOut.startsWith("Error")) return new Text(theme.fg("error", truncate(textOut.split("\n")[0], 100)), 0, 0);

			let text = theme.fg("success", "written");
			for (const line of textOut.split("\n")) text += `\n${theme.fg("dim", line)}`;
			return new Text(text, 0, 0);
		},
	});
}
