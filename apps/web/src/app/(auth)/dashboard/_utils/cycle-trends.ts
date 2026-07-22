export type CycleTrendInput = {
	roundIndex: number;
	overall: {
		weightedScore: { overall: number };
		mentionRate: { value: number };
		recommendationRate: { value: number };
		sourceExposureRate: { value: number };
		stability: number | null;
	};
};

export type CycleTrendMetric = {
	key: "geo_score" | "mention" | "recommendation" | "source" | "stability";
	label: string;
	unit: "points" | "percentage_points";
	values: Array<number | null>;
	latest: number | null;
	delta: number | null;
};

function latestKnown(values: Array<number | null>) {
	for (let index = values.length - 1; index >= 0; index -= 1) {
		const value = values[index];
		if (value !== null && value !== undefined) return { index, value };
	}
	return null;
}

function changeFromPrevious(values: Array<number | null>) {
	const latest = latestKnown(values);
	if (!latest) return null;
	for (let index = latest.index - 1; index >= 0; index -= 1) {
		const previous = values[index];
		if (previous !== null && previous !== undefined) {
			return Math.round((latest.value - previous) * 100) / 100;
		}
	}
	return null;
}

export function buildCycleTrendMetrics(
	cycles: CycleTrendInput[],
): CycleTrendMetric[] {
	const definitions: Array<{
		key: CycleTrendMetric["key"];
		label: string;
		unit: CycleTrendMetric["unit"];
		value: (cycle: CycleTrendInput) => number | null;
	}> = [
		{
			key: "geo_score",
			label: "GEO Score",
			unit: "points",
			value: (cycle) => cycle.overall.weightedScore.overall,
		},
		{
			key: "mention",
			label: "Mention Rate",
			unit: "percentage_points",
			value: (cycle) => cycle.overall.mentionRate.value,
		},
		{
			key: "recommendation",
			label: "Recommendation Rate",
			unit: "percentage_points",
			value: (cycle) => cycle.overall.recommendationRate.value,
		},
		{
			key: "source",
			label: "Source Exposure",
			unit: "percentage_points",
			value: (cycle) => cycle.overall.sourceExposureRate.value,
		},
		{
			key: "stability",
			label: "Stability",
			unit: "points",
			value: (cycle) => cycle.overall.stability,
		},
	];

	return definitions.map((definition) => {
		const values = cycles.map(definition.value);
		return {
			key: definition.key,
			label: definition.label,
			unit: definition.unit,
			values,
			latest: latestKnown(values)?.value ?? null,
			delta: changeFromPrevious(values),
		};
	});
}

export function formatCycleTrendValue(metric: CycleTrendMetric) {
	if (metric.latest === null) return "Not assessed";
	return metric.unit === "percentage_points"
		? `${metric.latest}%`
		: `${metric.latest}`;
}

export function formatCycleTrendDelta(metric: CycleTrendMetric) {
	if (metric.delta === null) return "—";
	const prefix = metric.delta > 0 ? "+" : "";
	const suffix = metric.unit === "percentage_points" ? " pp" : " pts";
	return `${prefix}${metric.delta}${suffix}`;
}
