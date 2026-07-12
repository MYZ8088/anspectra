import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { ExternalServiceError, toErrorMessage } from "@aloom/errors";
import {
	getProviderProfileDir,
	getRuntimeProfileSeedPlan,
	markRuntimeProfileSeeded,
	prepareRuntimeProfileBootstrap,
} from "@aloom/services/agent-auth";
import type { Provider, ProviderIdentityManifest } from "@aloom/types";
import { logger } from "@aloom/utils";
import { firefox } from "playwright-core";
import type { BrowserContext as RawBrowserContext } from "playwright-core";
import { resolveCamoufoxLaunchOptions } from "./camoufox.js";
import { resolveHostDisplayBounds } from "./displayBounds.js";
import { PlaywrightBrowserContextCompat } from "./playwrightCompat.js";
import type { Browser, BrowserContext, Page } from "./runtimeTypes.js";
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
	const env = { ...((options.env ?? {}) as Record<string, string>) };
	delete env.MOZ_HEADLESS;
	const normalized: Record<string, unknown> = {
		...options,
		env,
	};
	delete normalized.headless;
	delete normalized.virtual_display;
	delete normalized.proxy;
	return normalized;
}

export function applyPersistentVisibility(
	options: Record<string, unknown>,
	visibility: ProviderSessionVisibility,
): Record<string, unknown> {
	const env = { ...((options.env ?? {}) as Record<string, string>) };
	if (visibility === "headless") env.MOZ_HEADLESS = "1";
	else delete env.MOZ_HEADLESS;
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
					args.visibility ?? "headful",
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
			args.visibility ?? "headful",
		),
		geometry: normalized.geometry,
	};
}

async function closeSession(session: ProviderSession): Promise<void> {
	if (session.closed) return;
	session.closed = true;
	if (session.idleTimer) clearTimeout(session.idleTimer);
	sessions.delete(session.provider);
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
		};

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

async function getOrLaunchSession(
	provider: Provider,
	request: ProviderSessionRequest,
): Promise<ProviderSession> {
	const existing = sessions.get(provider);
	if (existing && !existing.closed) {
		if (
			existing.heldPage &&
			existing.heldTaskId === request.taskId
		) {
			return existing;
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
	if (
		session.activeTaskId &&
		session.activeTaskId !== taskId &&
		session.leaseCount > 0
	) {
		throw new ExternalServiceError(
			provider,
			`Provider browser is already owned by task ${session.activeTaskId}`,
		);
	}
	if (session.idleTimer) {
		clearTimeout(session.idleTimer);
		session.idleTimer = null;
	}
	session.leaseCount += 1;
	session.activeTaskId = taskId;
	const resumePage =
		session.heldTaskId === taskId ? session.heldPage : null;
	session.heldPage = null;
	session.heldTaskId = null;
	if (resumePage) session.humanHold = false;
	const page = resumePage ?? (await session.context.newPage());
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
			await closeSession(session);
		},
		holdForHuman: async (heldPage) => {
			if (session.visibility === "headless") {
				const pageUrl = heldPage.url();
				await closeSession(session);
				const humanSession = await launchSession(provider, {
					taskId,
					visibility: "headful",
				});
				const humanPage = await humanSession.context.newPage();
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

export function releaseProviderHumanHold(provider: Provider): void {
	const session = sessions.get(provider);
	if (!session || session.closed) return;
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
	if (!session || session.closed || session.visibility !== "headful") return false;
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
