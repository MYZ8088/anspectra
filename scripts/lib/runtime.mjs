import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
	copyFile,
	mkdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "..", "..");
export const edgeNetworkName = "aloom-edge";

const rootEnvFile = path.join(repoRoot, ".env");
const rootEnvExampleFile = path.join(repoRoot, ".env.example");
const CAMOUFOX_PYTHON_CANDIDATES = [
	"python3.12",
	"python3.11",
	"python3.10",
	"python3",
];
// Keep local auth/runtime bootstrap reproducible instead of following the
// floating latest browser channel on every fresh machine.
const CAMOUFOX_DEFAULT_PIP_SPEC = "cloverlabs-camoufox[geoip]==0.5.5";
const CAMOUFOX_DEFAULT_BROWSER_CHANNEL = "official/stable/135.0.1-beta.24";
const CAMOUFOX_RUNTIME_ROOT = path.join(
	repoRoot,
	".aloom-storage",
	"camoufox-venv",
);
const CAMOUFOX_RUNTIME_MANIFEST = path.join(
	CAMOUFOX_RUNTIME_ROOT,
	"aloom-runtime.json",
);
const CAMOUFOX_RUNTIME_LOCK = path.join(
	repoRoot,
	".aloom-storage",
	"locks",
	"camoufox-runtime.lock",
);
const CAMOUFOX_RUNTIME_LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const CAMOUFOX_FETCH_SCRIPT = [
	"import camoufox.__main__ as camoufox_main",
	"camoufox_main.click.confirm = lambda *args, **kwargs: True",
	"camoufox_main.cli.main(args=['fetch'], prog_name='camoufox', standalone_mode=False)",
].join("; ");

let cachedLocalCamoufoxPython = null;

function managedCamoufoxPythonPath() {
	return path.join(
		CAMOUFOX_RUNTIME_ROOT,
		process.platform === "win32" ? "Scripts" : "bin",
		process.platform === "win32" ? "python.exe" : "python",
	);
}

function managedCamoufoxEntrypointPath() {
	return path.join(
		CAMOUFOX_RUNTIME_ROOT,
		process.platform === "win32" ? "Scripts" : "bin",
		process.platform === "win32" ? "camoufox.exe" : "camoufox",
	);
}

function buildRootEnvTemplate(rawTemplate) {
	return rawTemplate
		.replace(
			/^BETTER_AUTH_SECRET=.*$/m,
			`BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}`,
		)
		.replace(
			/^INTERNAL_CRON_SECRET=.*$/m,
			`INTERNAL_CRON_SECRET=${randomUUID()}`,
		);
}

function ensureGeneratedSecrets(rawEnv) {
	const replacements = [
		{
			key: "BETTER_AUTH_SECRET",
			shouldReplace: (value) =>
				value === "" || value === "replace-me" || value === "changeme",
			buildValue: () => randomBytes(32).toString("hex"),
		},
		{
			key: "INTERNAL_CRON_SECRET",
			shouldReplace: (value) =>
				value === "" || value === "replace-me" || value === "changeme",
			buildValue: () => randomUUID(),
		},
	];

	let nextEnv = rawEnv;
	let changed = false;

	for (const replacement of replacements) {
		const pattern = new RegExp(`^${replacement.key}=(.*)$`, "m");
		const match = nextEnv.match(pattern);
		if (!match) {
			nextEnv = `${nextEnv.trimEnd()}\n${replacement.key}=${replacement.buildValue()}\n`;
			changed = true;
			continue;
		}

		const currentValue = stripWrappingQuotes((match[1] ?? "").trim());
		if (replacement.shouldReplace(currentValue)) {
			nextEnv = nextEnv.replace(
				pattern,
				`${replacement.key}=${replacement.buildValue()}`,
			);
			changed = true;
		}
	}

	return { changed, value: nextEnv };
}

async function ensureFile(targetFile, sourceFile, options = {}) {
	if (existsSync(targetFile)) {
		return;
	}

	await mkdir(path.dirname(targetFile), { recursive: true });

	if (options.transform) {
		const source = readFileSync(sourceFile, "utf8");
		await writeFile(targetFile, options.transform(source), "utf8");
	} else {
		await copyFile(sourceFile, targetFile);
	}

	console.log(
		`Created ${path.relative(repoRoot, targetFile)} from ${path.relative(repoRoot, sourceFile)}.`,
	);
}

function stripWrappingQuotes(value) {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}

	return value;
}

function loadEnvFile(filePath, options = {}) {
	if (!existsSync(filePath)) {
		return;
	}

	const raw = readFileSync(filePath, "utf8");
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) {
			continue;
		}

		const separatorIndex = trimmed.indexOf("=");
		if (separatorIndex <= 0) {
			continue;
		}

		const key = trimmed.slice(0, separatorIndex).trim();
		if (!key) {
			continue;
		}

		const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());
		if (!options.override && process.env[key] !== undefined) {
			continue;
		}
		process.env[key] = value;
	}
}

export async function ensureEnvFiles() {
	await ensureFile(rootEnvFile, rootEnvExampleFile, {
		transform: buildRootEnvTemplate,
	});

	if (existsSync(rootEnvFile)) {
		const currentEnv = readFileSync(rootEnvFile, "utf8");
		const updatedEnv = ensureGeneratedSecrets(currentEnv);
		if (updatedEnv.changed) {
			await writeFile(rootEnvFile, updatedEnv.value, "utf8");
			console.log("Generated missing app secrets in .env.");
		}
	}

	loadEnvFile(rootEnvFile, { override: true });
}

const LOCAL_BUILD_PACKAGES = [
	"@aloom/types",
	"@aloom/errors",
	"@aloom/db",
	"@aloom/utils",
	"@aloom/services",
	"@aloom/ui",
];

export const LOCAL_WATCH_PACKAGES = [...LOCAL_BUILD_PACKAGES];

export function spawnCommand(command, args, options = {}) {
	return spawn(command, args, {
		cwd: repoRoot,
		stdio: "inherit",
		env: process.env,
		...options,
	});
}

export async function terminateLocalProcesses(commandFragments) {
	if (process.platform === "win32") {
		return;
	}

	const { stdout } = await runCommandCapture(
		"ps",
		["ax", "-o", "pid=", "-o", "command="],
		{ stdio: ["ignore", "pipe", "ignore"] },
	).catch(() => ({ stdout: "" }));

	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const match = trimmed.match(/^(\d+)\s+(.*)$/);
		if (!match) continue;

		const pid = Number(match[1]);
		const command = match[2] || "";
		if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
		if (!commandFragments.every((fragment) => command.includes(fragment))) {
			continue;
		}

		try {
			process.kill(pid, "SIGTERM");
		} catch {}
	}
}

function killChildProcessTree(child, signal = "SIGTERM") {
	const pid = child.pid;
	if (!pid || child.killed) {
		return;
	}

	if (process.platform === "win32") {
		const forceFlag = signal === "SIGKILL" ? ["/f"] : [];
		void runCommandCapture(
			"taskkill",
			["/pid", String(pid), "/t", ...forceFlag],
			{
				stdio: ["ignore", "ignore", "ignore"],
			},
		).catch(() => {});
		return;
	}

	try {
		if (child.spawnargs && child.spawnargs.length > 0 && child.spawnfile) {
			process.kill(-pid, signal);
			return;
		}
	} catch {
		// Fall through to direct child kill.
	}

	try {
		child.kill(signal);
	} catch {
		// Process already exited.
	}
}

function encodeSegment(value) {
	return encodeURIComponent(value);
}

export function buildLocalRuntimeEnv(localAppUrl) {
	const postgresUser = process.env.POSTGRES_USER || "postgres";
	const postgresPassword = process.env.POSTGRES_PASSWORD || "postgres";
	const postgresDatabase = process.env.POSTGRES_DB || "aloom";
	const redisPort = process.env.REDIS_PORT || "6379";
	const localLocale =
		process.env.CAMOUFOX_LOCALE ||
		Intl.DateTimeFormat().resolvedOptions().locale ||
		"en-US";
	const localEnv = {
		...process.env,
		ALOOM_APP_MODE: "local",
		APP_URL: localAppUrl,
		API_BASE_URL: localAppUrl,
		BETTER_AUTH_URL: localAppUrl,
		NEXT_PUBLIC_API_URL: localAppUrl,
		DATABASE_URL: `postgresql://${encodeSegment(postgresUser)}:${encodeSegment(postgresPassword)}@localhost:5432/${encodeSegment(postgresDatabase)}`,
		CLICKHOUSE_URL: "http://localhost:8123",
		REDIS_HOST: "localhost",
		REDIS_PORT: redisPort,
		CAMOUFOX_HEADLESS_MODE: process.env.CAMOUFOX_HEADLESS_MODE || "headless",
		CAMOUFOX_LOCALE: localLocale,
	};
	Reflect.deleteProperty(localEnv, "MOZ_HEADLESS");

	return localEnv;
}

export function runCommand(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawnCommand(command, args, options);
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(
				new Error(
					`${command} ${args.join(" ")} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`,
				),
			);
		});
	});
}

export async function buildLocalWorkspacePackages() {
	for (const pkg of LOCAL_BUILD_PACKAGES) {
		await runCommand("pnpm", ["--filter", pkg, "build"]);
	}
}

export function spawnLocalWorkspacePackageWatchers(env) {
	return LOCAL_WATCH_PACKAGES.map((pkg) =>
		spawnCommand(
			"pnpm",
			["--filter", pkg, "exec", "tsc", "--watch", "--preserveWatchOutput"],
			{ env },
		),
	);
}

export async function terminateLocalWorkspacePackageWatchers() {
	for (const pkg of LOCAL_WATCH_PACKAGES) {
		await terminateLocalProcesses([repoRoot, pkg, "tsc", "--watch"]);
	}
}

export function runCommandCapture(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: repoRoot,
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
			...options,
		});
		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}

			reject(
				new Error(
					stderr.trim() ||
						stdout.trim() ||
						`${command} ${args.join(" ")} failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`,
				),
			);
		});
	});
}

async function canRunCommand(command, args = ["--version"]) {
	try {
		await runCommandCapture(command, args, {
			stdio: ["ignore", "ignore", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

async function getPythonVersion(command) {
	try {
		const { stdout } = await runCommandCapture(command, [
			"-c",
			[
				"import json",
				"import sys",
				"import venv",
				"print(json.dumps({'major': sys.version_info.major, 'minor': sys.version_info.minor}))",
			].join("; "),
		]);
		const parsed = JSON.parse(stdout);
		if (
			typeof parsed?.major === "number" &&
			typeof parsed?.minor === "number"
		) {
			return parsed;
		}
	} catch {}

	return null;
}

async function installCompatiblePython() {
	if (process.platform === "darwin" && (await canRunCommand("brew"))) {
		console.log("Installing Python 3.11 for local Camoufox support...");
		await runCommand("brew", ["install", "python@3.11"]);
		return "python3.11";
	}

	if (
		process.platform === "linux" &&
		typeof process.getuid === "function" &&
		process.getuid() === 0 &&
		(await canRunCommand("apt-get", ["--version"]))
	) {
		console.log("Installing Python 3 for local Camoufox support...");
		await runCommand("apt-get", ["update"]);
		await runCommand("apt-get", ["install", "-y", "python3", "python3-pip"]);
		return "python3";
	}

	if (
		process.platform === "win32" &&
		(await canRunCommand("winget", ["--info"]))
	) {
		console.log("Installing Python 3.11 for local Camoufox support...");
		await runCommand("winget", [
			"install",
			"-e",
			"--id",
			"Python.Python.3.11",
			"--silent",
		]);
		return "python";
	}

	throw new Error(
		"Unable to provision Python 3.10+ automatically on this machine. Install Python 3.10+ or set CAMOUFOX_PYTHON_BIN to a compatible interpreter.",
	);
}

async function resolveLocalCamoufoxPython() {
	if (cachedLocalCamoufoxPython) {
		return cachedLocalCamoufoxPython;
	}

	const configured = process.env.CAMOUFOX_PYTHON_BIN?.trim();
	const candidates = [
		...(configured && !path.resolve(configured).startsWith(CAMOUFOX_RUNTIME_ROOT)
			? [configured]
			: []),
		...CAMOUFOX_PYTHON_CANDIDATES,
	];

	for (const candidate of [...new Set(candidates)]) {
		const version = await getPythonVersion(candidate);
		if (
			version &&
			(version.major > 3 || (version.major === 3 && version.minor >= 10))
		) {
			cachedLocalCamoufoxPython = candidate;
			return candidate;
		}
	}

	const installedCandidate = await installCompatiblePython();
	const version = await getPythonVersion(installedCandidate);
	if (
		version &&
		(version.major > 3 || (version.major === 3 && version.minor >= 10))
	) {
		cachedLocalCamoufoxPython = installedCandidate;
		return installedCandidate;
	}

	throw new Error(
		"Python 3.10+ is still unavailable after attempting automatic installation.",
	);
}

const CAMOUFOX_RUNTIME_PROBE = [
	"import json",
	"import os",
	"import sys",
	"from importlib.metadata import PackageNotFoundError, version",
	"import pip",
	"import browserforge",
	"import camoufox",
	"import geoip2",
	"from camoufox.utils import launch_options",
	"package_version = None",
	"for package_name in ('cloverlabs-camoufox', 'camoufox'):",
	"    try:",
	"        package_version = version(package_name)",
	"        break",
	"    except PackageNotFoundError:",
	"        pass",
	"options = launch_options(headless=True)",
	"print(json.dumps({",
	"    'python': sys.executable,",
	"    'pythonVersion': sys.version.split()[0],",
	"    'packageVersion': package_version,",
	"    'geoip': True,",
	"    'executablePath': options.get('executable_path'),",
	"}))",
].join("\n");

function desiredCamoufoxRuntime() {
	return {
		pipSpec:
			process.env.CAMOUFOX_PIP_SPEC?.trim() || CAMOUFOX_DEFAULT_PIP_SPEC,
		browserChannel:
			process.env.CAMOUFOX_BROWSER_CHANNEL?.trim() ||
			CAMOUFOX_DEFAULT_BROWSER_CHANNEL,
	};
}

function parseLastJsonObject(stdout) {
	const jsonLine = [...stdout.trim().split(/\r?\n/)]
		.reverse()
		.find((line) => line.trimStart().startsWith("{"));
	if (!jsonLine) throw new Error("Camoufox runtime probe returned no JSON");
	return JSON.parse(jsonLine);
}

async function readCamoufoxRuntimeManifest() {
	try {
		return JSON.parse(await readFile(CAMOUFOX_RUNTIME_MANIFEST, "utf8"));
	} catch {
		return null;
	}
}

async function readManagedEntrypointShebang() {
	if (process.platform === "win32") return null;
	try {
		return (await readFile(managedCamoufoxEntrypointPath(), "utf8"))
			.split(/\r?\n/, 1)[0]
			?.trim();
	} catch {
		return null;
	}
}

export function validateCamoufoxRuntimeSnapshot(args) {
	const failures = [];
	if (!args.pythonExists) {
		failures.push("managed Python is missing");
	} else {
		if (args.probeError) {
			failures.push(`runtime import probe failed: ${args.probeError}`);
		} else if (!args.probe?.executablePath || !args.browserExecutableExists) {
			failures.push("Camoufox browser executable is missing");
		}
		if (args.activeChannelError) {
			failures.push(`active channel probe failed: ${args.activeChannelError}`);
		} else if (args.activeChannel !== args.desired.browserChannel) {
			failures.push(
				`browser channel mismatch (${args.activeChannel ?? "none"} != ${args.desired.browserChannel})`,
			);
		}
		if (args.versionProbeError) {
			failures.push(`browser version probe failed: ${args.versionProbeError}`);
		} else if (!/\bInstalled\s+Yes\b/i.test(args.versionOutput ?? "")) {
			failures.push("Camoufox browser is not installed");
		}
		if (
			args.entrypointShebang &&
			!args.entrypointShebang.includes(args.runtimeRoot)
		) {
			failures.push("Camoufox entrypoint points to a moved virtual environment");
		}
	}
	if (!args.manifest) {
		failures.push("runtime manifest is missing");
	} else {
		if (args.manifest.pipSpec !== args.desired.pipSpec) {
			failures.push("pip specification changed");
		}
		if (args.manifest.browserChannel !== args.desired.browserChannel) {
			failures.push("manifest browser channel changed");
		}
		if (
			args.manifest.platform !== args.platform ||
			args.manifest.arch !== args.arch
		) {
			failures.push("runtime platform changed");
		}
	}
	return failures;
}

export async function inspectLocalCamoufoxRuntime() {
	const pythonBin = managedCamoufoxPythonPath();
	const desired = desiredCamoufoxRuntime();
	const manifest = await readCamoufoxRuntimeManifest();
	let probe = null;
	let probeError = null;
	let activeChannel = null;
	let activeChannelError = null;
	let versionOutput = null;
	let versionProbeError = null;
	let entrypointShebang = null;
	const pythonExists = existsSync(pythonBin);

	if (pythonExists) {
		try {
			const { stdout } = await runCommandCapture(pythonBin, [
				"-c",
				CAMOUFOX_RUNTIME_PROBE,
			]);
			probe = parseLastJsonObject(stdout);
		} catch (error) {
			probeError = error instanceof Error ? error.message : String(error);
		}

		try {
			const { stdout } = await runCommandCapture(pythonBin, [
				"-m",
				"camoufox",
				"active",
			]);
			activeChannel = stdout.trim() || null;
		} catch (error) {
			activeChannelError =
				error instanceof Error ? error.message : String(error);
		}

		try {
			const { stdout } = await runCommandCapture(pythonBin, [
				"-m",
				"camoufox",
				"version",
			]);
			versionOutput = stdout;
		} catch (error) {
			versionProbeError =
				error instanceof Error ? error.message : String(error);
		}

		entrypointShebang = await readManagedEntrypointShebang();
	}

	const failures = validateCamoufoxRuntimeSnapshot({
		pythonExists,
		probe,
		probeError,
		browserExecutableExists: Boolean(
			probe?.executablePath && existsSync(probe.executablePath),
		),
		activeChannel,
		activeChannelError,
		versionOutput,
		versionProbeError,
		entrypointShebang,
		runtimeRoot: CAMOUFOX_RUNTIME_ROOT,
		manifest,
		desired,
		platform: process.platform,
		arch: process.arch,
	});

	return {
		ok: failures.length === 0,
		pythonBin,
		runtimeRoot: CAMOUFOX_RUNTIME_ROOT,
		desired,
		manifest,
		probe,
		activeChannel,
		versionOutput,
		entrypointShebang,
		failures,
	};
}

export async function acquireDirectoryLock(args) {
	const timeoutMs = args.timeoutMs ?? CAMOUFOX_RUNTIME_LOCK_TIMEOUT_MS;
	const staleMs = args.staleMs ?? timeoutMs;
	const pollMs = args.pollMs ?? 500;
	await mkdir(path.dirname(args.lockPath), { recursive: true });
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			await mkdir(args.lockPath);
			await writeFile(
				path.join(args.lockPath, "owner.json"),
				JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
				"utf8",
			);
			return async () => {
				await rm(args.lockPath, { recursive: true, force: true });
			};
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			try {
				const lockStat = await stat(args.lockPath);
				if (Date.now() - lockStat.mtimeMs > staleMs) {
					await rm(args.lockPath, { recursive: true, force: true });
					continue;
				}
			} catch {}
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
	}

	throw new Error("Timed out waiting for the runtime installation lock.");
}

async function acquireCamoufoxRuntimeLock() {
	return acquireDirectoryLock({
		lockPath: CAMOUFOX_RUNTIME_LOCK,
		timeoutMs: CAMOUFOX_RUNTIME_LOCK_TIMEOUT_MS,
		staleMs: CAMOUFOX_RUNTIME_LOCK_TIMEOUT_MS,
	});
}

async function rebuildManagedCamoufoxRuntime(basePython) {
	const desired = desiredCamoufoxRuntime();
	const pythonBin = managedCamoufoxPythonPath();
	console.log(
		`Rebuilding managed Camoufox runtime at ${path.relative(repoRoot, CAMOUFOX_RUNTIME_ROOT)}...`,
	);
	await rm(CAMOUFOX_RUNTIME_ROOT, { recursive: true, force: true });
	await mkdir(path.dirname(CAMOUFOX_RUNTIME_ROOT), { recursive: true });
	try {
		await runCommand(basePython, ["-m", "venv", CAMOUFOX_RUNTIME_ROOT]);
	} catch (error) {
		await rm(CAMOUFOX_RUNTIME_ROOT, { recursive: true, force: true });
		if (!(await canRunCommand("uv"))) throw error;
		console.log(
			"Standard venv creation could not seed pip; retrying with uv venv --seed.",
		);
		await runCommand("uv", [
			"venv",
			"--python",
			basePython,
			"--seed",
			CAMOUFOX_RUNTIME_ROOT,
		]);
	}
	await runCommand(pythonBin, [
		"-m",
		"pip",
		"install",
		"--upgrade",
		"pip",
		"setuptools",
		"wheel",
	]);
	await runCommand(pythonBin, [
		"-m",
		"pip",
		"install",
		"--upgrade",
		desired.pipSpec,
	]);
	await runCommand(pythonBin, [
		"-m",
		"camoufox",
		"set",
		desired.browserChannel,
	]);
	await runCommand(pythonBin, ["-c", CAMOUFOX_FETCH_SCRIPT]);

	const { stdout } = await runCommandCapture(pythonBin, [
		"-c",
		CAMOUFOX_RUNTIME_PROBE,
	]);
	const probe = parseLastJsonObject(stdout);
	await writeCamoufoxRuntimeManifest(basePython, probe);
}

async function writeCamoufoxRuntimeManifest(basePython, probe) {
	const desired = desiredCamoufoxRuntime();
	await writeFile(
		CAMOUFOX_RUNTIME_MANIFEST,
		JSON.stringify(
			{
				schemaVersion: 1,
				pipSpec: desired.pipSpec,
				browserChannel: desired.browserChannel,
				platform: process.platform,
				arch: process.arch,
				basePython,
				pythonVersion: probe.pythonVersion,
				packageVersion: probe.packageVersion,
				executablePath: probe.executablePath,
				installedAt: new Date().toISOString(),
			},
			null,
			2,
		),
		"utf8",
	);
}

export async function ensureLocalCamoufoxRuntime() {
	const initial = await inspectLocalCamoufoxRuntime();
	if (initial.ok) {
		cachedLocalCamoufoxPython = initial.pythonBin;
		process.env.CAMOUFOX_PYTHON_BIN = initial.pythonBin;
		return initial.pythonBin;
	}

	const releaseLock = await acquireCamoufoxRuntimeLock();
	try {
		const afterLock = await inspectLocalCamoufoxRuntime();
		if (!afterLock.ok) {
			const onlyManifestMissing =
				Boolean(afterLock.probe?.executablePath) &&
				afterLock.activeChannel === afterLock.desired.browserChannel &&
				afterLock.failures.every(
					(failure) => failure === "runtime manifest is missing",
				);
			if (onlyManifestMissing) {
				await writeCamoufoxRuntimeManifest(
					afterLock.probe.python,
					afterLock.probe,
				);
			} else {
				console.log(
					`Camoufox runtime needs repair: ${afterLock.failures.join("; ")}`,
				);
				const basePython = await resolveLocalCamoufoxPython();
				await rebuildManagedCamoufoxRuntime(basePython);
			}
		}
	} finally {
		await releaseLock();
	}

	const finalState = await inspectLocalCamoufoxRuntime();
	if (!finalState.ok) {
		throw new Error(
			`Camoufox runtime repair did not pass diagnostics: ${finalState.failures.join("; ")}`,
		);
	}
	cachedLocalCamoufoxPython = finalState.pythonBin;
	process.env.CAMOUFOX_PYTHON_BIN = finalState.pythonBin;
	return finalState.pythonBin;
}

export async function ensureDockerNetwork(name) {
	try {
		await runCommand("docker", ["network", "inspect", name], {
			stdio: "ignore",
		});
	} catch {
		await runCommand("docker", ["network", "create", name]);
	}
}

export async function waitForHttp(url, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, { cache: "no-store" });
			if (response.ok) {
				return;
			}
		} catch {}

		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	throw new Error(`Timed out waiting for ${url}.`);
}

export function openBrowser(url) {
	const platform = process.platform;
	const command =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args = platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, {
		cwd: repoRoot,
		detached: true,
		stdio: "ignore",
	});
	child.unref();
}

export function attachTerminationHandler(child) {
	let forceKillTimer = null;
	const shutdown = () => {
		killChildProcessTree(child, "SIGTERM");
		if (forceKillTimer) {
			return;
		}
		forceKillTimer = setTimeout(() => {
			killChildProcessTree(child, "SIGKILL");
		}, 5_000);
		forceKillTimer.unref?.();
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	process.on("SIGHUP", shutdown);
	child.once("exit", () => {
		if (forceKillTimer) {
			clearTimeout(forceKillTimer);
			forceKillTimer = null;
		}
	});

	return shutdown;
}

export function waitForChildExit(child, label) {
	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
				resolve();
				return;
			}

			reject(
				new Error(
					`${label} exited with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}.`,
				),
			);
		});
	});
}
