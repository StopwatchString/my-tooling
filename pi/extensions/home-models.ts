/**
 * Home model server (socrates, ~/serve/ai on the LAN) as the `home` provider.
 *
 * - Provider `home`: the server's live model list from `/v1/models`, or a
 *   built-in copy of it when the server can't be reached at startup. Today
 *   that is one model, `swift`, with a copy on each GPU behind one endpoint.
 * - Event `before_agent_start`: adds a short `home_models` prompt section
 *   saying what the models are for and how many requests run at once.
 *
 * Key: $HOME_AI_KEY. The `pi` shell function (shell/common/functions.sh)
 * fills it from 1Password (op://Personal/home-ai-server/credential) for each
 * run; it is never stored in a file on client machines. On socrates the
 * server's own ~/serve/ai/.env is used. $HOME_AI_URL overrides the default
 * http://192.168.0.41:8000.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const URL_DEFAULT = "http://192.168.0.41:8000";

type ServerModel = {
	id: string;
	description: string;
	use?: string;
	max_model_len: number;
	max_concurrency?: number;
	copies?: number;
	input: ("text" | "image")[];
	thinking: "effort" | "onoff";
	sampling: Record<string, unknown>;
	running?: { gpus: number[]; state: string }[];
};

// Used when the server is unreachable at startup, so the provider and its
// models always exist. Keep in step with socrates:~/serve/ai/models.yaml.
const SAMPLING = { temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0 };
const FALLBACK: ServerModel[] = [
	{
		id: "swift",
		description: "Swift 1.5 Qwen3.8-27B NVFP4 on NInfer - full 256K context, vision, DFlash2, one copy per GPU",
		use: "Everything: chat, coding, agents, long context, images. Send parallel requests freely; they spread over both GPUs.",
		max_model_len: 262144,
		max_concurrency: 2,
		copies: 2,
		input: ["text", "image"],
		thinking: "effort",
		sampling: SAMPLING,
	},
];

function serverUrl(): string {
	return (process.env.HOME_AI_URL || URL_DEFAULT).replace(/\/+$/, "");
}

/** HOME_AI_KEY, else the server's own .env (when running on socrates). */
function apiKey(): string {
	if (process.env.HOME_AI_KEY) return process.env.HOME_AI_KEY;
	try {
		const m = readFileSync(`${homedir()}/serve/ai/.env`, "utf8").match(/^VLLM_API_KEY=(.*)$/m);
		return m?.[1]?.trim() || "local";
	} catch {
		return "local";
	}
}

async function listModels(key: string, signal?: AbortSignal): Promise<ServerModel[] | undefined> {
	try {
		const r = await fetch(`${serverUrl()}/v1/models`, {
			signal: signal ?? AbortSignal.timeout(3000),
			headers: { Authorization: `Bearer ${key}` },
		});
		if (!r.ok) return undefined;
		return ((await r.json()) as { data: ServerModel[] }).data;
	} catch {
		return undefined;
	}
}

function toPiModel(m: ServerModel) {
	const effort = m.thinking === "effort";
	// The server reserves KV for prompt + max_tokens per request, so the
	// high-concurrency model gets a smaller output budget per agent.
	const maxOut = (m.max_concurrency ?? 1) > 2 ? 32768 : 65536;
	return {
		id: m.id,
		name: `${m.id} (home) ${m.description}`,
		reasoning: true,
		input: m.input,
		contextWindow: m.max_model_len,
		maxTokens: Math.min(maxOut, Math.floor(m.max_model_len / 4)),
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		thinkingLevelMap: effort
			? { minimal: null, low: "low", medium: "medium", high: null, xhigh: "xhigh", max: null }
			: { minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null },
		samplingParams: m.sampling,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			maxTokensField: "max_tokens",
			thinkingFormat: "chat-template",
			chatTemplateKwargs: {
				enable_thinking: { $var: "thinking.enabled" },
				...(effort ? { reasoning_effort: { $var: "thinking.effort", omitWhenOff: true } } : {}),
			},
		},
	} as const;
}

export default async function (pi: ExtensionAPI) {
	const key = apiKey();
	const live = await listModels(key);
	const models = live?.length ? live : FALLBACK;

	pi.registerProvider("home", {
		baseUrl: `${serverUrl()}/v1`,
		api: "openai-completions",
		apiKey: key,
		models: models.map(toPiModel),
		async refreshModels(ctx) {
			const fresh = await listModels(key, ctx.signal);
			return (fresh?.length ? fresh : models).map(toPiModel);
		},
	});

	const lines = models.map((m) => {
		const n = (m.max_concurrency ?? 1) * Math.max(m.copies ?? 1, 1);
		const par = n > 1 ? `; ${n} requests run at once, more wait in a queue (never truncated)` : "";
		return `- home/${m.id}: ${m.description}${par}.${m.use ? ` ${m.use}` : ""}`;
	});
	const section =
		`Local models on the home server (OpenAI-compatible API at ${serverUrl()}/v1; ` +
		`LAN clients send $HOME_AI_KEY as a Bearer token)` +
		(live ? ":" : " - not reachable when this session started:") +
		`\n${lines.join("\n")}`;

	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.sections.home_models = section;
	});
}
