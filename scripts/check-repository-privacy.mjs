import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const listed = execFileSync(
	"git",
	["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
	{ cwd: root },
)
	.toString("utf8")
	.split("\0")
	.filter(Boolean);

const forbiddenPaths = [
	/(^|\/)\.(?:aloom|answerloom|oneglanse|prismetra)-storage(?:\/|$)/i,
	/(^|\/)(?:cookies?|profiles?|sessions?|storage-state|storage_state)(?:\/|$)/i,
	/(^|\/)(?:provider-adapter|provider-modes)(?:\/|$)/i,
	/(?:^|\/)(?:raw|runs|results)\/(?:doubao|deepseek|hunyuan|qwen)(?:\/|$)/i,
	/(?:^|\/)[^/]*(?:auth|storage[-_]?state)[^/]*\.json$/i,
	/\.(?:har|trace\.zip)$/i,
];

const textualExtensions = new Set([
	".cjs",
	".css",
	".env",
	".html",
	".js",
	".json",
	".jsx",
	".md",
	".mdx",
	".mjs",
	".sql",
	".svg",
	".toml",
	".ts",
	".tsx",
	".txt",
	".yaml",
	".yml",
]);

const secretPatterns = [
	{ label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u },
	{ label: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u },
	{ label: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/u },
	{ label: "OpenAI-style key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
	{ label: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/u },
];

const failures = [];
for (const file of listed) {
	if (file === ".env.example") continue;
	if (/^\.env(?:\.|$)/u.test(file)) {
		failures.push(`${file}: environment file must not be committed`);
		continue;
	}
	if (forbiddenPaths.some((pattern) => pattern.test(file))) {
		failures.push(`${file}: local browser or detection data path is forbidden`);
		continue;
	}
	if (!textualExtensions.has(extname(file).toLocaleLowerCase())) continue;
	const absolute = resolve(root, file);
	let content = "";
	try {
		content = await readFile(absolute, "utf8");
	} catch {
		continue;
	}
	for (const { label, pattern } of secretPatterns) {
		if (pattern.test(content)) failures.push(`${file}: possible ${label}`);
	}
}

if (failures.length > 0) {
	console.error("Repository privacy check failed:");
	console.error([...new Set(failures)].join("\n"));
	process.exit(1);
}

console.log(`Repository privacy check passed (${listed.length} candidate files).`);
