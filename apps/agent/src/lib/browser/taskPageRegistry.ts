import type { Page } from "./runtimeTypes.js";

export class TaskPageRegistry {
	private readonly ownerByPage = new Map<Page, string>();
	private readonly pagesByTask = new Map<string, Set<Page>>();

	bind(page: Page, taskId: string): void {
		const existingOwner = this.ownerByPage.get(page);
		if (existingOwner && existingOwner !== taskId) {
			throw new Error(
				`Browser page is already owned by task ${existingOwner}; task ${taskId} cannot claim it`,
			);
		}
		if (existingOwner === taskId) return;

		this.ownerByPage.set(page, taskId);
		const taskPages = this.pagesByTask.get(taskId) ?? new Set<Page>();
		taskPages.add(page);
		this.pagesByTask.set(taskId, taskPages);
	}

	assertOwnedBy(page: Page, taskId: string): void {
		const owner = this.ownerByPage.get(page);
		if (owner !== taskId) {
			throw new Error(
				owner
					? `Browser page belongs to task ${owner}, not ${taskId}`
					: `Browser page is not bound to task ${taskId}`,
			);
		}
	}

	ownerOf(page: Page): string | null {
		return this.ownerByPage.get(page) ?? null;
	}

	pagesForTask(taskId: string): Page[] {
		return [...(this.pagesByTask.get(taskId) ?? [])];
	}

	releaseTask(taskId: string): Page[] {
		const pages = this.pagesForTask(taskId);
		for (const page of pages) this.ownerByPage.delete(page);
		this.pagesByTask.delete(taskId);
		return pages;
	}

	clear(): void {
		this.ownerByPage.clear();
		this.pagesByTask.clear();
	}
}
