import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const runtimeDir = path.join(repoRoot, ".aloom-storage", "runtime");
const logDir = path.join(repoRoot, ".aloom-storage", "logs");
const stateFile = path.join(runtimeDir, "local-daemon.json");
const logFile = path.join(logDir, "local-daemon.log");
const runLocalScript = path.join(scriptDir, "run-local.mjs");
const appUrl = "http://localhost:3000";

function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function readState() {
	try {
		const parsed = JSON.parse(await readFile(stateFile, "utf8"));
		return typeof parsed?.pid === "number" ? parsed : null;
	} catch {
		return null;
	}
}

async function clearStaleState() {
	const state = await readState();
	if (state && isProcessAlive(state.pid)) return state;
	if (existsSync(stateFile)) await rm(stateFile, { force: true });
	return null;
}

async function waitForExit(pid, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isProcessAlive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	return !isProcessAlive(pid);
}

function signalProcessTree(pid, signal) {
	if (process.platform === "win32") {
		const args = ["/pid", String(pid), "/t"];
		if (signal === "SIGKILL") args.push("/f");
		const child = spawn("taskkill", args, {
			cwd: repoRoot,
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return;
	}

	try {
		process.kill(-pid, signal);
	} catch {
		try {
			process.kill(pid, signal);
		} catch {}
	}
}

async function start() {
	const existing = await clearStaleState();
	if (existing) {
		console.log(`Aloom is already running (PID ${existing.pid}).`);
		console.log(`Open ${appUrl}`);
		return;
	}

	await Promise.all([
		mkdir(runtimeDir, { recursive: true }),
		mkdir(logDir, { recursive: true }),
	]);
	const logFd = openSync(logFile, "a");
	const child = spawn(process.execPath, [runLocalScript], {
		cwd: repoRoot,
		detached: true,
		stdio: ["ignore", logFd, logFd],
		env: {
			...process.env,
			ALOOM_OPEN_BROWSER: "0",
		},
	});
	closeSync(logFd);
	if (!child.pid)
		throw new Error("Failed to start the Aloom background process.");

	await writeFile(
		stateFile,
		`${JSON.stringify(
			{
				pid: child.pid,
				startedAt: new Date().toISOString(),
				logFile,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	child.unref();

	await new Promise((resolve) => setTimeout(resolve, 750));
	if (!isProcessAlive(child.pid)) {
		await rm(stateFile, { force: true });
		throw new Error(`Aloom exited during startup. Check ${logFile}.`);
	}

	console.log(`Aloom is starting in the background (PID ${child.pid}).`);
	console.log(`Open ${appUrl}`);
	console.log(`Logs: ${logFile}`);
}

async function status() {
	const state = await clearStaleState();
	if (!state) {
		console.log("Aloom is not running.");
		process.exitCode = 1;
		return;
	}

	let webReady = false;
	try {
		const response = await fetch(appUrl, { cache: "no-store" });
		webReady = response.ok;
	} catch {}
	console.log(`Aloom is running (PID ${state.pid}).`);
	console.log(`Web: ${webReady ? "ready" : "starting"} at ${appUrl}`);
	console.log(`Logs: ${state.logFile ?? logFile}`);
}

async function stop() {
	const state = await clearStaleState();
	if (!state) {
		console.log("Aloom is not running.");
		return;
	}

	console.log(`Stopping Aloom (PID ${state.pid})...`);
	signalProcessTree(state.pid, "SIGTERM");
	if (!(await waitForExit(state.pid, 30_000))) {
		signalProcessTree(state.pid, "SIGKILL");
		await waitForExit(state.pid, 5_000);
	}
	await rm(stateFile, { force: true });
	console.log("Aloom stopped.");
}

const command = process.argv[2] ?? "status";
const commands = { start, status, stop };
const handler = commands[command];
if (!handler) {
	console.error("Usage: node scripts/local-daemon.mjs <start|status|stop>");
	process.exit(1);
}

handler().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
