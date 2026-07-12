import { describe, expect, it } from "vitest";
import type { Page } from "./runtimeTypes.js";
import { TaskPageRegistry } from "./taskPageRegistry.js";

function fakePage(name: string): Page {
	return { name } as unknown as Page;
}

describe("TaskPageRegistry", () => {
	it("binds every browser page to exactly one task", () => {
		const registry = new TaskPageRegistry();
		const page = fakePage("initial");

		registry.bind(page, "collection:run-1:qwen");

		expect(registry.ownerOf(page)).toBe("collection:run-1:qwen");
		expect(() => registry.bind(page, "collection:run-2:qwen")).toThrow(
			/already owned/i,
		);
	});

	it("tracks task-created popups and releases all of them together", () => {
		const registry = new TaskPageRegistry();
		const main = fakePage("main");
		const popup = fakePage("popup");
		registry.bind(main, "task-1");
		registry.bind(popup, "task-1");

		expect(registry.pagesForTask("task-1")).toEqual([main, popup]);
		expect(registry.releaseTask("task-1")).toEqual([main, popup]);
		expect(registry.ownerOf(main)).toBeNull();
		expect(registry.ownerOf(popup)).toBeNull();
	});

	it("rejects unbound pages before provider automation can use them", () => {
		const registry = new TaskPageRegistry();
		const page = fakePage("orphan");

		expect(() => registry.assertOwnedBy(page, "task-1")).toThrow(/not bound/i);
	});
});
