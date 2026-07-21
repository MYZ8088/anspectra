import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { ExternalServiceError, toErrorMessage } from "@anspectra/errors";
import {
	getProviderProfileDir,
	getRuntimeProfileSeedPlan,
	markRuntimeProfileSeeded,
	prepareRuntimeProfileBootstrap,
} from "@anspectra/services/agent-auth";
import type { Provider, ProviderIdentityManifest } from "@anspectra/types";
import { logger } from "@anspectra/utils";
import { firefox } from "playwright-core";
import type { BrowserContext as RawBrowserContext } from "playwright-core";
import { resolveCamoufoxLaunchOptions } from "./camoufox.js";
import { resolveHostDisplayBounds } from "./displayBounds.js";
import { PlaywrightBrowserContextCompat } from "./playwrightCompat.js";
import type { Browser, BrowserContext, Page } from "./runtimeTypes.js";
import { TaskPageRegistry } from "./taskPageRegistry.js";
import {
	fitProviderWindow as fitNativeWindow,
	focusProviderWindow as focusNativeWindow,
	minimizeProviderWindow as minimizeNativeWindow,
	normalizeFirefoxWindowStore,
} from "./windowControl.js";
import {
	type ProviderWindowGeometry,
	normalizePersistentWindowGeometry,
} from "./windowGeometry.js";

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export type ProviderSessionVisibility = "headless" | "headful";

export type ProviderSessionRequest = {
	taskId: string;
	visibility: ProviderSessionVisibility;
};

type ProviderSession = {
	provider: Provider;
	rawContext: RawBrowserContext;
	context: PlaywrightBrowserContextCompat;
	browser: Browser;
	leaseCount: number;
	humanHold: boolean;
	heldPage: Page | null;
	heldTaskId: string | null;
	activeTaskId: string | null;
	visibility: ProviderSessionVisibility;
	launchedByTaskId: string;
	idleTimer: ReturnType<typeof setTimeout> | null;
	closed: boolean;
	windowGeometry: ProviderWindowGeometry;
	pageRegistry: TaskPageRegistry;
	startupPage: Page | null;
};

type ProviderSessionLease = {
	browser: Browser;
	context: BrowserContext;
	page: Page;
	profileDir: string;
	taskId: string;
	visibility: ProviderSessionVisibility;
	release: () => Promise<void>;
	invalidate: () => Promise<void>;
	holdForHuman: (page: Page) => Promise<void>;
	resumePage: Page | null;
	minimizeWindow: () => Promise<void>;
	focusWindow: () => Promise<void>;
};

const sessions = new Map<Provider, ProviderSession>();
const launches = new Map<Provider, Promise<ProviderSession>>();

function identityManifestPath(profileDir: string): string {
	return path.join(path.dirname(profileDir), "identity.json");
}

function networkFingerprint(): string {
	const addresses = Object.entries(networkInterfaces())
		.flatMap(([name, entries]) =>
			(entries ?? [])
				.filter((entry) => !entry.internal)
				.map((entry) => `${name}:${entry.family}:${entry.address}`),
		)
		.sort();
	return createHash("sha256").update(addresses.join("\n")).digest("hex");
}

export function assertBrowserTaskId(taskId: string): string {
	const normalized = taskId.trim();
	if (!normalized) {
		throw new ExternalServiceError(
			"browser",
			"A browser page cannot be created without a task ID",
		);
	}
	if (normalized.length > 240) {
		throw new ExternalServiceError(
			"browser",
			"Browser task ID exceeds the 240-character limit",
		);
	}
	return normalized;
}

function normalizePersistentLaunchOptions(
	options: Awaited<ReturnType<typeof resolveCamoufoxLaunchOptions>>,
): Record<string, unknown> {
	const env = Object.fromEntries(
		Object.entries((options.env ?? {}) as Record<string, string>).filter(
			([key]) => key !== "MOZ_HEADLESS",
		),
	);
	return Object.fromEntries(
		Object.entries({ ...options, env }).filter(
			([key]) => !["headless", "virtual_display", "proxy"].includes(key),
		),
	);
}

export function applyPersistentVisibility(
	options: Record<string, unknown>,
	visibility: ProviderSessionVisibility,
): Record<string, unknown> {
	const currentEnv = (options.env ?? {}) as Record<string, string>;
	const env =
		visibility === "headless"
			? { ...currentEnv, MOZ_HEADLESS: "1" }
			: Object.fromEntries(
					Object.entries(currentEnv).filter(([key]) => key !== "MOZ_HEADLESS"),
				);
	return {
		...options,
		env,
		headless: visibility === "headless",
	};
}

async function writeIdentityManifest(
	filePath: string,
	manifest: ProviderIdentityManifest,
): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	const temporary = `${filePath}.${process.pid}.tmp`;
	await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
	await rename(temporary, filePath);
}

export async function getPersistentLaunchOptions(args: {
	provider: Provider;
	profileDir: string;
	visibility?: ProviderSessionVisibility;
}): Promise<{
	options: Record<string, unknown>;
	geometry: ProviderWindowGeometry;
}> {
	const filePath = identityManifestPath(args.profileDir);
	const currentNetwork = networkFingerprint();
	const hostDisplay = await resolveHostDisplayBounds();
	let manifest: ProviderIdentityManifest | null = null;

	if (existsSync(filePath)) {
		try {
			manifest = JSON.parse(
				await readFile(filePath, "utf8"),
			) as ProviderIdentityManifest;
		} catch (error) {
			throw new ExternalServiceError(
				args.provider,
				`Persistent identity manifest is unreadable. Reset this provider connection explicitly before generating a new identity: ${toErrorMessage(error)}`,
			);
		}
	}

	if (manifest) {
		if (
			manifest.schemaVersion !== 1 ||
			manifest.provider !== args.provider ||
			manifest.profileDir !== args.profileDir
		) {
			throw new ExternalServiceError(
				args.provider,
				"Persistent identity manifest does not match this provider profile. Reset the provider connection explicitly.",
			);
		}
		const executablePath = manifest.launchOptions.executablePath;
		if (typeof executablePath !== "string" || !existsSync(executablePath)) {
			throw new ExternalServiceError(
				args.provider,
				"The browser executable recorded for this provider identity is missing. Run pnpm camoufox:setup before reconnecting the provider.",
			);
		}
		const normalized = normalizePersistentWindowGeometry(
			manifest.launchOptions,
			hostDisplay,
			manifest.windowGeometry,
		);
		manifest.launchOptions = normalized.launchOptions;
		manifest.fingerprintHash = createHash("sha256")
			.update(JSON.stringify(normalized.launchOptions))
			.digest("hex");
		manifest.lastUsedAt = new Date().toISOString();
		manifest.lastNetworkFingerprint = currentNetwork;
		manifest.windowGeometry = {
			...normalized.geometry,
			appliedAt: new Date().toISOString(),
		};
		await writeIdentityManifest(filePath, manifest);
		if (manifest.firstNetworkFingerprint !== currentNetwork) {
			logger.warn(
				`[${args.provider}] network environment changed; preserving the existing browser identity`,
			);
		}
		return {
			options: applyPersistentVisibility(
				manifest.launchOptions,
				args.visibility ?? "headless",
			),
			geometry: normalized.geometry,
		};
	}

	const generated = normalizePersistentLaunchOptions(
		await resolveCamoufoxLaunchOptions({
			provider: args.provider,
			headlessMode: "headful",
		}),
	);
	const normalized = normalizePersistentWindowGeometry(generated, hostDisplay);
	const now = new Date().toISOString();
	manifest = {
		schemaVersion: 1,
		provider: args.provider,
		profileDir: args.profileDir,
		createdAt: now,
		lastUsedAt: now,
		fingerprintHash: createHash("sha256")
			.update(JSON.stringify(normalized.launchOptions))
			.digest("hex"),
		firstNetworkFingerprint: currentNetwork,
		lastNetworkFingerprint: currentNetwork,
		launchOptions: normalized.launchOptions,
		windowGeometry: { ...normalized.geometry, appliedAt: now },
	};
	await writeIdentityManifest(filePath, manifest);
	return {
		options: applyPersistentVisibility(
			normalized.launchOptions,
			args.visibility ?? "headless",
		),
		geometry: normalized.geometry,
	};
}

async function closeSession(session: ProviderSession): Promise<void> {
	if (session.closed) return;
	session.closed = true;
	if (session.idleTimer) clearTimeout(session.idleTimer);
	sessions.delete(session.provider);
	session.pageRegistry.clear();
	await session.rawContext.close().catch(() => null);
	logger.log(`[${session.provider}] persistent browser session closed`);
}

async function launchSession(
	provider: Provider,
	request: ProviderSessionRequest,
): Promise<ProviderSession> {
	const taskId = assertBrowserTaskId(request.taskId);
	const seedPlan = await getRuntimeProfileSeedPlan(provider);
	if (seedPlan.shouldBootstrap) {
		prepareRuntimeProfileBootstrap(provider);
	}
	const profileDir = seedPlan.userDataDir;
	const { options, geometry } = await getPersistentLaunchOptions({
		provider,
		profileDir,
		visibility: request.visibility,
	});
	if (request.visibility === "headful") {
		await normalizeFirefoxWindowStore(profileDir, geometry);
	}

	try {
		const rawContext = await firefox.launchPersistentContext(profileDir, {
			...(options as Parameters<typeof firefox.launchPersistentContext>[1]),
			headless: request.visibility === "headless",
			viewport:
				request.visibility === "headless"
					? { width: geometry.width, height: geometry.height }
					: null,
		});
		if (request.visibility === "headful") {
			const observedGeometry = await fitNativeWindow(profileDir, geometry);
			if (observedGeometry) {
				logger.log(
					`[${provider}] browser window fitted to ${observedGeometry.width}x${observedGeometry.height} at ${observedGeometry.x},${observedGeometry.y}`,
				);
			} else {
				logger.warn(
					`[${provider}] browser window could not be verified against ${geometry.width}x${geometry.height} at ${geometry.x},${geometry.y}`,
				);
			}
		}
		if (seedPlan.shouldBootstrap && seedPlan.authState) {
			const cookies = (seedPlan.authState.cookies ?? []).filter(
				(cookie): cookie is typeof cookie & { name: string; value: string } =>
					Boolean(cookie.name && cookie.value),
			);
			if (cookies.length > 0) {
				await rawContext.addCookies(
					cookies as Parameters<typeof rawContext.addCookies>[0],
				);
			}
			const origins = (seedPlan.authState.origins ?? []).filter(
				(origin): origin is typeof origin & { origin: string } =>
					Boolean(origin.origin),
			);
			if (origins.length > 0) {
				await rawContext.addInitScript((originStates) => {
					const current = originStates.find(
						(state) => state.origin === window.location.origin,
					);
					for (const item of current?.localStorage ?? []) {
						window.localStorage.setItem(item.name, item.value);
					}
				}, origins);
			}
			if (seedPlan.authStateHash) {
				await markRuntimeProfileSeeded(provider, seedPlan.authStateHash);
			}
			logger.log(`[${provider}] migrated saved auth into persistent profile`);
		}
		const context = new PlaywrightBrowserContextCompat(rawContext);
		const pageRegistry = new TaskPageRegistry();
		const startupPages = context.existingPages();
		const startupPage =
			startupPages.find((page) => page.url() === "about:blank") ??
			startupPages[0] ??
			null;
		for (const extraPage of startupPages) {
			if (extraPage !== startupPage) await extraPage.close().catch(() => null);
		}
		if (startupPage) pageRegistry.bind(startupPage, taskId);
		const session: ProviderSession = {
			provider,
			rawContext,
			context,
			browser: context.getBrowser(),
			leaseCount: 0,
			humanHold: false,
			heldPage: null,
			heldTaskId: null,
			activeTaskId: null,
			visibility: request.visibility,
			launchedByTaskId: taskId,
			idleTimer: null,
			closed: false,
			windowGeometry: geometry,
			pageRegistry,
			startupPage,
		};

		context.on("page", (page) => {
			const ownerTaskId = session.activeTaskId ?? session.heldTaskId;
			if (!ownerTaskId) {
				logger.warn(
					`[${provider}] closing a browser page created without an active task`,
				);
				void page.close().catch(() => null);
				return;
			}
			try {
				session.pageRegistry.bind(page, ownerTaskId);
			} catch (error) {
				logger.warn(`[${provider}] ${toErrorMessage(error)}`);
				void page.close().catch(() => null);
			}
		});

		rawContext.on("close", () => {
			session.closed = true;
			if (session.idleTimer) clearTimeout(session.idleTimer);
			if (sessions.get(provider) === session) sessions.delete(provider);
		});

		sessions.set(provider, session);
		logger.log(
			`[${provider}] persistent ${request.visibility} browser session ready for task ${taskId}: ${profileDir}`,
		);
		return session;
	} catch (error) {
		throw new ExternalServiceError(
			provider,
			`persistent browser launch failed: ${toErrorMessage(error)}`,
			502,
			{ provider, profileDir },
			error,
		);
	}
}

async function claimTaskPage(
	session: ProviderSession,
	taskId: string,
): Promise<Page> {
	const startupPage = session.startupPage;
	if (startupPage) {
		session.startupPage = null;
		if (await startupPage.ping().catch(() => false)) {
			session.pageRegistry.assertOwnedBy(startupPage, taskId);
			return startupPage;
		}
		session.pageRegistry.releaseTask(taskId);
		await startupPage.close().catch(() => null);
	}

	const page = await session.context.newPage();
	session.pageRegistry.bind(page, taskId);
	session.pageRegistry.assertOwnedBy(page, taskId);
	return page;
}

async function closeTaskPages(
	session: ProviderSession,
	taskId: string,
): Promise<void> {
	const pages = session.pageRegistry.releaseTask(taskId);
	await Promise.all(pages.map((page) => page.close().catch(() => null)));
}

async function getOrLaunchSession(
	provider: Provider,
	request: ProviderSessionRequest,
): Promise<ProviderSession> {
	const existing = sessions.get(provider);
	if (existing && !existing.closed) {
		if (existing.heldPage && existing.heldTaskId === request.taskId) {
			if (existing.visibility === request.visibility) return existing;
			if (existing.humanHold) {
				throw new ExternalServiceError(
					provider,
					"Complete the visible human-verification handoff before resuming headless collection",
				);
			}

			const pageUrl = existing.heldPage.url();
			await closeSession(existing);
			const resumed = await launchSession(provider, request);
			resumed.activeTaskId = request.taskId;
			const resumedPage = await claimTaskPage(resumed, request.taskId);
			const canRestorePage = Boolean(pageUrl && pageUrl !== "about:blank");
			const restored = canRestorePage
				? await resumedPage
						.goto(pageUrl, {
							waitUntil: "domcontentloaded",
							timeout: 60_000,
						})
						.then(() => true)
						.catch(() => false)
				: false;
			resumed.activeTaskId = null;
			if (restored) {
				resumed.heldPage = resumedPage;
				resumed.heldTaskId = request.taskId;
				logger.log(
					`[${provider}] human handoff completed; restored task ${request.taskId} in a headless session`,
				);
			} else {
				await closeTaskPages(resumed, request.taskId);
				logger.warn(
					`[${provider}] human handoff page could not be restored; continuing task ${request.taskId} from the provider entry page`,
				);
			}
			return resumed;
		}
		if (existing.visibility === request.visibility) return existing;
		if (existing.leaseCount > 0 || existing.humanHold) {
			throw new ExternalServiceError(
				provider,
				`Cannot switch the provider browser from ${existing.visibility} to ${request.visibility} while task ${existing.activeTaskId ?? existing.heldTaskId ?? "unknown"} owns it`,
			);
		}
		await closeSession(existing);
	}

	const inFlight = launches.get(provider);
	if (inFlight) {
		await inFlight;
		return getOrLaunchSession(provider, request);
	}

	const launch = launchSession(provider, request).finally(() =>
		launches.delete(provider),
	);
	launches.set(provider, launch);
	return launch;
}

export async function acquireProviderSession(
	provider: Provider,
	request: ProviderSessionRequest,
): Promise<ProviderSessionLease> {
	const taskId = assertBrowserTaskId(request.taskId);
	const session = await getOrLaunchSession(provider, { ...request, taskId });
	if (session.leaseCount > 0) {
		throw new ExternalServiceError(
			provider,
			`Provider browser is already owned by task ${session.activeTaskId ?? "unknown"}`,
		);
	}
	if (session.idleTimer) {
		clearTimeout(session.idleTimer);
		session.idleTimer = null;
	}
	session.leaseCount += 1;
	session.activeTaskId = taskId;
	const resumePage = session.heldTaskId === taskId ? session.heldPage : null;
	session.heldPage = null;
	session.heldTaskId = null;
	if (resumePage) session.humanHold = false;
	const page = resumePage ?? (await claimTaskPage(session, taskId));
	session.pageRegistry.assertOwnedBy(page, taskId);
	let released = false;

	return {
		browser: session.browser,
		context: session.context,
		page,
		profileDir: getProviderProfileDir(provider),
		taskId,
		visibility: session.visibility,
		resumePage,
		release: async () => {
			if (released) return;
			released = true;
			session.leaseCount = Math.max(0, session.leaseCount - 1);
			if (session.activeTaskId === taskId) session.activeTaskId = null;
			if (session.leaseCount > 0 || session.closed) return;
			if (session.humanHold) return;
			await closeTaskPages(session, taskId);
			if (session.visibility === "headful") {
				await closeSession(session);
				return;
			}
			session.idleTimer = setTimeout(() => {
				void closeSession(session);
			}, SESSION_IDLE_TIMEOUT_MS);
		},
		invalidate: async () => {
			released = true;
			session.leaseCount = Math.max(0, session.leaseCount - 1);
			if (session.activeTaskId === taskId) session.activeTaskId = null;
			session.pageRegistry.releaseTask(taskId);
			await closeSession(session);
		},
		holdForHuman: async (heldPage) => {
			if (session.visibility === "headless") {
				logger.warn(
					`[${provider}] human verification required for task ${taskId}; replacing the headless session with a visible handoff window`,
				);
				const pageUrl = heldPage.url();
				await closeSession(session);
				const humanSession = await launchSession(provider, {
					taskId,
					visibility: "headful",
				});
				humanSession.activeTaskId = taskId;
				const humanPage = await claimTaskPage(humanSession, taskId);
				if (pageUrl && pageUrl !== "about:blank") {
					await humanPage
						.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 60_000 })
						.catch(() => null);
				}
				humanSession.humanHold = true;
				humanSession.heldPage = humanPage;
				humanSession.heldTaskId = taskId;
				humanSession.activeTaskId = null;
				await fitNativeWindow(
					getProviderProfileDir(provider),
					humanSession.windowGeometry,
				);
				await focusNativeWindow(getProviderProfileDir(provider));
				return;
			}
			session.humanHold = true;
			session.pageRegistry.assertOwnedBy(heldPage, taskId);
			session.heldPage = heldPage;
			session.heldTaskId = taskId;
			if (session.idleTimer) {
				clearTimeout(session.idleTimer);
				session.idleTimer = null;
			}
		},
		minimizeWindow: () =>
			session.visibility === "headful"
				? minimizeNativeWindow(getProviderProfileDir(provider))
				: Promise.resolve(),
		focusWindow: async () => {
			const page = session.rawContext.pages().at(-1);
			await page?.bringToFront().catch(() => null);
			await fitNativeWindow(
				getProviderProfileDir(provider),
				session.windowGeometry,
			);
			await focusNativeWindow(getProviderProfileDir(provider));
		},
	};
}

export function releaseProviderHumanHold(
	provider: Provider,
	taskId: string,
): void {
	const session = sessions.get(provider);
	if (!session || session.closed) return;
	if (session.heldTaskId && session.heldTaskId !== taskId) return;
	session.humanHold = false;
	if (session.leaseCount === 0) {
		session.idleTimer = setTimeout(() => {
			void closeSession(session);
		}, SESSION_IDLE_TIMEOUT_MS);
	}
}

export async function focusProviderSession(
	provider: Provider,
): Promise<boolean> {
	const session = sessions.get(provider);
	if (!session || session.closed || session.visibility !== "headful")
		return false;
	const page = session.rawContext.pages().at(-1);
	await page?.bringToFront().catch(() => null);
	await fitNativeWindow(
		getProviderProfileDir(provider),
		session.windowGeometry,
	);
	await focusNativeWindow(getProviderProfileDir(provider));
	return true;
}

export async function closeAllProviderSessions(): Promise<void> {
	await Promise.all([...sessions.values()].map(closeSession));
}
