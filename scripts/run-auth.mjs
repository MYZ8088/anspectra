import { createHash } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import zlib from "node:zlib";
import {
	attachTerminationHandler,
	buildLocalRuntimeEnv,
	buildLocalWorkspacePackages,
	ensureEnvFiles,
	ensureLocalCamoufoxRuntime,
	openBrowser,
	repoRoot,
	spawnCommand,
	terminateLocalProcesses,
	waitForChildExit,
	waitForHttp,
} from "./lib/runtime.mjs";

const PROVIDERS = [
	"chatgpt",
	"perplexity",
	"gemini",
	"google",
	"claude",
	"deepseek",
	"doubao",
	"hunyuan",
	"qwen",
];
const localAppUrl = "http://localhost:3100";
const localProvidersUrl = `${localAppUrl}/providers/local`;

function getAuthRootDir() {
	const configured = process.env.AGENT_AUTH_ROOT_DIR?.trim();
	if (configured) return path.resolve(configured);
	const storageRoot = path.join(repoRoot, ".answerloom-storage");
	const legacyStorageRoot = path.join(repoRoot, ".oneglanse-storage");
	if (!existsSync(storageRoot) && existsSync(legacyStorageRoot)) {
		try {
			renameSync(legacyStorageRoot, storageRoot);
		} catch {
			return path.join(legacyStorageRoot, "auth");
		}
	}
	return path.join(storageRoot, "auth");
}

function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B";

	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}

	const rounded =
		value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
	return `${rounded} ${units[unitIndex]}`;
}

function getSessionFile(provider) {
	return path.join(
		getAuthRootDir(),
		"sessions",
		provider,
		`${provider}-auth.json`,
	);
}

async function captureSessionSnapshot() {
	const snapshot = new Map();

	for (const provider of PROVIDERS) {
		const sessionFile = getSessionFile(provider);
		if (!existsSync(sessionFile)) {
			continue;
		}

		const rawSession = await readFile(sessionFile);
		snapshot.set(provider, {
			hash: createHash("sha256").update(rawSession).digest("hex"),
			size: rawSession.length,
		});
	}

	return snapshot;
}

function getChangedProviders(beforeSnapshot, afterSnapshot) {
	return PROVIDERS.filter((provider) => {
		const before = beforeSnapshot.get(provider);
		const after = afterSnapshot.get(provider);

		if (!before && !after) {
			return false;
		}

		if (!before || !after) {
			return true;
		}

		return before.hash !== after.hash || before.size !== after.size;
	});
}

async function prompt(question) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return null;
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		return (await rl.question(question)).trim();
	} finally {
		rl.close();
	}
}

async function uploadExistingSessionsIfPresent(
	uploadUrl,
	uploadToken,
	providers = null,
) {
	const uploaded = [];
	const selectedProviders = providers ?? PROVIDERS;
	const sessionFiles = selectedProviders
		.map((provider) => ({
			provider,
			sessionFile: getSessionFile(provider),
		}))
		.filter(({ sessionFile }) => existsSync(sessionFile));

	if (sessionFiles.length === 0) {
		return uploaded;
	}

	console.log(
		`Uploading ${sessionFiles.length} auth session file${sessionFiles.length === 1 ? "" : "s"} to ${uploadUrl}`,
	);

	for (const [index, { provider, sessionFile }] of sessionFiles.entries()) {
		const rawSession = await readFile(sessionFile);
		const prefix = Buffer.from(
			`{"provider":${JSON.stringify(provider)},"session":`,
		);
		const suffix = Buffer.from("}");
		const payload = Buffer.concat([prefix, rawSession, suffix]);
		const body = zlib.gzipSync(payload);

		console.log(
			`[${index + 1}/${sessionFiles.length}] Uploading ${provider}: ${sessionFile} (${formatBytes(rawSession.length)} -> ${formatBytes(body.length)} gzip, overwrites existing remote session)`,
		);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 60_000);
		try {
			const response = await fetch(uploadUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Encoding": "gzip",
					"Content-Length": String(body.length),
					Authorization: `Bearer ${uploadToken}`,
				},
				body,
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(
					`Upload failed for ${provider} (${response.status}): ${await response.text()}`,
				);
			}
			console.log(`[${index + 1}/${sessionFiles.length}] Uploaded ${provider}`);
		} catch (err) {
			if (err.name === "AbortError") {
				throw new Error(`Upload timed out for ${provider} after 60s`);
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}

		uploaded.push(provider);
	}

	console.log(
		`Upload complete. ${uploaded.length} session file${uploaded.length === 1 ? "" : "s"} overwritten on the VPS.`,
	);
	return uploaded;
}

function readArg(flag, fallback) {
	const index = process.argv.indexOf(flag);
	if (index === -1) {
		return fallback;
	}

	return process.argv[index + 1] ?? fallback;
}

function hasFlag(flag) {
	return process.argv.includes(flag);
}

function normalizeBaseUrl(rawUrl) {
	if (!rawUrl) return null;
	const trimmed = String(rawUrl).trim();
	if (!trimmed) return null;
	if (/^https?:\/\//i.test(trimmed)) {
		return trimmed.replace(/\/+$/, "");
	}
	return `http://${trimmed.replace(/\/+$/, "")}`;
}

function resolveUploadUrl() {
	const explicitUrl = readArg(
		"--upload-url",
		process.env.AGENT_AUTH_UPLOAD_URL,
	);
	if (explicitUrl?.trim()) {
		return explicitUrl.trim();
	}

	const vpsIp = process.env.ANSWERLOOM_VPS_IP?.trim();
	if (!vpsIp) {
		return undefined;
	}

	const baseUrl = normalizeBaseUrl(vpsIp);
	return `${baseUrl}:3333/auth/sessions`;
}

async function main() {
	await ensureEnvFiles();

	const uploadOnly = hasFlag("--upload-existing-only");
	const uploadUrl = resolveUploadUrl();
	const uploadToken = readArg(
		"--upload-token",
		process.env.AGENT_AUTH_UPLOAD_TOKEN,
	);

	if (Boolean(uploadUrl) !== Boolean(uploadToken)) {
		throw new Error(
			"--upload-url and --upload-token must be provided together.",
		);
	}

	// Upload-only: just read session files and POST — no Camoufox, no package builds
	if (uploadOnly) {
		if (!uploadUrl || !uploadToken) {
			throw new Error(
				"Upload config missing. Set AGENT_AUTH_UPLOAD_TOKEN and ANSWERLOOM_VPS_IP (or AGENT_AUTH_UPLOAD_URL).",
			);
		}
		const uploadedProviders = await uploadExistingSessionsIfPresent(
			uploadUrl,
			uploadToken,
		);
		if (uploadedProviders.length > 0) {
			console.log(
				`Uploaded existing local auth sessions: ${uploadedProviders.join(", ")}`,
			);
		} else {
			throw new Error(
				"No existing local auth sessions were found to upload. Run `pnpm auth` first to capture them.",
			);
		}
		return;
	}

	await ensureLocalCamoufoxRuntime();
	await buildLocalWorkspacePackages();
	const localEnv = buildLocalRuntimeEnv(localAppUrl);
	await terminateLocalProcesses([repoRoot, "@answerloom/web", "next dev"]);
	const sessionSnapshotBefore = await captureSessionSnapshot();

	const webChild = spawnCommand(
		"pnpm",
		[
			"--filter",
			"@answerloom/web",
			"exec",
			"next",
			"dev",
			"--hostname",
			"localhost",
			"--port",
			"3100",
		],
		{
			env: localEnv,
		},
	);
	const stopWeb = attachTerminationHandler(webChild);

	try {
		await waitForHttp(localProvidersUrl);
		console.log(`Opening ${localProvidersUrl}`);
		openBrowser(localProvidersUrl);
		console.log(
			"Finish provider sign-in in the browser, then return here and press Enter.",
		);
		await prompt("Press Enter when you are done connecting providers. ");

		const sessionSnapshotAfter = await captureSessionSnapshot();
		const changedProviders = getChangedProviders(
			sessionSnapshotBefore,
			sessionSnapshotAfter,
		);

		if (changedProviders.length === 0) {
			console.log("No new or updated provider sessions were detected.");
			if (uploadUrl && uploadToken) {
				console.log(
					"Skipping upload because no local provider sessions changed during this run.",
				);
			}
			return;
		}

		console.log(
			`Saved or updated provider sessions: ${changedProviders.join(", ")}`,
		);

		if (!uploadUrl || !uploadToken) {
			console.log(
				"Upload is not configured. Run `pnpm upload:vps` later after setting AGENT_AUTH_UPLOAD_TOKEN and ANSWERLOOM_VPS_IP (or AGENT_AUTH_UPLOAD_URL).",
			);
			return;
		}

		const uploadAnswer = (
			await prompt("Upload these sessions to the VPS now? [y/N] ")
		)?.toLowerCase();

		if (uploadAnswer === "y" || uploadAnswer === "yes") {
			await uploadExistingSessionsIfPresent(
				uploadUrl,
				uploadToken,
				changedProviders,
			);
			return;
		}

		console.log("Skipped upload. Local sessions remain saved on this machine.");
	} catch (error) {
		stopWeb();
		throw error;
	} finally {
		stopWeb();
		try {
			await waitForChildExit(webChild, "Web dev");
		} catch {}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
