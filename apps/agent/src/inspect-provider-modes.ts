import "./env.js";
import { GEO_WEB_PROVIDERS } from "@aloom/services";
import type { Provider } from "@aloom/types";
import { createAgent } from "./core/createAgent.js";
import { readProviderModeControls } from "./core/providers/_shared/providerModes.js";

const provider = process.argv[2] as Provider | undefined;
if (!provider || !GEO_WEB_PROVIDERS.includes(provider as never)) {
	throw new Error(
		`Usage: pnpm --filter @aloom/agent inspect:modes <${GEO_WEB_PROVIDERS.join("|")}>`,
	);
}

const holdSeconds = Math.max(10, Number(process.argv[3] ?? 180));
const watchControls = process.argv.includes("--watch");
const taskId = `mode-inspection:${provider}:${Date.now()}`;
const agent = await createAgent(provider, { taskId, visibility: "headful" });

try {
	const controls = await readProviderModeControls(agent.page);
	console.log(
		JSON.stringify(
			{
				taskId,
				provider,
				pageUrl: agent.page.url(),
				controls,
				holdSeconds,
			},
			null,
			2,
		),
	);
	const watchTimer = watchControls
		? setInterval(() => {
				void readProviderModeControls(agent.page)
					.then((nextControls) =>
						console.log(
							JSON.stringify({ taskId, provider, controls: nextControls }),
						),
					)
					.catch(() => null);
			}, 2_000)
		: null;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, holdSeconds * 1000);
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			process.once(signal, () => {
				clearTimeout(timer);
				resolve();
			});
		}
	});
	if (watchTimer) clearInterval(watchTimer);
} finally {
	await agent.cleanup();
}
