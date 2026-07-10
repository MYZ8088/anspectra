import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	repoRoot,
	runCommand,
	runCommandCapture,
} from "./lib/runtime.mjs";

const volumeMigrations = [
	["oneglanse-app_db_data", "answerloom-db-data"],
	["oneglanse-app_clickhouse_data", "answerloom-clickhouse-data"],
	["oneglanse-app_redis_data", "answerloom-redis-data"],
];

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
	["postgres_db", "clickhouse_db", "redis"].map(stopLegacyContainer),
);

const report = [];
for (const [legacyName, answerloomName] of volumeMigrations) {
	if (!(await exists("volume", legacyName))) {
		report.push({ legacyName, answerloomName, status: "legacy_missing" });
		continue;
	}
	if (!(await exists("volume", answerloomName))) {
		await runCommand("docker", ["volume", "create", answerloomName]);
	}
	const sourceSizeKb = await volumeSize(legacyName);
	const existingTargetSizeKb = await volumeSize(answerloomName);
	const targetHadEntries = await volumeHasEntries(answerloomName);
	if (!targetHadEntries && sourceSizeKb > 0) {
		await runCommand("docker", [
			"run",
			"--rm",
			"--entrypoint",
			"sh",
			"-v",
			`${legacyName}:/source:ro`,
			"-v",
			`${answerloomName}:/target`,
			"redis:7-alpine",
			"-c",
			"cp -a /source/. /target/",
		]);
	}
	const targetSizeKb = await volumeSize(answerloomName);
	if (
		sourceSizeKb > 32 &&
		targetSizeKb < Math.floor(sourceSizeKb * 0.8)
	) {
		throw new Error(`Volume migration failed for ${legacyName}`);
	}
	report.push({
		legacyName,
		answerloomName,
		status: targetHadEntries ? "already_present" : "copied",
		sourceSizeKb,
		targetSizeKb,
	});
}

const reportDir = path.join(
	repoRoot,
	".answerloom-storage",
	"migrations",
);
await mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, "docker-brand-v1.json");
await writeFile(
	reportPath,
	JSON.stringify({ migratedAt: new Date().toISOString(), volumes: report }, null, 2),
	"utf8",
);
console.log(JSON.stringify({ ok: true, reportPath, volumes: report }, null, 2));
