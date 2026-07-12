import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Provider } from "@aloom/types";
import type { Page } from "playwright";

function workspaceRoot(startDir = process.cwd()): string {
	let current = path.resolve(startDir);
	while (true) {
		if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(startDir);
		current = parent;
	}
}

export async function captureProviderDiagnostics(args: {
	page: Page;
	provider: Provider;
	phase: string;
	promptId?: string;
	error?: string;
}) {
	const capturedAt = new Date();
	const key = capturedAt.toISOString().replace(/[:.]/g, "-");
	const directory = path.join(
		workspaceRoot(),
		".aloom-storage",
		"debug",
		"provider-adapter",
		args.provider,
	);
	await mkdir(directory, { recursive: true });
	const base = path.join(directory, `${key}-${args.phase}`);
	const [screenshot, snapshot] = await Promise.all([
		args.page.screenshot({ type: "png", fullPage: false }).catch(() => null),
		args.page
			.evaluate(() => ({
				title: document.title,
				text: (document.body?.innerText || "").slice(0, 100_000),
				html: document.documentElement.outerHTML.slice(0, 2_000_000),
			}), undefined)
			.catch(() => ({ title: "", text: "", html: "" })),
	]);
	if (screenshot) await writeFile(`${base}.png`, screenshot);
	await writeFile(
		`${base}.json`,
		JSON.stringify(
			{
				provider: args.provider,
				phase: args.phase,
				promptId: args.promptId ?? null,
				error: args.error ?? null,
				pageUrl: args.page.url(),
				capturedAt: capturedAt.toISOString(),
				...snapshot,
			},
			null,
			2,
		),
		"utf8",
	);
	return { jsonPath: `${base}.json`, screenshotPath: screenshot ? `${base}.png` : null };
}
