import { describe, expect, it } from "vitest";
import { resolveProviderConcurrency } from "./resourceCapacity.js";

const GIBIBYTE = 1024 ** 3;

describe("resolveProviderConcurrency", () => {
	it("allows all four providers on a sufficiently sized machine", () => {
		expect(
			resolveProviderConcurrency(4, {
				cpuCount: 8,
				totalMemoryBytes: 16 * GIBIBYTE,
			}),
		).toMatchObject({ requested: 4, effective: 4, resourceLimited: false });
	});

	it("automatically reduces four providers to two on low resources", () => {
		const decision = resolveProviderConcurrency(4, {
			cpuCount: 2,
			totalMemoryBytes: 8 * GIBIBYTE,
		});
		expect(decision).toMatchObject({
			requested: 4,
			effective: 2,
			resourceLimited: true,
		});
		expect(decision.reasons).toHaveLength(2);
	});

	it("does not raise an explicitly lower operator limit", () => {
		expect(
			resolveProviderConcurrency(1, {
				cpuCount: 2,
				totalMemoryBytes: 8 * GIBIBYTE,
			}),
		).toMatchObject({ requested: 1, effective: 1, resourceLimited: false });
	});
});
