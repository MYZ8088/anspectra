import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	repoRoot,
	runCommand,
	runCommandCapture,
} from "./lib/runtime.mjs";

const volumeMigrations = [
	[["answerloom-db-data", "oneglanse-app_db_data"], "aloom-db-data"],
	[
		["answerloom-clickhouse-data", "oneglanse-app_clickhouse_data"],
		"aloom-clickhouse-data",
	],
	[["answerloom-redis-data", "oneglanse-app_redis_data"], "aloom-redis-data"],
];

const localStorageTarget = path.join(repoRoot, ".aloom-storage");
const localStorageSources = [
	path.join(repoRoot, ".answerloom-storage"),
	path.join(repoRoot, ".oneglanse-storage"),
];
const textExtensions = new Set([".json", ".txt", ".md", ".mjs", ".ts"]);

async function rewriteLegacyStoragePaths(directory, replacements) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await rewriteLegacyStoragePaths(entryPath, replacements);
			continue;
		}
		if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;
		const fileStat = await stat(entryPath);
		if (fileStat.size > 5 * 1024 * 1024) continue;
		let contents = await readFile(entryPath, "utf8");
		let changed = false;
		for (const [source, target] of replacements) {
			if (!contents.includes(source)) continue;
			contents = contents.replaceAll(source, target);
			changed = true;
		}
		if (changed) await writeFile(entryPath, contents, "utf8");
	}
}

async function migrateLocalStorage() {
	if (existsSync(localStorageTarget)) {
		return { status: "already_present", target: localStorageTarget };
	}
	const source = localStorageSources.find((candidate) => existsSync(candidate));
	if (!source) return { status: "legacy_missing", target: localStorageTarget };
	await cp(source, localStorageTarget, { recursive: true, preserveTimestamps: true });
	await rewriteLegacyStoragePaths(localStorageTarget, [
		[source, localStorageTarget],
		[".answerloom-storage", ".aloom-storage"],
		[".oneglanse-storage", ".aloom-storage"],
	]);
	return { status: "copied", source, target: localStorageTarget };
}

async function exists(kind, name) {
	try {
		await runCommandCapture("docker", [kind, "inspect", name]);
		return true;
	} catch {
		return false;
	}
}

async function stopLegacyContainer(name) {
	if (!(await exists("container", name))) return;
	await runCommandCapture("docker", ["stop", name]).catch(() => null);
}

async function volumeSize(name) {
	const { stdout } = await runCommandCapture("docker", [
		"run",
		"--rm",
		"--entrypoint",
		"sh",
		"-v",
		`${name}:/volume:ro`,
		"redis:7-alpine",
		"-c",
		"du -sk /volume | cut -f1",
	]);
	return Number(stdout.trim()) || 0;
}

async function volumeHasEntries(name) {
	const { stdout } = await runCommandCapture("docker", [
		"run",
		"--rm",
		"--entrypoint",
		"sh",
		"-v",
		`${name}:/volume:ro`,
		"redis:7-alpine",
		"-c",
		"find /volume -mindepth 1 -print -quit",
	]);
	return stdout.trim().length > 0;
}

await Promise.all(
	[
		"aloom-web",
		"aloom-postgres",
		"aloom-clickhouse",
		"aloom-redis",
		"aloom-migrate",
		"aloom-collector",
		"answerloom-web",
		"answerloom-postgres",
		"answerloom-clickhouse",
		"answerloom-redis",
		"postgres_db",
		"clickhouse_db",
		"redis",
	].map(stopLegacyContainer),
);

const report = [];
for (const [legacyNames, aloomName] of volumeMigrations) {
	const legacyName = await (async () => {
		for (const candidate of legacyNames) {
			if (await exists("volume", candidate)) return candidate;
		}
		return null;
	})();
	if (!legacyName) {
		report.push({ legacyNames, aloomName, status: "legacy_missing" });
		continue;
	}
	if (!(await exists("volume", aloomName))) {
		await runCommand("docker", ["volume", "create", aloomName]);
	}
	const sourceSizeKb = await volumeSize(legacyName);
	const existingTargetSizeKb = await volumeSize(aloomName);
	const targetHadEntries = await volumeHasEntries(aloomName);
	const targetLooksIncomplete =
		targetHadEntries &&
		sourceSizeKb > 0 &&
		existingTargetSizeKb < Math.floor(sourceSizeKb * 0.8);
	let backupVolume = null;
	if (targetLooksIncomplete) {
		backupVolume = `${aloomName}-pre-migration-backup`;
		if (!(await exists("volume", backupVolume))) {
			await runCommand("docker", ["volume", "create", backupVolume]);
			await runCommand("docker", [
				"run",
				"--rm",
				"--entrypoint",
				"sh",
				"-v",
				`${aloomName}:/source:ro`,
				"-v",
				`${backupVolume}:/backup`,
				"redis:7-alpine",
				"-c",
				"cp -a /source/. /backup/",
			]);
		}
		await runCommand("docker", [
			"run",
			"--rm",
			"--entrypoint",
			"sh",
			"-v",
			`${aloomName}:/target`,
			"redis:7-alpine",
			"-c",
			"rm -rf /target/* /target/.[!.]* /target/..?*",
		]);
	}
	if ((!targetHadEntries || targetLooksIncomplete) && sourceSizeKb > 0) {
		await runCommand("docker", [
			"run",
			"--rm",
			"--entrypoint",
			"sh",
			"-v",
			`${legacyName}:/source:ro`,
			"-v",
			`${aloomName}:/target`,
			"redis:7-alpine",
			"-c",
			"cp -a /source/. /target/",
		]);
	}
	const targetSizeKb = await volumeSize(aloomName);
	if (sourceSizeKb > 0 && targetSizeKb < Math.floor(sourceSizeKb * 0.8)) {
		throw new Error(`Volume migration failed for ${legacyName}`);
	}
	report.push({
		legacyName,
		aloomName,
		status: targetLooksIncomplete
			? "replaced_incomplete_target"
			: targetHadEntries
				? "already_present"
				: "copied",
		backupVolume,
		sourceSizeKb,
		targetSizeKb,
	});
}

const localStorageMigration = await migrateLocalStorage();
const reportDir = path.join(
	repoRoot,
	".aloom-storage",
	"migrations",
);
await mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, "docker-brand-v1.json");
await writeFile(
	reportPath,
	JSON.stringify(
		{
			migratedAt: new Date().toISOString(),
			localStorage: localStorageMigration,
			volumes: report,
		},
		null,
		2,
	),
	"utf8",
);
console.log(JSON.stringify({ ok: true, reportPath, volumes: report }, null, 2));
