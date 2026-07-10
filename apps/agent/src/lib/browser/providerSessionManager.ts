import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { ExternalServiceError, toErrorMessage } from "@answerloom/errors";
import {
	getProviderProfileDir,
	getRuntimeProfileSeedPlan,
	markRuntimeProfileSeeded,
	prepareRuntimeProfileBootstrap,
} from "@answerloom/services/agent-auth";
import type { Provider, ProviderIdentityManifest } from "@answerloom/types";
import { logger } from "@answerloom/utils";
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

type ProviderSession = {
	provider: Provider;
	rawContext: RawBrowserContext;
	context: PlaywrightBrowserContextCompat;
	browser: Browser;
	leaseCount: number;
	humanHold: boolean;
	heldPage: Page | null;
	idleTimer: ReturnType<typeof setTimeout> | null;
	closed: boolean;
	windowGeometry: ProviderWindowGeometry;
};

type ProviderSessionLease = {
	browser: Browser;
	context: BrowserContext;
	profileDir: string;
	release: () => Promise<void>;
	invalidate: () => Promise<void>;
	holdForHuman: (page: Page) => void;
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

function normalizePersistentLaunchOptions(
	options: Awaited<ReturnType<typeof resolveCamoufoxLaunchOptions>>,
): Record<string, unknown> {
	const env = { ...((options.env ?? {}) as Record<string, string>) };
	delete env.MOZ_HEADLESS;
	const normalized: Record<string, unknown> = {
		...options,
		env,
		headless: false,
	};
	delete normalized.proxy;
	return normalized;
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
			options: manifest.launchOptions,
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
	return { options: normalized.launchOptions, geometry: normalized.geometry };
}

async function closeSession(session: ProviderSession): Promise<void> {
	if (session.closed) return;
	session.closed = true;
	if (session.idleTimer) clearTimeout(session.idleTimer);
	sessions.delete(session.provider);
	await session.rawContext.close().catch(() => null);
	logger.log(`[${session.provider}] persistent browser session closed`);
}

async function launchSession(provider: Provider): Promise<ProviderSession> {
	const seedPlan = await getRuntimeProfileSeedPlan(provider);
	if (seedPlan.shouldBootstrap) {
		prepareRuntimeProfileBootstrap(provider);
	}
	const profileDir = seedPlan.userDataDir;
	const { options, geometry } = await getPersistentLaunchOptions({
		provider,
		profileDir,
	});
	await normalizeFirefoxWindowStore(profileDir, geometry);

	try {
		const rawContext = await firefox.launchPersistentContext(profileDir, {
			...(options as Parameters<typeof firefox.launchPersistentContext>[1]),
			headless: false,
			viewport: null,
		});
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
		logger.log(`[${provider}] persistent browser session ready: ${profileDir}`);
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
): Promise<ProviderSession> {
	const existing = sessions.get(provider);
	if (existing && !existing.closed) return existing;

	const inFlight = launches.get(provider);
	if (inFlight) return inFlight;

	const launch = launchSession(provider).finally(() =>
		launches.delete(provider),
	);
	launches.set(provider, launch);
	return launch;
}

export async function acquireProviderSession(
	provider: Provider,
): Promise<ProviderSessionLease> {
	const session = await getOrLaunchSession(provider);
	if (session.idleTimer) {
		clearTimeout(session.idleTimer);
		session.idleTimer = null;
	}
	session.leaseCount += 1;
	const resumePage = session.heldPage;
	session.heldPage = null;
	if (resumePage) session.humanHold = false;
	let released = false;

	return {
		browser: session.browser,
		context: session.context,
		profileDir: getProviderProfileDir(provider),
		resumePage,
		release: async () => {
			if (released) return;
			released = true;
			session.leaseCount = Math.max(0, session.leaseCount - 1);
			if (session.leaseCount > 0 || session.closed) return;
			if (session.humanHold) return;
			session.idleTimer = setTimeout(() => {
				void closeSession(session);
			}, SESSION_IDLE_TIMEOUT_MS);
		},
		invalidate: async () => {
			released = true;
			session.leaseCount = Math.max(0, session.leaseCount - 1);
			await closeSession(session);
		},
		holdForHuman: (page) => {
			session.humanHold = true;
			session.heldPage = page;
			if (session.idleTimer) {
				clearTimeout(session.idleTimer);
				session.idleTimer = null;
			}
		},
		minimizeWindow: () => minimizeNativeWindow(getProviderProfileDir(provider)),
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
	if (!session || session.closed) return false;
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
