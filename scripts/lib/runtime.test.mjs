import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	acquireDirectoryLock,
	validateCamoufoxRuntimeSnapshot,
} from "./runtime.mjs";

const temporaryDirectories = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

function healthySnapshot(overrides = {}) {
	const desired = {
		pipSpec: "cloverlabs-camoufox[geoip]==0.5.5",
		browserChannel: "official/stable/135.0.1-beta.24",
	};
	return {
		pythonExists: true,
		probe: { executablePath: "/tmp/camoufox", packageVersion: "0.5.5" },
		probeError: null,
		browserExecutableExists: true,
		activeChannel: desired.browserChannel,
		activeChannelError: null,
		versionOutput: "Installed Yes",
		versionProbeError: null,
		entrypointShebang: "#!/workspace/.aloom-storage/camoufox-venv/bin/python",
		runtimeRoot: "/workspace/.aloom-storage/camoufox-venv",
		manifest: {
			pipSpec: desired.pipSpec,
			browserChannel: desired.browserChannel,
			platform: process.platform,
			arch: process.arch,
		},
		desired,
		platform: process.platform,
		arch: process.arch,
		...overrides,
	};
}

describe("Camoufox runtime provisioner", () => {
	it("accepts an idempotent healthy runtime", () => {
		expect(validateCamoufoxRuntimeSnapshot(healthySnapshot())).toEqual([]);
	});

	it("rebuilds a first install or an environment missing pip imports", () => {
		expect(
			validateCamoufoxRuntimeSnapshot(
				healthySnapshot({ pythonExists: false, manifest: null }),
			),
		).toEqual([
			"managed Python is missing",
			"runtime manifest is missing",
		]);
		expect(
			validateCamoufoxRuntimeSnapshot(
				healthySnapshot({ probe: null, probeError: "No module named pip" }),
			),
		).toContain("runtime import probe failed: No module named pip");
	});

	it("detects moved shebangs and runtime version upgrades", () => {
		const snapshot = healthySnapshot({
			entrypointShebang: "#!/old/.oneglanse-storage/camoufox-venv/bin/python",
			manifest: {
				...healthySnapshot().manifest,
				pipSpec: "cloverlabs-camoufox[geoip]==0.5.4",
			},
		});
		const failures = validateCamoufoxRuntimeSnapshot(snapshot);
		expect(failures).toContain(
			"Camoufox entrypoint points to a moved virtual environment",
		);
		expect(failures).toContain("pip specification changed");
	});

	it("serializes concurrent provisioners and recovers stale locks", async () => {
		const directory = await mkdtemp(path.join(tmpdir(), "aloom-lock-"));
		temporaryDirectories.push(directory);
		const lockPath = path.join(directory, "runtime.lock");
		const releaseFirst = await acquireDirectoryLock({
			lockPath,
			timeoutMs: 1_000,
			staleMs: 1_000,
			pollMs: 10,
		});
		let acquiredSecond = false;
		const second = acquireDirectoryLock({
			lockPath,
			timeoutMs: 1_000,
			staleMs: 1_000,
			pollMs: 10,
		}).then((release) => {
			acquiredSecond = true;
			return release;
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(acquiredSecond).toBe(false);
		await releaseFirst();
		const releaseSecond = await second;
		expect(acquiredSecond).toBe(true);
		await releaseSecond();

		await mkdir(lockPath);
		const staleDate = new Date(Date.now() - 5_000);
		await utimes(lockPath, staleDate, staleDate);
		const releaseStale = await acquireDirectoryLock({
			lockPath,
			timeoutMs: 1_000,
			staleMs: 100,
			pollMs: 10,
		});
		await releaseStale();
	});
});
