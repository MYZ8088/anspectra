import { ExternalServiceError, toErrorMessage } from "@anspectra/errors";
import type { Provider, ProviderMode } from "@anspectra/types";
import { logger } from "@anspectra/utils";
import type { Page } from "playwright";

type VisibleControl = {
	text: string;
	active: boolean;
	ariaLabel: string;
	title: string;
	role: string;
	className: string;
};

const CONTROL_SELECTOR = [
	"button",
	"[role='button']",
	"[role='switch']",
	"[role='checkbox']",
	"[role='radio']",
	"[role='option']",
	"[role='combobox']",
	"[role='menuitem']",
	"[role='menuitemradio']",
	"[aria-pressed]",
	"[aria-selected]",
	"[aria-label='深度思考']",
	"[aria-label='Deep Thinking']",
	"[data-state]",
].join(",");

export function expectedOfficialWebMode(
	provider: Provider,
	mode: ProviderMode,
): ProviderMode {
	if (mode !== "default") return mode;
	if (provider === "doubao" || provider === "deepseek") return "fast";
	if (provider === "qwen") return "auto";
	return "default";
}

function normalized(value: string): string {
	return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export async function readProviderModeControls(
	page: Page,
): Promise<VisibleControl[]> {
	return page.evaluate((selector) => {
		const normalize = (value: string) =>
			value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
		const visible = (element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return (
				rect.width > 1 &&
				rect.height > 1 &&
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				style.opacity !== "0"
			);
		};
		const active = (element: HTMLElement) => {
			const signature = [
				element.getAttribute("aria-pressed"),
				element.getAttribute("aria-checked"),
				element.getAttribute("aria-selected"),
				element.getAttribute("data-state"),
				element.getAttribute("data-selected"),
				element.getAttribute("data-active"),
				element.className,
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase();
			return /(^|[\s_-])(true|on|checked|selected|active|enabled)([\s_-]|$)/.test(
				signature,
			);
		};
		return Array.from(document.querySelectorAll(selector))
			.filter(
				(element): element is HTMLElement => element instanceof HTMLElement,
			)
			.filter(visible)
			.map((element) => ({
				text: normalize(element.innerText || element.textContent || ""),
				active: active(element),
				ariaLabel: normalize(element.getAttribute("aria-label") || ""),
				title: normalize(element.getAttribute("title") || ""),
				role: normalize(element.getAttribute("role") || element.tagName),
				className: String(element.className || "").slice(0, 300),
			}))
			.filter(
				(item) =>
					(item.text.length > 0 && item.text.length <= 120) ||
					item.ariaLabel ||
					item.title,
			)
			.slice(-160);
	}, CONTROL_SELECTOR);
}

async function clickControl(
	page: Page,
	labels: string[],
	options?: { requireActive?: boolean; openFirst?: string[] },
): Promise<VisibleControl> {
	const wanted = labels.map(normalized);
	const find = (controls: VisibleControl[]) =>
		controls.find((control) =>
			wanted.some(
				(label) =>
					control.text === label ||
					control.text.startsWith(`${label} `) ||
					control.ariaLabel === label ||
					control.title === label,
			),
		);
	let controls = await readProviderModeControls(page);
	let match = find(controls);
	if (!match && options?.openFirst?.length) {
		await clickControl(page, options.openFirst);
		await page.waitForTimeout(400);
		controls = await readProviderModeControls(page);
		match = find(controls);
	}
	if (!match) {
		throw new Error(`mode control not found: ${labels.join(" / ")}`);
	}
	if (options?.requireActive && match.active) return match;

	const clicked = await page.evaluate(
		({ labels: targetLabels, selector }) => {
			const normalize = (value: string) =>
				value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
			const visible = (element: HTMLElement) => {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return (
					rect.width > 1 &&
					rect.height > 1 &&
					style.display !== "none" &&
					style.visibility !== "hidden"
				);
			};
			const target = Array.from(document.querySelectorAll(selector))
				.filter(
					(element): element is HTMLElement =>
						element instanceof HTMLElement && visible(element),
				)
				.find((element) => {
					const values = [
						normalize(element.innerText || element.textContent || ""),
						normalize(element.getAttribute("aria-label") || ""),
						normalize(element.getAttribute("title") || ""),
					];
					return targetLabels.some((label) =>
						values.some(
							(value) => value === label || value.startsWith(`${label} `),
						),
					);
				});
			if (!target) return false;
			target.click();
			return true;
		},
		{ labels: wanted, selector: CONTROL_SELECTOR },
	);
	if (!clicked)
		throw new Error(`mode control click failed: ${labels.join(" / ")}`);
	await page.waitForTimeout(500);
	return find(await readProviderModeControls(page)) ?? match;
}

async function ensureToggle(
	page: Page,
	labels: string[],
	enabled: boolean,
): Promise<void> {
	const controls = await readProviderModeControls(page);
	const wanted = labels.map(normalized);
	const match = controls.find((control) =>
		wanted.some((label) =>
			[control.text, control.ariaLabel, control.title].includes(label),
		),
	);
	if (!match) throw new Error(`mode toggle not found: ${labels.join(" / ")}`);
	if (match.active !== enabled) await clickControl(page, labels);
	const updated = (await readProviderModeControls(page)).find((control) =>
		wanted.some((label) =>
			[control.text, control.ariaLabel, control.title].includes(label),
		),
	);
	if (!updated || updated.active !== enabled) {
		throw new Error(`mode toggle did not reach ${enabled ? "on" : "off"}`);
	}
}

async function applyDeepSeekMode(
	page: Page,
	mode: ProviderMode,
): Promise<ProviderMode> {
	if (mode === "reasoning_web_search") {
		throw new Error(
			"DeepSeek Search is only available with Instant mode, not DeepThink",
		);
	}
	if (mode === "expert") {
		await clickControl(page, ["Expert", "专家"]);
		return "expert";
	}
	const reasoning = mode === "reasoning";
	const search = mode === "web_search";
	await clickControl(page, ["Instant", "快速"]);
	await ensureToggle(page, ["DeepThink", "深度思考"], reasoning);
	await ensureToggle(page, ["Search", "联网搜索"], search);
	if (reasoning) return "reasoning";
	if (search) return "web_search";
	return "fast";
}

async function applyDoubaoMode(
	page: Page,
	mode: ProviderMode,
): Promise<ProviderMode> {
	const clickDoubaoControl = async (
		labels: string[],
		candidateIndex = 0,
	): Promise<boolean> => {
		const selector =
			"button,[role='button'],[role='option'],[role='menuitem'],[role='menuitemradio']";
		const domIndex = await page.evaluate(
			({ targetLabels, candidateIndex, selector }) => {
				const normalize = (value: string) =>
					value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
				const visible = (element: HTMLElement) => {
					const rect = element.getBoundingClientRect();
					const style = window.getComputedStyle(element);
					return (
						rect.width > 1 &&
						rect.height > 1 &&
						style.display !== "none" &&
						style.visibility !== "hidden" &&
						style.pointerEvents !== "none"
					);
				};
				const depth = (element: HTMLElement) => {
					let value = 0;
					let current: HTMLElement | null = element;
					while (current?.parentElement) {
						value += 1;
						current = current.parentElement;
					}
					return value;
				};
				const wanted = targetLabels.map(normalize);
				const candidates = Array.from(document.querySelectorAll(selector))
					.filter(
						(element): element is HTMLElement => element instanceof HTMLElement,
					)
					.map((element, index) => {
						const text = normalize(
							element.innerText || element.textContent || "",
						);
						const rect = element.getBoundingClientRect();
						const exact = wanted.includes(text);
						const prefix = wanted.some((label) => text.startsWith(`${label} `));
						return {
							index,
							text,
							exact,
							prefix,
							visible: visible(element),
							area: rect.width * rect.height,
							depth: depth(element),
						};
					})
					.filter(
						(candidate) =>
							candidate.visible && (candidate.exact || candidate.prefix),
					)
					.sort(
						(a, b) =>
							Number(b.exact) - Number(a.exact) ||
							a.area - b.area ||
							b.depth - a.depth ||
							a.text.length - b.text.length,
					);
				return candidates[candidateIndex]?.index ?? -1;
			},
			{ targetLabels: labels, candidateIndex, selector },
		);
		if (domIndex < 0) return false;

		if (typeof (page as { locator?: unknown }).locator === "function") {
			await page
				.locator(selector)
				.nth(domIndex)
				.click({ force: true, timeout: 3_000 });
		} else {
			await page.evaluate(
				({ domIndex, selector }) => {
					const target = document.querySelectorAll(selector)[domIndex];
					if (!(target instanceof HTMLElement)) return false;
					target.click();
					return true;
				},
				{ domIndex, selector },
			);
		}
		await page.waitForTimeout(550);
		return true;
	};

	const hasVisible = async (labels: string[]) => {
		const controls = await readProviderModeControls(page);
		const wanted = labels.map(normalized);
		return controls.some((control) =>
			wanted.some(
				(label) =>
					control.text === label || control.text.startsWith(`${label} `),
			),
		);
	};
	const openMenuUntilVisible = async (
		openerLabels: string[],
		targetLabels: string[],
	) => {
		for (let candidateIndex = 0; candidateIndex < 4; candidateIndex += 1) {
			if (!(await clickDoubaoControl(openerLabels, candidateIndex))) break;
			if (await hasVisible(targetLabels)) return true;
		}
		return false;
	};

	if (mode === "expert") {
		if (
			(await hasVisible(["专家", "Expert"])) &&
			!(await hasVisible(["快速", "Fast"]))
		) {
			return "expert";
		}
		if (!(await hasVisible(["专家", "Expert"]))) {
			const opened = await openMenuUntilVisible(
				["快速", "Fast"],
				["专家", "Expert"],
			);
			if (!opened) throw new Error("Doubao mode menu could not be opened");
		}
		const selected = await clickDoubaoControl(["专家", "Expert"]);
		if (!selected) throw new Error("Doubao Expert mode was not available");
		if (!(await hasVisible(["专家", "Expert"]))) {
			throw new Error("Doubao Expert mode could not be verified");
		}
		return "expert";
	}
	if (
		(await hasVisible(["快速", "Fast"])) &&
		!(await hasVisible(["专家", "Expert"]))
	) {
		return "fast";
	}
	if (!(await hasVisible(["快速", "Fast"]))) {
		const opened = await openMenuUntilVisible(
			["专家", "Expert"],
			["快速", "Fast"],
		);
		if (!opened) throw new Error("Doubao mode menu could not be opened");
	}
	const selected = await clickDoubaoControl(["快速", "Fast"]);
	if (!selected) throw new Error("Doubao Fast mode was not available");
	if (!(await hasVisible(["快速", "Fast"]))) {
		throw new Error("Doubao Fast mode could not be verified");
	}
	return "fast";
}

async function applyHunyuanMode(
	page: Page,
	mode: ProviderMode,
): Promise<ProviderMode> {
	const reasoning = mode === "reasoning" || mode === "reasoning_web_search";
	const search = mode === "auto_search" || mode === "reasoning_web_search";
	await ensureToggle(page, ["Deep Thinking", "深度思考"], reasoning);
	await ensureHunyuanSearchTool(page, search);
	if (reasoning && search) return "reasoning_web_search";
	if (search) return "auto_search";
	if (reasoning) return "reasoning";
	return "default";
}

async function readHunyuanSearchToolState(page: Page): Promise<boolean | null> {
	return page.evaluate(() => {
		const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
		const visible = (element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return (
				rect.width > 1 &&
				rect.height > 1 &&
				style.display !== "none" &&
				style.visibility !== "hidden"
			);
		};
		const searchLabels = ["Search", "搜索", "联网搜索"];
		const controls = Array.from(
			document.querySelectorAll(
				"button,[role='button'],[role='menuitem'],[role='option'],[data-state]",
			),
		).filter(
			(element): element is HTMLElement =>
				element instanceof HTMLElement && visible(element),
		);
		const selectedSearch = controls.some((element) => {
			const text = normalize(element.innerText || element.textContent || "");
			const signature = [
				element.getAttribute("aria-pressed"),
				element.getAttribute("aria-selected"),
				element.getAttribute("data-state"),
				element.className,
			]
				.filter(Boolean)
				.join(" ")
				.toLocaleLowerCase();
			return (
				searchLabels.some(
					(label) => text === label || text.startsWith(`${label} `),
				) && /(selected|active|checked|on|true)/.test(signature)
			);
		});
		if (selectedSearch) return true;

		const toolTrigger = controls.find((element) => {
			const text = normalize(element.innerText || element.textContent || "");
			const ariaLabel = normalize(element.getAttribute("aria-label") || "");
			return (
				["Tool", "工具"].includes(text) ||
				["Tool", "工具"].includes(ariaLabel) ||
				searchLabels.includes(text)
			);
		});
		if (!toolTrigger) return null;
		const triggerText = normalize(
			toolTrigger.innerText || toolTrigger.textContent || "",
		);
		return searchLabels.includes(triggerText);
	}, undefined);
}

async function ensureHunyuanSearchTool(
	page: Page,
	enabled: boolean,
): Promise<void> {
	const current = await readHunyuanSearchToolState(page);
	if (current === enabled) return;
	if (!enabled) {
		throw new Error(
			"Yuanbao Search is selected in a non-search cohort; start a fresh conversation before collecting",
		);
	}
	await selectHunyuanSearchTool(page);
	if ((await readHunyuanSearchToolState(page)) !== true) {
		throw new Error("Yuanbao Search tool state could not be verified");
	}
}

async function selectHunyuanSearchTool(page: Page): Promise<void> {
	const opened = await page.evaluate(() => {
		const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
		const visible = (element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return (
				rect.width > 1 &&
				rect.height > 1 &&
				style.display !== "none" &&
				style.visibility !== "hidden"
			);
		};
		const tool = Array.from(document.querySelectorAll("button,[role='button']"))
			.filter(
				(element): element is HTMLElement => element instanceof HTMLElement,
			)
			.find(
				(element) =>
					visible(element) &&
					["Tool", "工具"].includes(
						normalize(element.innerText || element.textContent || ""),
					),
			);
		if (!tool) return false;
		tool.click();
		return true;
	}, undefined);
	if (!opened) throw new Error("Yuanbao Tool menu is not available");
	await page.waitForTimeout(450);

	const selected = await page.evaluate(() => {
		const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
		const visible = (element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return (
				rect.width > 1 &&
				rect.height > 1 &&
				style.display !== "none" &&
				style.visibility !== "hidden"
			);
		};
		const candidates = Array.from(
			document.querySelectorAll("button,[role='menuitem'],[role='option'],div"),
		)
			.filter(
				(element): element is HTMLElement => element instanceof HTMLElement,
			)
			.filter(
				(element) =>
					visible(element) &&
					["Search", "搜索", "联网搜索"].includes(
						normalize(element.innerText || element.textContent || ""),
					),
			);
		const target = candidates.at(-1);
		if (!target) return false;
		target.click();
		return true;
	}, undefined);
	if (!selected) throw new Error("Yuanbao Search tool is not available");
	await page.waitForTimeout(500);

	const verified = await page.evaluate(() => {
		const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
		const visible = (element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return (
				rect.width > 1 &&
				rect.height > 1 &&
				style.display !== "none" &&
				style.visibility !== "hidden"
			);
		};
		return Array.from(
			document.querySelectorAll("button,[role='button'],[data-state]"),
		)
			.filter(
				(element): element is HTMLElement => element instanceof HTMLElement,
			)
			.some((element) => {
				if (!visible(element)) return false;
				const text = normalize(element.innerText || element.textContent || "");
				const signature = [
					element.getAttribute("aria-pressed"),
					element.getAttribute("aria-selected"),
					element.getAttribute("data-state"),
					element.className,
				]
					.filter(Boolean)
					.join(" ")
					.toLocaleLowerCase();
				return (
					["Search", "搜索", "联网搜索"].some((label) =>
						text.includes(label),
					) && /(selected|active|checked|on|true)/.test(signature)
				);
			});
	}, undefined);
	if (!verified) {
		throw new Error("Yuanbao Search tool click could not be verified");
	}
}

async function setQwenToolsEnabled(
	page: Page,
	enabled: boolean,
): Promise<void> {
	const state = await page.evaluate(() => {
		const toolsItem = Array.from(
			document.querySelectorAll("[data-menu-id]"),
		).find((element) =>
			element.getAttribute("data-menu-id")?.endsWith("-tools"),
		);
		const toolsSwitch = toolsItem?.querySelector("[role='switch']");
		if (toolsSwitch instanceof HTMLElement) {
			return toolsSwitch.getAttribute("aria-checked") === "true";
		}
		const plusIcon = Array.from(document.querySelectorAll("use")).find(
			(element) => {
				const href =
					element.getAttribute("href") ?? element.getAttribute("xlink:href");
				return (
					href === "#icon-line-plus-01" &&
					Boolean(element.closest(".mode-select"))
				);
			},
		);
		const trigger = plusIcon?.closest(
			".ant-dropdown-trigger,button,[role='button']",
		);
		if (!(trigger instanceof HTMLElement)) return null;
		trigger.click();
		return null;
	}, undefined);
	if (state === enabled) {
		await page.keyboard.press("Escape").catch(() => undefined);
		return;
	}
	await page.waitForTimeout(450);

	const changed = await page.evaluate((shouldEnable) => {
		const toolsItem = Array.from(
			document.querySelectorAll("[data-menu-id]"),
		).find((element) =>
			element.getAttribute("data-menu-id")?.endsWith("-tools"),
		);
		const toolsSwitch = toolsItem?.querySelector("[role='switch']");
		if (!(toolsSwitch instanceof HTMLElement)) return null;
		const current = toolsSwitch.getAttribute("aria-checked") === "true";
		if (current !== shouldEnable) toolsSwitch.click();
		return current;
	}, enabled);
	if (changed === null) {
		await page.keyboard.press("Escape").catch(() => undefined);
		if (!enabled) return;
		throw new Error("Qwen Tools switch is not available");
	}
	if (changed === enabled) {
		await page.keyboard.press("Escape").catch(() => undefined);
		return;
	}
	await page.waitForTimeout(450);

	let verified = await page.evaluate(() => {
		const toolsItem = Array.from(
			document.querySelectorAll("[data-menu-id]"),
		).find((element) =>
			element.getAttribute("data-menu-id")?.endsWith("-tools"),
		);
		const toolsSwitch = toolsItem?.querySelector("[role='switch']");
		return toolsSwitch instanceof HTMLElement
			? toolsSwitch.getAttribute("aria-checked") === "true"
			: null;
	}, undefined);
	if (verified === null) {
		const reopened = await page.evaluate(() => {
			const plusIcon = Array.from(document.querySelectorAll("use")).find(
				(element) => {
					const href =
						element.getAttribute("href") ?? element.getAttribute("xlink:href");
					return (
						href === "#icon-line-plus-01" &&
						Boolean(element.closest(".mode-select"))
					);
				},
			);
			const trigger = plusIcon?.closest(".ant-dropdown-trigger");
			if (!(trigger instanceof HTMLElement)) return false;
			trigger.click();
			return true;
		}, undefined);
		if (!reopened) throw new Error("Qwen Tools menu could not be reopened");
		await page.waitForTimeout(450);
		verified = await page.evaluate(() => {
			const toolsItem = Array.from(
				document.querySelectorAll("[data-menu-id]"),
			).find((element) =>
				element.getAttribute("data-menu-id")?.endsWith("-tools"),
			);
			const toolsSwitch = toolsItem?.querySelector("[role='switch']");
			return toolsSwitch instanceof HTMLElement
				? toolsSwitch.getAttribute("aria-checked") === "true"
				: null;
		}, undefined);
	}
	await page.keyboard.press("Escape").catch(() => null);
	if (verified !== enabled) {
		throw new Error("Qwen Tools switch state could not be verified");
	}
}

const QWEN_WEB_SEARCH_LABELS = [
	"Web search",
	"Web Search",
	"网页搜索",
	"联网搜索",
] as const;

async function isQwenWebSearchSelected(page: Page): Promise<boolean> {
	return page.evaluate(
		(labels) => {
			const normalize = (value: string) =>
				value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
			const wanted = labels.map(normalize);
			return Array.from(
				document.querySelectorAll<HTMLElement>(
					".mode-select-current-mode, [class*='mode-select-current-mode']",
				),
			).some((element) => {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				if (
					rect.width <= 1 ||
					rect.height <= 1 ||
					style.display === "none" ||
					style.visibility === "hidden"
				) {
					return false;
				}
				const text = normalize(element.innerText || element.textContent || "");
				return wanted.some(
					(label) => text === label || text.startsWith(`${label} `),
				);
			});
		},
		[...QWEN_WEB_SEARCH_LABELS],
	);
}

async function clickQwenMenuItem(
	page: Page,
	labels: readonly string[],
): Promise<void> {
	const clicked = await page.evaluate(
		(targetLabels) => {
			const normalize = (value: string) =>
				value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
			const wanted = targetLabels.map(normalize);
			const visible = (element: HTMLElement) => {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return (
					rect.width > 1 &&
					rect.height > 1 &&
					style.display !== "none" &&
					style.visibility !== "hidden"
				);
			};
			const selector = [
				"[role='menuitem']",
				".ant-dropdown-menu-item",
				".ant-dropdown-menu-submenu-title",
				"[class*='menu-item']",
				"[class*='submenu-title']",
			].join(",");
			const target = Array.from(
				document.querySelectorAll<HTMLElement>(selector),
			)
				.filter(visible)
				.find((element) => {
					const values = [
						normalize(element.innerText || element.textContent || ""),
						normalize(element.getAttribute("aria-label") || ""),
						normalize(element.getAttribute("title") || ""),
					];
					return wanted.some((label) =>
						values.some(
							(value) => value === label || value.startsWith(`${label} `),
						),
					);
				});
			if (!target) return false;
			for (const eventType of [
				"pointerover",
				"pointerenter",
				"mouseover",
				"mouseenter",
				"mousemove",
			]) {
				const EventConstructor =
					eventType.startsWith("pointer") &&
					typeof window.PointerEvent !== "undefined"
						? window.PointerEvent
						: window.MouseEvent;
				target.dispatchEvent(
					new EventConstructor(eventType, {
						bubbles: !eventType.endsWith("enter"),
						cancelable: true,
						view: window,
					}),
				);
			}
			target.click();
			return true;
		},
		[...labels],
	);
	if (!clicked) {
		throw new Error(`Qwen menu item not found: ${labels.join(" / ")}`);
	}
	await page.waitForTimeout(450);
}

async function ensureQwenWebSearchSelected(
	page: Page,
	enabled: boolean,
): Promise<void> {
	const selected = await isQwenWebSearchSelected(page);
	if (selected === enabled) return;
	if (!enabled) {
		throw new Error(
			"Qwen Web Search remains selected in a non-search cohort; start a fresh conversation before collecting",
		);
	}

	const opened = await page.evaluate(() => {
		const plusIcon = Array.from(document.querySelectorAll("use")).find(
			(element) => {
				const href =
					element.getAttribute("href") ?? element.getAttribute("xlink:href");
				return (
					href === "#icon-line-plus-01" &&
					Boolean(element.closest(".mode-select"))
				);
			},
		);
		const trigger = plusIcon?.closest(
			".ant-dropdown-trigger,button,[role='button']",
		);
		if (!(trigger instanceof HTMLElement)) return false;
		trigger.click();
		return true;
	}, undefined);
	if (!opened) throw new Error("Qwen + menu could not be opened");
	await page.waitForTimeout(450);

	await clickQwenMenuItem(page, ["More", "更多"]);
	await clickQwenMenuItem(page, QWEN_WEB_SEARCH_LABELS);
	await page.keyboard.press("Escape").catch(() => null);

	if (!(await isQwenWebSearchSelected(page))) {
		throw new Error(
			"Qwen Web Search selection could not be verified in the composer",
		);
	}
}

async function applyQwenMode(
	page: Page,
	mode: ProviderMode,
): Promise<ProviderMode> {
	const searchEnabled =
		mode === "web_search" ||
		mode === "reasoning_web_search" ||
		mode === "auto_search";
	const actualMode =
		mode === "reasoning" || mode === "reasoning_web_search"
			? "reasoning"
			: mode === "fast" || mode === "web_search"
				? "fast"
				: "auto";
	const labels =
		actualMode === "reasoning"
			? ["Thinking", "Deep Thinking", "思考", "深度思考"]
			: actualMode === "fast"
				? ["Fast", "快速"]
				: ["Auto", "自动"];
	const currentLabel = page.locator(".qwen-select-thinking-label-text").first();
	if ((await currentLabel.count().catch(() => 0)) > 0) {
		const wanted = labels.map(normalized);
		const current = normalized((await currentLabel.readInputValue()) ?? "");
		if (!wanted.includes(current)) {
			const selector = page
				.locator(".qwen-thinking-selector .ant-select-selector")
				.first();
			if (!(await selector.isVisible().catch(() => false))) {
				throw new Error("Qwen mode selector is not visible");
			}
			await selector.click({ force: true, timeout: 3_000 });
			await page.waitForTimeout(450);

			let selected = false;
			for (const optionSelector of [
				"[role='option']",
				".ant-select-item-option",
			]) {
				const options = page.locator(optionSelector);
				const count = await options.count().catch(() => 0);
				for (let index = 0; index < count; index += 1) {
					const option = options.nth(index);
					if (!(await option.isVisible().catch(() => false))) continue;
					const text = normalized((await option.readInputValue()) ?? "");
					if (
						!wanted.some(
							(label) => text === label || text.startsWith(`${label} `),
						)
					) {
						continue;
					}
					await option.click({ force: true, timeout: 3_000 });
					selected = true;
					break;
				}
				if (selected) break;
			}
			if (!selected)
				throw new Error(`Qwen mode option not found: ${labels.join(" / ")}`);
			await page.waitForTimeout(500);
		}

		const verified = normalized((await currentLabel.readInputValue()) ?? "");
		if (!wanted.includes(verified)) {
			throw new Error(`Qwen mode did not change to ${labels[0]}`);
		}
		if (searchEnabled) {
			await setQwenToolsEnabled(page, true);
			await ensureQwenWebSearchSelected(page, true);
		} else {
			await ensureQwenWebSearchSelected(page, false);
			await setQwenToolsEnabled(page, false);
		}
		if (searchEnabled && actualMode === "reasoning")
			return "reasoning_web_search";
		if (searchEnabled && actualMode === "fast") return "web_search";
		if (searchEnabled) return "auto_search";
		return actualMode;
	}

	if (actualMode === "reasoning") {
		await clickControl(page, labels, { openFirst: ["Auto", "自动"] });
	} else if (actualMode === "fast") {
		await clickControl(page, labels, { openFirst: ["Auto", "自动"] });
	} else {
		await clickControl(page, labels);
	}
	if (searchEnabled) {
		await setQwenToolsEnabled(page, true);
		await ensureQwenWebSearchSelected(page, true);
	} else {
		await ensureQwenWebSearchSelected(page, false);
		await setQwenToolsEnabled(page, false);
	}
	if (searchEnabled && actualMode === "reasoning")
		return "reasoning_web_search";
	if (searchEnabled && actualMode === "fast") return "web_search";
	if (searchEnabled) return "auto_search";
	return actualMode;
}

export async function applyOfficialWebMode(args: {
	page: Page;
	provider: Provider;
	mode: ProviderMode;
}): Promise<ProviderMode> {
	try {
		const actual =
			args.provider === "deepseek"
				? await applyDeepSeekMode(args.page, args.mode)
				: args.provider === "doubao"
					? await applyDoubaoMode(args.page, args.mode)
					: args.provider === "hunyuan"
						? await applyHunyuanMode(args.page, args.mode)
						: args.provider === "qwen"
							? await applyQwenMode(args.page, args.mode)
							: args.mode;
		logger.log(
			`[${args.provider}] official Web mode verified: ${args.mode} -> ${actual}`,
		);
		return actual;
	} catch (error) {
		throw new ExternalServiceError(
			args.provider,
			`Official Web mode "${args.mode}" is unavailable or could not be verified: ${toErrorMessage(error)}`,
			422,
			{
				provider: args.provider,
				requestedMode: args.mode,
				visibleControls: await readProviderModeControls(args.page).catch(
					() => [],
				),
			},
			error,
		);
	}
}
