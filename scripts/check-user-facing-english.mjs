import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const roots = ["apps/web/src", "apps/landing/src", "README.md"];
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md"]);
const han = /[\u3400-\u9fff]/u;

async function filesAt(path) {
	const absolute = resolve(root, path);
	const info = await stat(absolute);
	if (info.isFile()) return [absolute];
	const entries = await readdir(absolute, { withFileTypes: true });
	const nested = await Promise.all(
		entries
			.filter((entry) => !["node_modules", ".next", "dist"].includes(entry.name))
			.map((entry) => filesAt(resolve(absolute, entry.name))),
	);
	return nested.flat();
}

const files = (await Promise.all(roots.map(filesAt)))
	.flat()
	.filter((file) => extensions.has(extname(file)));
const failures = [];
for (const file of files) {
	const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
	for (const [index, line] of lines.entries()) {
		if (han.test(line)) {
			failures.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`);
		}
	}
}

if (failures.length) {
	console.error("User-facing product text must be English. Preset prompts and provider automation live outside this scan.");
	console.error(failures.join("\n"));
	process.exit(1);
}

console.log(`English UI check passed (${files.length} files).`);
