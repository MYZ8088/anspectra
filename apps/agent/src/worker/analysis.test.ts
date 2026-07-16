import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	analysePromptsForWorkspace: vi.fn(),
	completeGeoAnalysis: vi.fn(),
	listRecoverableGeoAnalysisRuns: vi.fn(),
	markGeoAnalysisRunning: vi.fn(),
}));

vi.mock("@aloom/services", () => mocks);
vi.mock("@aloom/utils", () => ({
	createProviderLogger: () => ({
		log: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
	}),
	logger: { error: vi.fn() },
}));

import {
	recoverPendingGeoAnalyses,
	runAnalysisInBackground,
} from "./analysis.js";

describe("background analysis recovery", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.markGeoAnalysisRunning.mockResolvedValue(undefined);
		mocks.completeGeoAnalysis.mockResolvedValue(undefined);
		mocks.listRecoverableGeoAnalysisRuns.mockResolvedValue([]);
	});

	it("coalesces duplicate analysis requests for one collection run", async () => {
		let finishAnalysis: ((value: unknown) => void) | undefined;
		mocks.analysePromptsForWorkspace.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishAnalysis = resolve;
				}),
		);
		const input = {
			workspaceId: "workspace-1",
			userId: "user-1",
			provider: "doubao" as const,
			jobGroupId: "run-coalesced",
			collectionRunId: "run-coalesced",
		};

		expect(runAnalysisInBackground(input)).toBe(true);
		expect(runAnalysisInBackground(input)).toBe(false);
		await vi.waitFor(() =>
			expect(mocks.markGeoAnalysisRunning).toHaveBeenCalledTimes(1),
		);
		finishAnalysis?.({ processedResponseIds: [], errors: [] });
		await vi.waitFor(() =>
			expect(mocks.completeGeoAnalysis).toHaveBeenCalledTimes(1),
		);
	});

	it("requeues database-backed pending analysis after restart", async () => {
		mocks.listRecoverableGeoAnalysisRuns.mockResolvedValue([
			{
				collectionRunId: "run-recovered",
				workspaceId: "workspace-1",
				userId: "user-1",
				provider: "qwen",
			},
		]);
		mocks.analysePromptsForWorkspace.mockResolvedValue({
			processedResponseIds: ["sample-1"],
			errors: [],
		});

		await expect(recoverPendingGeoAnalyses()).resolves.toBe(1);
		await vi.waitFor(() =>
			expect(mocks.markGeoAnalysisRunning).toHaveBeenCalledWith(
				"run-recovered",
			),
		);
	});
});
