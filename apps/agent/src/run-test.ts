/**
 * Task-bound live Web diagnostic. Every provider gets a distinct prompt by
 * default so repeated smoke runs do not train on one trivial echo case.
 *
 * Usage:
 *   pnpm --filter @aloom/agent build
 *   node apps/agent/dist/run-test.js deepseek --mode=web_search
 *   node apps/agent/dist/run-test.js qwen --prompt="..."
 *   node apps/agent/dist/run-test.js doubao --count=2
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

const DISTINCT_DIAGNOSTIC_PROMPTS: Record<Provider, string[]> = {
	doubao: [
		"一家中国 B2B SaaS 团队准备选择产品分析工具时，应优先核查哪些能力和公开证据？请列出三个判断维度。",
		"比较产品分析工具时，团队应该怎样验证隐私、部署方式和数据所有权？",
	],
	deepseek: [
		"For a privacy-conscious startup comparing self-hosted product analytics tools, what evidence should influence the shortlist?",
		"Which implementation risks should a small team evaluate before adopting an open-source analytics platform?",
	],
	hunyuan: [
		"如果产品团队担心埋点维护成本，评估产品分析平台时应该向供应商提出哪些具体问题？",
		"选择产品分析工具时，怎样比较数据治理、部署成本和团队学习成本？",
	],
	qwen: [
		"Compare the decision criteria for open-source and hosted product analytics platforms without naming a preferred vendor.",
		"What public evidence should a buyer verify before trusting a product analytics recommendation?",
	],
	chatgpt: ["What evidence should support an AI visibility monitoring claim?"],
	claude: ["How should a team validate a software comparison before buying?"],
	gemini: ["What makes a product recommendation source trustworthy?"],
	perplexity: ["How should public sources be checked in a software shortlist?"],
	"ai-overview": ["What evidence should a software buyer verify?"],
};

function readFlag(name: string): string | undefined {
	const prefix = `--${name}=`;
	return process.argv
		.slice(2)
		.find((value) => value.startsWith(prefix))
		?.slice(prefix.length);
}

const requestedMode = (readFlag("mode") ?? "default") as ProviderMode;
if (!PROVIDER_MODE_LIST.includes(requestedMode)) {
	throw new Error(`Unsupported mode: ${requestedMode}`);
}
const explicitPrompt = readFlag("prompt");
const promptCount = Number(readFlag("count") ?? "1");
if (!Number.isInteger(promptCount) || promptCount < 1 || promptCount > 5) {
	throw new Error("--count must be an integer between 1 and 5");
}
const providers = process.argv
	.slice(2)
	.filter((value) => !value.startsWith("--")) as Provider[];
const selectedProviders = providers.length ? providers : ALL_PROVIDERS;

async function runForProvider(provider: Provider): Promise<void> {
	const configuredPrompts = DISTINCT_DIAGNOSTIC_PROMPTS[provider];
	if (!configuredPrompts?.length) {
		throw new Error(`No diagnostic prompt is configured for ${provider}`);
	}
	const prompts = Array.from({ length: promptCount }, (_, index) => ({
		id: `diagnostic:${provider}:${requestedMode}:${Date.now()}:${index + 1}`,
		prompt:
			explicitPrompt ??
			configuredPrompts[index % configuredPrompts.length] ??
			"",
	}));
	const taskId = `diagnostic:${provider}:${requestedMode}:${Date.now()}`;
	console.log(`\n${"=".repeat(60)}`);
	console.log(`TASK:     ${taskId}`);
	console.log(`PROVIDER: ${provider}`);
	console.log(`MODE:     ${requestedMode}`);
	console.log(`PROMPTS:  ${prompts.length}`);
	for (const [index, prompt] of prompts.entries()) {
		console.log(`  ${index + 1}. ${prompt.prompt}`);
	}
	console.log("=".repeat(60));

	const agent = await createAgent(provider, { taskId, visibility: "headless" });
	try {
		const results = await runPrompts(
			{
				user_id: "diagnostic-user",
				workspace_id: "diagnostic-workspace",
				created_at: new Date().toISOString(),
				providerMode: requestedMode,
				prompts,
				sampling: { minPromptDelayMs: 0, maxPromptDelayMs: 0 },
			},
			agent.page,
			provider,
		);
		if (results.length === 0) {
			throw new Error("Provider returned no valid sample");
		}
		console.log(
			JSON.stringify(
				{
					provider,
					planned: prompts.length,
					completed: results.length,
					samples: results.map((result) => ({
						promptId: result.promptId,
						prompt: result.prompt,
						requestedMode: result.requestedMode,
						actualMode: result.actualMode,
						responseLength: result.response.length,
						response: result.response,
						sources: result.sources,
						conversationId: result.conversationId,
						conversationUrl: result.conversationUrl,
					})),
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
