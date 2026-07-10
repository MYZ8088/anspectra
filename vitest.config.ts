import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: [
			"scripts/**/*.test.mjs",
			"apps/agent/src/**/*.test.ts",
			"apps/web/src/**/*.test.ts",
			"packages/*/src/**/*.test.ts",
		],
		exclude: ["external/**", "**/node_modules/**", "**/dist/**"],
	},
});
