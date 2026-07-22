import { readFile, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roots = [
	"apps/web/src",
	"apps/landing/src",
	"apps/agent/src",
	"packages/services/src",
	"packages/errors/src",
	"packages/utils/src",
	"scripts",
	"docs",
	"README.md",
];
const extensions = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".md",
	".mdx",
	".mjs",
	".py",
]);
const han = /[\u3400-\u9fff]/u;
const allowlistedFiles = [
	/^apps\/agent\/src\/auth\/cli\.ts$/u,
	/^apps\/agent\/src\/core\/providers\//u,
	/^apps\/agent\/src\/core\/prompt-runner\/responseCompleteness\.ts$/u,
	/^apps\/agent\/src\/core\/steps\/extractSources\.ts$/u,
	/^apps\/agent\/src\/inspect-provider-modes\.ts$/u,
	/^apps\/agent\/src\/lib\/browser\/domOps\.ts$/u,
	/^apps\/agent\/src\/lib\/input\/response\/provisionalResponse\.ts$/u,
	/^apps\/agent\/src\/run-test\.ts$/u,
	/^apps\/landing\/src\/app\/zh-CN\//u,
	/^apps\/landing\/src\/components\/anspectra-landing\.tsx$/u,
	/^packages\/services\/src\/geo\/presets\//u,
	/^packages\/services\/src\/geo\/(?:promptEngine|promptLibrary|diagnostics|siteAudit)\.ts$/u,
	/^packages\/services\/src\/geo\/(?:content|opportunities|publisher|experimentCohorts)\.ts$/u,
	/^packages\/utils\/src\/agent\/(?:constants|validateResponse)\.ts$/u,
	/^scripts\/download_yaojingang_geo_resources\.py$/u,
	/^scripts\/generate-anspectra-social-assets\.mjs$/u,
];

function isAllowedTechnicalFile(file) {
	const name = relative(root, file);
	return (
		name.includes("/test-fixtures/") ||
		name.endsWith(".test.ts") ||
		allowlistedFiles.some((pattern) => pattern.test(name))
	);
}

function isLocalizedReadmeNavigation(file, line) {
	return (
		relative(root, file) === "README.md" &&
		line.includes('href="./README.zh-CN.md"')
	);
}

async function filesAt(path) {
	const absolute = resolve(root, path);
	const info = await stat(absolute);
	if (info.isFile()) return [absolute];
	const entries = await readdir(absolute, { withFileTypes: true });
	const nested = await Promise.all(
		entries
			.filter(
				(entry) => !["node_modules", ".next", "dist"].includes(entry.name),
			)
			.map((entry) => filesAt(resolve(absolute, entry.name))),
	);
	return nested.flat();
}

const files = (await Promise.all(roots.map(filesAt)))
	.flat()
	.filter(
		(file) => extensions.has(extname(file)) && !isAllowedTechnicalFile(file),
	);
const failures = [];
for (const file of files) {
	const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
	for (const [index, line] of lines.entries()) {
		if (han.test(line) && !isLocalizedReadmeNavigation(file, line)) {
			failures.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`);
		}
	}
}

if (failures.length) {
	console.error(
		"User-facing product text must be English. Localized documentation, preset prompts, and provider automation live outside this scan.",
	);
	console.error(failures.join("\n"));
	process.exit(1);
}

console.log(`English product-language check passed (${files.length} files).`);
