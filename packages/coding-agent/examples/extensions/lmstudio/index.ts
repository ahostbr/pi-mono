/**
 * LM Studio Provider Extension
 *
 * Registers a local `lmstudio` provider backed by LM Studio's OpenAI-compatible
 * Chat Completions endpoint and adds `/lmstudio` model-management commands.
 *
 * Models are discovered dynamically from the running LM Studio instance — no
 * hardcoded model list.  The v0 API (`/api/v0/models`) provides rich metadata
 * (display name, quantization, context length, VLM detection).  The OpenAI-
 * compatible `/v1/models` endpoint is used as a fallback.
 *
 * Usage:
 *   pi -e ./packages/coding-agent/examples/extensions/lmstudio
 *   /lmstudio status
 *   /lmstudio refresh
 *   /model lmstudio/<model-id>
 *
 * Environment:
 *   LMSTUDIO_BASE_URL=http://localhost:1234/v1
 *   LM_STUDIO_URL=http://localhost:1234/v1
 *   LMS_CLI=C:\Users\you\.lmstudio\bin\lms.exe
 */

import process from "node:process";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const PROVIDER_NAME = "lmstudio";
const DEFAULT_V1_BASE_URL = "http://localhost:1234/v1";

const LMSTUDIO_COMPAT = {
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsUsageInStreaming: false,
	maxTokensField: "max_tokens",
	supportsStrictMode: false,
} satisfies NonNullable<ProviderModelConfig["compat"]>;

// ── Types ───────────────────────────────────────────────────────────────────

interface LmStudioV0Model {
	id?: unknown;
	type?: unknown;
	state?: unknown;
	quantization?: unknown;
	loaded_context_length?: unknown;
	max_context_length?: unknown;
	display_name?: unknown;
	publisher?: unknown;
	arch?: unknown;
	size_bytes?: unknown;
}

interface LmStudioModelsResponse {
	data?: unknown;
}

interface OpenAIModel {
	id: string;
	object?: string;
	owned_by?: string;
}

interface GpuVram {
	totalGb: number;
	usedGb: number;
	freeGb: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getV1BaseUrl(): string {
	const raw =
		process.env.LMSTUDIO_BASE_URL ??
		process.env.LM_STUDIO_URL ??
		process.env.LM_STUDIO_BASE_URL ??
		DEFAULT_V1_BASE_URL;
	const withoutCompletionPath = raw.replace(/\/chat\/completions\/?$/, "").replace(/\/+$/, "");
	return withoutCompletionPath.endsWith("/v1") ? withoutCompletionPath : `${withoutCompletionPath}/v1`;
}

function getApiRoot(): string {
	return getV1BaseUrl().replace(/\/v1\/?$/, "");
}

function getLmsCli(): string {
	if (process.env.LMS_CLI) return process.env.LMS_CLI;
	if (process.platform === "win32" && process.env.USERPROFILE) {
		return `${process.env.USERPROFILE}\\.lmstudio\\bin\\lms.exe`;
	}
	return "lms";
}

function getApiKey(): string {
	return process.env.LMSTUDIO_API_KEY ?? process.env.LM_STUDIO_API_KEY ?? "lm-studio";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeV0Model(value: unknown): LmStudioV0Model | undefined {
	if (!isRecord(value)) return undefined;
	return value;
}

function shortName(id: string): string {
	const parts = id.split("/");
	const last = parts[parts.length - 1];
	return last
		.replace(/-GGUF$/i, "")
		.replace(/-[QqFf]\d[_A-Za-z0-9]*$/, "")
		.replace(/^[A-Za-z0-9]+_/, "");
}

// ── Model Discovery ─────────────────────────────────────────────────────────

async function getLmStudioModels(): Promise<LmStudioV0Model[]> {
	try {
		const response = await fetch(`${getApiRoot()}/api/v0/models`, { signal: AbortSignal.timeout(3000) });
		if (!response.ok) return [];
		const json = (await response.json()) as LmStudioModelsResponse;
		if (!Array.isArray(json.data)) return [];
		return json.data.map(normalizeV0Model).filter((model): model is LmStudioV0Model => model !== undefined);
	} catch {
		return [];
	}
}

async function getOpenAIModels(): Promise<OpenAIModel[]> {
	try {
		const response = await fetch(`${getV1BaseUrl()}/models`, {
			headers: { Authorization: `Bearer ${getApiKey()}` },
			signal: AbortSignal.timeout(3000),
		});
		if (!response.ok) return [];
		const json = (await response.json()) as { data?: unknown };
		if (!Array.isArray(json.data)) return [];
		return json.data.filter((m: unknown): m is OpenAIModel => isRecord(m) && typeof m.id === "string");
	} catch {
		return [];
	}
}

function v0ModelToConfig(model: LmStudioV0Model): ProviderModelConfig | undefined {
	const id = readString(model.id);
	if (!id) return undefined;
	const displayName = readString(model.display_name);
	const quantization = readString(model.quantization);
	const state = readString(model.state);
	const type = readString(model.type);
	const contextWindow = readNumber(model.loaded_context_length) ?? readNumber(model.max_context_length) ?? 128000;
	const label = displayName ?? shortName(id);
	const suffix = [quantization, state === "loaded" ? "loaded" : undefined].filter(Boolean).join(", ");
	return {
		id,
		name: suffix ? `${label} (${suffix})` : label,
		reasoning: false,
		input: type === "vlm" ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: Math.min(16384, Math.max(4096, Math.floor(contextWindow / 4))),
		compat: LMSTUDIO_COMPAT,
	};
}

function openAIModelToConfig(model: OpenAIModel): ProviderModelConfig {
	return {
		id: model.id,
		name: shortName(model.id),
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384,
		compat: LMSTUDIO_COMPAT,
	};
}

async function buildModels(): Promise<ProviderModelConfig[]> {
	const byId = new Map<string, ProviderModelConfig>();

	const v0Models = await getLmStudioModels();
	if (v0Models.length > 0) {
		for (const model of v0Models) {
			const config = v0ModelToConfig(model);
			if (config) byId.set(config.id, config);
		}
		return [...byId.values()];
	}

	const openaiModels = await getOpenAIModels();
	for (const model of openaiModels) {
		if (!byId.has(model.id)) {
			byId.set(model.id, openAIModelToConfig(model));
		}
	}

	return [...byId.values()];
}

// ── Provider Registration ───────────────────────────────────────────────────

async function registerLmStudioProvider(pi: ExtensionAPI): Promise<number> {
	const models = await buildModels();
	pi.registerProvider(PROVIDER_NAME, {
		baseUrl: getV1BaseUrl(),
		apiKey: getApiKey(),
		api: "openai-completions",
		models,
	});
	return models.length;
}

// ── LMS CLI Helpers ─────────────────────────────────────────────────────────

async function runLms(pi: ExtensionAPI, args: string[]): Promise<string> {
	const result = await pi.exec(getLmsCli(), args, { timeout: 120000 });
	const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
	if (result.code !== 0) {
		throw new Error(output || `lms ${args.join(" ")} failed with exit code ${result.code}`);
	}
	return output;
}

async function getGpuVram(pi: ExtensionAPI): Promise<GpuVram | undefined> {
	try {
		const result = await pi.exec(
			"nvidia-smi",
			["--query-gpu=memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"],
			{ timeout: 5000 },
		);
		if (result.code !== 0) return undefined;
		const [totalMb, usedMb, freeMb] = result.stdout
			.trim()
			.split(/\r?\n/)[0]
			.split(",")
			.map((part) => Number.parseFloat(part.trim()));
		if (![totalMb, usedMb, freeMb].every((value) => Number.isFinite(value))) return undefined;
		return {
			totalGb: totalMb / 1024,
			usedGb: usedMb / 1024,
			freeGb: freeMb / 1024,
		};
	} catch {
		return undefined;
	}
}

// ── Status / Help ───────────────────────────────────────────────────────────

async function formatStatus(pi: ExtensionAPI): Promise<string> {
	const [models, gpu] = await Promise.all([getLmStudioModels(), getGpuVram(pi)]);
	const lines: string[] = [`LM Studio base URL: ${getV1BaseUrl()}`, `LMS CLI: ${getLmsCli()}`];
	if (gpu) {
		lines.push(
			`GPU VRAM: ${gpu.usedGb.toFixed(1)} GB used / ${gpu.totalGb.toFixed(1)} GB total (${gpu.freeGb.toFixed(1)} GB free)`,
		);
	}
	if (models.length === 0) {
		lines.push("", "No models found. Is LM Studio running?");
		return lines.join("\n");
	}

	const loaded = models.filter((m) => readString(m.state) === "loaded");
	const notLoaded = models.filter((m) => readString(m.state) !== "loaded");

	if (loaded.length > 0) {
		lines.push("", "Loaded:");
		for (const model of loaded) {
			const id = readString(model.id) ?? "<unknown>";
			const displayName = readString(model.display_name);
			const quant = readString(model.quantization) ?? "?";
			const context = readNumber(model.loaded_context_length) ?? readNumber(model.max_context_length) ?? "?";
			const type = readString(model.type) ?? "llm";
			const label = displayName ? `${displayName} (${quant})` : `${id} (${quant})`;
			lines.push(`  ● ${label}  ctx=${context}  type=${type}  id=${id}`);
		}
	}

	if (notLoaded.length > 0) {
		lines.push("", "Available (not loaded):");
		for (const model of notLoaded) {
			const id = readString(model.id) ?? "<unknown>";
			const displayName = readString(model.display_name);
			const quant = readString(model.quantization) ?? "?";
			const maxCtx = readNumber(model.max_context_length) ?? "?";
			const label = displayName ? `${displayName} (${quant})` : `${id} (${quant})`;
			lines.push(`  ○ ${label}  max_ctx=${maxCtx}  id=${id}`);
		}
	}

	return lines.join("\n");
}

function help(): string {
	return [
		"LM Studio commands:",
		"  /lmstudio status       Show models, GPU, and connection info",
		"  /lmstudio refresh      Re-fetch models and update the provider",
		"  /lmstudio load <id>    Load a model by its LM Studio ID",
		"  /lmstudio unload <id>  Unload a model (or --all)",
		"",
		"After loading, select a model with /model lmstudio/<id>.",
	].join("\n");
}

// ── Extension Entry Point ───────────────────────────────────────────────────

function emit(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({ customType: "lmstudio", content, display: true });
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const count = await registerLmStudioProvider(pi);
		if (count === 0) {
			emit(pi, `LM Studio: no models discovered. Is LM Studio running at ${getV1BaseUrl()}?`);
		}
	});

	pi.registerCommand("lmstudio", {
		description: "Manage LM Studio models and refresh the lmstudio provider",
		getArgumentCompletions: (prefix) => {
			const values = ["status", "refresh", "load", "unload", "unload --all"];
			const filtered = values.filter((v) => v.startsWith(prefix));
			return filtered.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const command = parts[0] || "help";
			const target = parts.slice(1).join(" ");
			try {
				if (command === "help") {
					emit(pi, help());
					return;
				}
				if (command === "status") {
					emit(pi, await formatStatus(pi));
					return;
				}
				if (command === "refresh") {
					const n = await registerLmStudioProvider(pi);
					emit(pi, `Refreshed lmstudio provider: ${n} model(s) discovered.`);
					return;
				}
				if (command === "load") {
					if (!target) throw new Error("Usage: /lmstudio load <model-id>");
					await runLms(pi, ["load", target, "-y", "--gpu", "max"]);
					const n = await registerLmStudioProvider(pi);
					emit(pi, `Loaded ${target}. Provider refreshed (${n} models).`);
					return;
				}
				if (command === "unload") {
					if (!target) throw new Error("Usage: /lmstudio unload <model-id|--all>");
					await runLms(pi, ["unload", target]);
					const n = await registerLmStudioProvider(pi);
					emit(pi, `Unloaded ${target}. Provider refreshed (${n} models).`);
					return;
				}
				emit(pi, help());
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				emit(pi, `Error: ${message}`);
			}
		},
	});
}
