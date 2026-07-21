import "./env.js";
import { GEO_WEB_PROVIDERS } from "@anspectra/services";
import {
	PROVIDER_MODE_LIST,
	type Provider,
	type ProviderMode,
} from "@anspectra/types";
import { createAgent } from "./core/createAgent.js";
import {
	applyOfficialWebMode,
	readProviderModeControls,
} from "./core/providers/_shared/providerModes.js";
import { closeAllProviderSessions } from "./lib/browser/providerSessionManager.js";
import { waitForEditorReady } from "./lib/input/editor/waitForReady.js";
import { detectBotPage } from "./lib/input/response/detectBotPage.js";

const provider = process.argv[2] as Provider | undefined;
if (!provider || !GEO_WEB_PROVIDERS.includes(provider as never)) {
	throw new Error(
		`Usage: pnpm --filter @anspectra/agent inspect:modes <${GEO_WEB_PROVIDERS.join("|")}>`,
	);
}

const holdSeconds = Math.max(10, Number(process.argv[3] ?? 180));
const watchControls = process.argv.includes("--watch");
const includeDomDetails = process.argv.includes("--dom-details");
const visibility = process.argv.includes("--headless") ? "headless" : "headful";
const requestedModeValue = process.argv
	.find((argument) => argument.startsWith("--apply="))
	?.slice("--apply=".length);
if (
	requestedModeValue &&
	!PROVIDER_MODE_LIST.includes(requestedModeValue as ProviderMode)
) {
	throw new Error(`Unknown provider mode: ${requestedModeValue}`);
}
const requestedMode = requestedModeValue as ProviderMode | undefined;
const taskId = `mode-inspection:${provider}:${Date.now()}`;
const agent = await createAgent(provider, { taskId, visibility });

try {
	if (requestedMode) {
		await waitForEditorReady(agent.page, provider);
		await detectBotPage(agent.page, provider);
	}
	const appliedMode = requestedMode
		? await applyOfficialWebMode({
				page: agent.page,
				provider,
				mode: requestedMode,
			})
		: undefined;
	const controls = await readProviderModeControls(agent.page);
	const readDomDetails = () =>
		agent.page.evaluate(
			() =>
				Array.from(
					document.querySelectorAll<HTMLElement>(
						"button,[role='button'],[role='switch'],[role='menuitem'],[aria-haspopup],input[type='checkbox'],svg",
					),
				)
					.filter((element) => {
						const rect = element.getBoundingClientRect();
						const text = (element.innerText || element.textContent || "")
							.replace(/\s+/g, " ")
							.trim();
						return (
							rect.width > 1 &&
							rect.height > 1 &&
							(rect.top > window.innerHeight - 500 ||
								/tools?|search|联网|搜索/i.test(text))
						);
					})
					.slice(-80)
					.map((element) => ({
						tag: element.tagName.toLowerCase(),
						text: (element.innerText || element.textContent || "")
							.replace(/\s+/g, " ")
							.trim()
							.slice(0, 160),
						className: String(element.className || "").slice(0, 240),
						role: element.getAttribute("role"),
						ariaLabel: element.getAttribute("aria-label"),
						ariaChecked: element.getAttribute("aria-checked"),
						ariaPressed: element.getAttribute("aria-pressed"),
						dataState: element.getAttribute("data-state"),
						outerHtml: element.outerHTML.slice(0, 600),
						parentHtml:
							element.parentElement?.outerHTML.slice(0, 1_200) ?? null,
						ancestors: (() => {
							const rows: Array<{
								tag: string;
								className: string;
								role: string | null;
								ariaHasPopup: string | null;
							}> = [];
							let current = element.parentElement;
							while (current && rows.length < 6) {
								rows.push({
									tag: current.tagName.toLowerCase(),
									className: String(current.className || "").slice(0, 240),
									role: current.getAttribute("role"),
									ariaHasPopup: current.getAttribute("aria-haspopup"),
								});
								current = current.parentElement;
							}
							return rows;
						})(),
					})),
			undefined,
		);
	const domDetails = includeDomDetails ? await readDomDetails() : undefined;
	console.log(
		JSON.stringify(
			{
				taskId,
				provider,
				pageUrl: agent.page.url(),
				visibility,
				requestedMode,
				appliedMode,
				controls,
				domDetails,
				holdSeconds,
			},
			null,
			2,
		),
	);
	const watchTimer = watchControls
		? setInterval(() => {
				void Promise.all([
					readProviderModeControls(agent.page),
					includeDomDetails ? readDomDetails() : Promise.resolve(undefined),
				])
					.then(([nextControls, nextDomDetails]) =>
						console.log(
							JSON.stringify({
								taskId,
								provider,
								controls: nextControls,
								domDetails: nextDomDetails,
							}),
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
	await closeAllProviderSessions();
}
