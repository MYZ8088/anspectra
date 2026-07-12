/**
 * Task-bound live Web diagnostic. Every provider gets a distinct prompt by
 * default so repeated smoke runs do not train on one trivial echo case.
 *
 * Usage:
 *   pnpm --filter @aloom/agent exec ts-node-esm src/run-test.ts deepseek --mode=web_search
 *   pnpm --filter @aloom/agent exec ts-node-esm src/run-test.ts qwen --prompt="..."
 */
import "./env.js";
import {
	PROVIDER_MODE_LIST,
	type Provider,
	type ProviderMode,
} from "@aloom/types";
import { createAgent } from "./core/createAgent.js";
import { runPrompts } from "./core/prompt-runner/index.js";
import { closeAllProviderSessions } from "./lib/browser/providerSessionManager.js";

const ALL_PROVIDERS: Provider[] = ["doubao", "deepseek", "hunyuan", "qwen"];

const DISTINCT_DIAGNOSTIC_PROMPTS: Record<Provider, string> = {
	doubao:
		"一家中国 B2B SaaS 团队准备选择产品分析工具时，应优先核查哪些能力和公开证据？请列出三个判断维度。",
	deepseek:
		"For a privacy-conscious startup comparing self-hosted product analytics tools, what evidence should influence the shortlist?",
	hunyuan:
		"如果产品团队担心埋点维护成本，评估产品分析平台时应该向供应商提出哪些具体问题？",
	qwen:
		"Compare the decision criteria for open-source and hosted product analytics platforms without naming a preferred vendor.",
	chatgpt: "What evidence should support an AI visibility monitoring claim?",
	claude: "How should a team validate a software comparison before buying?",
	gemini: "What makes a product recommendation source trustworthy?",
	perplexity: "How should public sources be checked in a software shortlist?",
	"ai-overview": "What evidence should a software buyer verify?",
};

function readFlag(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const requestedMode = (readFlag("mode") ?? "default") as ProviderMode;
if (!PROVIDER_MODE_LIST.includes(requestedMode)) {
	throw new Error(`Unsupported mode: ${requestedMode}`);
}
const explicitPrompt = readFlag("prompt");
const providers = process.argv
	.slice(2)
	.filter((value) => !value.startsWith("--")) as Provider[];
const selectedProviders = providers.length ? providers : ALL_PROVIDERS;

async function runForProvider(provider: Provider): Promise<void> {
	const prompt = explicitPrompt ?? DISTINCT_DIAGNOSTIC_PROMPTS[provider];
	if (!prompt) throw new Error(`No diagnostic prompt is configured for ${provider}`);
	const taskId = `diagnostic:${provider}:${requestedMode}:${Date.now()}`;
	console.log(`\n${"=".repeat(60)}`);
	console.log(`TASK:     ${taskId}`);
	console.log(`PROVIDER: ${provider}`);
	console.log(`MODE:     ${requestedMode}`);
	console.log(`PROMPT:   ${prompt}`);
	console.log("=".repeat(60));

	const agent = await createAgent(provider, { taskId, visibility: "headless" });
	try {
		const results = await runPrompts(
			{
				user_id: "diagnostic-user",
				workspace_id: "diagnostic-workspace",
				created_at: new Date().toISOString(),
				providerMode: requestedMode,
				prompts: [{ id: `${taskId}:prompt`, prompt }],
				sampling: { minPromptDelayMs: 0, maxPromptDelayMs: 0 },
			},
			agent.page,
			provider,
		);
		const result = results[0];
		if (!result) throw new Error("Provider returned no valid sample");
		console.log(
			JSON.stringify(
				{
					provider,
					requestedMode: result.requestedMode,
					actualMode: result.actualMode,
					responseLength: result.response.length,
					response: result.response,
					sources: result.sources,
					conversationId: result.conversationId,
					conversationUrl: result.conversationUrl,
				},
				null,
				2,
			),
		);
	} finally {
		await agent.cleanup();
	}
}

try {
	for (const provider of selectedProviders) {
		await runForProvider(provider);
	}
} finally {
	await closeAllProviderSessions();
}
