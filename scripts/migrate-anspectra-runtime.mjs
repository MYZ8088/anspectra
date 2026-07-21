import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	ensureEnvFiles,
	repoRoot,
	runCommand,
	runCommandCapture,
} from "./lib/runtime.mjs";

const volumeMigrations = [
	[
		["aloom-db-data", "answerloom-db-data", "oneglanse-app_db_data"],
		"anspectra-db-data",
	],
	[
		[
			"aloom-clickhouse-data",
			"answerloom-clickhouse-data",
			"oneglanse-app_clickhouse_data",
		],
		"anspectra-clickhouse-data",
	],
];

const localStorageTarget = path.join(repoRoot, ".anspectra-storage");
const localStorageSources = [
	path.join(repoRoot, ".aloom-storage"),
	path.join(repoRoot, ".answerloom-storage"),
	path.join(repoRoot, ".oneglanse-storage"),
];
const textExtensions = new Set([".json", ".txt", ".md", ".mjs", ".ts"]);

async function migrateRootEnv() {
	const envPath = path.join(repoRoot, ".env");
	if (!existsSync(envPath)) return { status: "missing" };
	const raw = await readFile(envPath, "utf8");
	const migrated = raw
		.replace(/^ALOOM_/gm, "ANSPECTRA_")
		.replace(
			/^ANSPECTRA_STORAGE_ROOT=\/opt\/(?:aloom|answerloom|oneglanse)\/storage$/m,
			"ANSPECTRA_STORAGE_ROOT=/opt/anspectra/storage",
		)
		.replace(/^POSTGRES_DB=aloom$/m, "POSTGRES_DB=anspectra");
	if (migrated === raw) return { status: "already_current" };
	const backupDir = path.join(repoRoot, ".anspectra-storage", "migrations");
	await mkdir(backupDir, { recursive: true });
	const backupPath = path.join(backupDir, "pre-anspectra.env");
	if (!existsSync(backupPath)) await writeFile(backupPath, raw, { mode: 0o600 });
	await writeFile(envPath, migrated, { mode: 0o600 });
	return { status: "migrated", backupPath };
}

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
	const source = localStorageSources.find((candidate) => existsSync(candidate));
	if (!source) return { status: "legacy_missing", target: localStorageTarget };
	const targetAlreadyExisted = existsSync(localStorageTarget);
	await mkdir(localStorageTarget, { recursive: true });
	for (const entry of await readdir(source, { withFileTypes: true })) {
		await cp(
			path.join(source, entry.name),
			path.join(localStorageTarget, entry.name),
			{
				recursive: true,
				preserveTimestamps: true,
				force: false,
				errorOnExist: false,
			},
		);
	}
	await rewriteLegacyStoragePaths(localStorageTarget, [
		[source, localStorageTarget],
		[".aloom-storage", ".anspectra-storage"],
		[".answerloom-storage", ".anspectra-storage"],
		[".oneglanse-storage", ".anspectra-storage"],
	]);
	return {
		status: targetAlreadyExisted ? "merged" : "copied",
		source,
		target: localStorageTarget,
	};
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

async function ensureCleanRedisVolume() {
	const name = "anspectra-redis-data";
	if (!(await exists("volume", name))) {
		await runCommand("docker", ["volume", "create", name]);
		return { name, status: "created_clean" };
	}
	const hasEntries = await volumeHasEntries(name);
	return {
		name,
		status: hasEntries ? "preserved_existing" : "already_clean",
	};
}

async function renamePostgresDatabase() {
	const volumeName = "anspectra-db-data";
	if (!(await exists("volume", volumeName))) {
		return { status: "volume_missing" };
	}
	const containerName = "anspectra-postgres-brand-migration";
	await stopLegacyContainer(containerName);
	await runCommandCapture("docker", ["rm", containerName]).catch(() => null);
	await runCommand("docker", [
		"run",
		"--detach",
		"--name",
		containerName,
		"-e",
		`POSTGRES_PASSWORD=${process.env.POSTGRES_PASSWORD || "postgres"}`,
		"-v",
		`${volumeName}:/var/lib/postgresql/data`,
		"postgres:16-alpine",
	]);
	try {
		for (let attempt = 0; attempt < 30; attempt += 1) {
			const ready = await runCommandCapture("docker", [
				"exec",
				containerName,
				"pg_isready",
				"-U",
				process.env.POSTGRES_USER || "postgres",
			]).then(
				() => true,
				() => false,
			);
			if (ready) break;
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
		const user = process.env.POSTGRES_USER || "postgres";
		const { stdout } = await runCommandCapture("docker", [
			"exec",
			containerName,
			"psql",
			"-U",
			user,
			"-d",
			"postgres",
			"-Atc",
			"SELECT datname FROM pg_database WHERE datname IN ('aloom', 'anspectra') ORDER BY datname;",
		]);
		const databases = stdout.trim().split("\n").filter(Boolean);
		if (databases.includes("anspectra")) {
			return { status: "already_renamed" };
		}
		if (!databases.includes("aloom")) {
			return { status: "legacy_database_missing" };
		}
		await runCommand("docker", [
			"exec",
			containerName,
			"psql",
			"-U",
			user,
			"-d",
			"postgres",
			"-v",
			"ON_ERROR_STOP=1",
			"-c",
			"ALTER DATABASE aloom RENAME TO anspectra;",
		]);
		return { status: "renamed" };
	} finally {
		await runCommandCapture("docker", ["stop", containerName]).catch(() => null);
		await runCommandCapture("docker", ["rm", containerName]).catch(() => null);
	}
}

const envMigration = await migrateRootEnv();
await ensureEnvFiles();

await Promise.all(
	[
		"aloom-web",
		"aloom-postgres",
		"aloom-clickhouse",
		"aloom-redis",
		"aloom-migrate",
		"aloom-collector",
		"anspectra-web",
		"anspectra-postgres",
		"anspectra-clickhouse",
		"anspectra-redis",
		"anspectra-migrate",
		"anspectra-collector",
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
for (const [legacyNames, anspectraName] of volumeMigrations) {
	const legacyName = await (async () => {
		for (const candidate of legacyNames) {
			if (await exists("volume", candidate)) return candidate;
		}
		return null;
	})();
	if (!legacyName) {
		report.push({ legacyNames, anspectraName, status: "legacy_missing" });
		continue;
	}
	if (!(await exists("volume", anspectraName))) {
		await runCommand("docker", ["volume", "create", anspectraName]);
	}
	const sourceSizeKb = await volumeSize(legacyName);
	const existingTargetSizeKb = await volumeSize(anspectraName);
	const targetHadEntries = await volumeHasEntries(anspectraName);
	const targetLooksIncomplete =
		targetHadEntries &&
		sourceSizeKb > 0 &&
		existingTargetSizeKb < Math.floor(sourceSizeKb * 0.8);
	let backupVolume = null;
	if (targetLooksIncomplete) {
		backupVolume = `${anspectraName}-pre-migration-backup`;
		if (!(await exists("volume", backupVolume))) {
			await runCommand("docker", ["volume", "create", backupVolume]);
			await runCommand("docker", [
				"run",
				"--rm",
				"--entrypoint",
				"sh",
				"-v",
				`${anspectraName}:/source:ro`,
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
			`${anspectraName}:/target`,
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
			`${anspectraName}:/target`,
			"redis:7-alpine",
			"-c",
			"cp -a /source/. /target/",
		]);
	}
	const targetSizeKb = await volumeSize(anspectraName);
	if (sourceSizeKb > 0 && targetSizeKb < Math.floor(sourceSizeKb * 0.8)) {
		throw new Error(`Volume migration failed for ${legacyName}`);
	}
	report.push({
		legacyName,
		anspectraName,
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
const postgresDatabaseMigration = await renamePostgresDatabase();
const redisVolume = await ensureCleanRedisVolume();
const reportDir = path.join(
	repoRoot,
	".anspectra-storage",
	"migrations",
);
await mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, "docker-brand-v1.json");
await writeFile(
	reportPath,
	JSON.stringify(
		{
			migratedAt: new Date().toISOString(),
			env: envMigration,
			localStorage: localStorageMigration,
			postgresDatabase: postgresDatabaseMigration,
			redisVolume,
			volumes: report,
			env: envMigration,
		},
		null,
		2,
	),
	"utf8",
);
console.log(
	JSON.stringify(
		{
			ok: true,
			reportPath,
			volumes: report,
			postgresDatabase: postgresDatabaseMigration,
			redisVolume,
		},
		null,
		2,
	),
);
