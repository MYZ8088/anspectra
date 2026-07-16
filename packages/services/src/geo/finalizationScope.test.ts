import { describe, expect, it } from "vitest";
import { selectFinalizableCheckpointIds } from "./finalizationScope.js";

const openCheckpoints = [
	{ id: "checkpoint-a", promptId: "prompt-a" },
	{ id: "checkpoint-b", promptId: "prompt-b" },
	{ id: "checkpoint-c", promptId: null },
];

describe("selectFinalizableCheckpointIds", () => {
	it("limits a retry job to prompts in its own payload", () => {
		expect(
			selectFinalizableCheckpointIds({
				openCheckpoints,
				ownedPromptIds: ["prompt-a"],
			}),
		).toEqual(["checkpoint-a"]);
	});

	it("keeps legacy whole-provider finalization when no scope is supplied", () => {
		expect(selectFinalizableCheckpointIds({ openCheckpoints })).toEqual([
			"checkpoint-a",
			"checkpoint-b",
			"checkpoint-c",
		]);
	});
});
