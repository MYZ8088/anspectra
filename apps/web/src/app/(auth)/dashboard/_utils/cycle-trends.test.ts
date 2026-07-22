import { describe, expect, it } from "vitest";
import {
	type CycleTrendInput,
	type CycleTrendMetric,
	buildCycleTrendMetrics,
	formatCycleTrendDelta,
	formatCycleTrendValue,
} from "./cycle-trends";

function metricByKey(
	metrics: CycleTrendMetric[],
	key: CycleTrendMetric["key"],
) {
	const metric = metrics.find((item) => item.key === key);
	if (!metric) throw new Error(`Missing cycle trend metric: ${key}`);
	return metric;
}

function cycle(
	roundIndex: number,
	values: {
		score: number;
		mention: number;
		recommendation: number;
		source: number;
		stability: number | null;
	},
): CycleTrendInput {
	return {
		roundIndex,
		overall: {
			weightedScore: { overall: values.score },
			mentionRate: { value: values.mention },
			recommendationRate: { value: values.recommendation },
			sourceExposureRate: { value: values.source },
			stability: values.stability,
		},
	};
}

describe("cycle trend metrics", () => {
	it("builds all five metrics and formats two-cycle changes", () => {
		const metrics = buildCycleTrendMetrics([
			cycle(1, {
				score: 52,
				mention: 40,
				recommendation: 10,
				source: 25,
				stability: 70,
			}),
			cycle(2, {
				score: 60,
				mention: 55,
				recommendation: 15,
				source: 35,
				stability: 76,
			}),
		]);

		expect(metrics.map((metric) => metric.key)).toEqual([
			"geo_score",
			"mention",
			"recommendation",
			"source",
			"stability",
		]);
		expect(formatCycleTrendValue(metricByKey(metrics, "mention"))).toBe("55%");
		expect(formatCycleTrendDelta(metricByKey(metrics, "mention"))).toBe(
			"+15 pp",
		);
		expect(formatCycleTrendDelta(metricByKey(metrics, "geo_score"))).toBe(
			"+8 pts",
		);
	});

	it("uses the latest two known values in a longer trend", () => {
		const metrics = buildCycleTrendMetrics([
			cycle(1, {
				score: 52,
				mention: 40,
				recommendation: 10,
				source: 25,
				stability: 70,
			}),
			cycle(2, {
				score: 58,
				mention: 50,
				recommendation: 12,
				source: 30,
				stability: null,
			}),
			cycle(3, {
				score: 61,
				mention: 55,
				recommendation: 18,
				source: 42,
				stability: 78,
			}),
		]);

		const stability = metricByKey(metrics, "stability");
		expect(stability.values).toEqual([70, null, 78]);
		expect(stability.latest).toBe(78);
		expect(stability.delta).toBe(8);
	});

	it("keeps unavailable stability out of the numeric trend", () => {
		const metrics = buildCycleTrendMetrics([
			cycle(1, {
				score: 52,
				mention: 40,
				recommendation: 10,
				source: 25,
				stability: null,
			}),
			cycle(2, {
				score: 60,
				mention: 55,
				recommendation: 15,
				source: 35,
				stability: null,
			}),
		]);

		const stability = metricByKey(metrics, "stability");
		expect(stability.latest).toBeNull();
		expect(stability.delta).toBeNull();
		expect(formatCycleTrendValue(stability)).toBe("Not assessed");
		expect(formatCycleTrendDelta(stability)).toBe("—");
	});
});
