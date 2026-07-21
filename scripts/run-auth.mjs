import { createHash } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
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

const PROVIDERS = ["deepseek", "doubao", "hunyuan", "qwen"];
const localAppUrl = "http://localhost:3100";
const localProvidersUrl = `${localAppUrl}/providers/local`;

function getAuthRootDir() {
	const configured = process.env.AGENT_AUTH_ROOT_DIR?.trim();
	if (configured) return path.resolve(configured);
	const storageRoot = path.join(repoRoot, ".anspectra-storage");
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
		if (!existsSync(sessionFile)) continue;
		const rawSession = await readFile(sessionFile);
		snapshot.set(
			provider,
			createHash("sha256").update(rawSession).digest("hex"),
		);
	}
	return snapshot;
}

async function waitForConfirmation(question) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		await rl.question(question);
	} finally {
		rl.close();
	}
}

async function main() {
	await ensureEnvFiles();
	await ensureLocalCamoufoxRuntime();
	await buildLocalWorkspacePackages();
	const localEnv = buildLocalRuntimeEnv(localAppUrl);
	await terminateLocalProcesses([repoRoot, "@anspectra/web", "next dev"]);
	const before = await captureSessionSnapshot();
	const webChild = spawnCommand(
		"pnpm",
		[
			"--filter",
			"@anspectra/web",
			"exec",
			"next",
			"dev",
			"--hostname",
			"localhost",
			"--port",
			"3100",
		],
		{ env: localEnv },
	);
	const stopWeb = attachTerminationHandler(webChild);

	try {
		await waitForHttp(localProvidersUrl);
		console.log(`Opening ${localProvidersUrl}`);
		openBrowser(localProvidersUrl);
		console.log(
			"Finish provider sign-in in the browser, then return here and press Enter.",
		);
		await waitForConfirmation("Press Enter when provider sign-in is complete. ");
		const after = await captureSessionSnapshot();
		const changed = PROVIDERS.filter(
			(provider) => before.get(provider) !== after.get(provider),
		);
		console.log(
			changed.length > 0
				? `Saved or updated local provider sessions: ${changed.join(", ")}`
				: "No local provider session files changed.",
		);
		console.log(
			"Provider cookies and profiles remain under .anspectra-storage on this machine and are never uploaded.",
		);
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
