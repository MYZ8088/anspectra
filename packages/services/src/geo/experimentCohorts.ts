export type CohortPrompt = {
	id: string;
	promptGroup: string;
	decisionStage: string | null;
	locale: string;
	brandExposure: string | null;
	cohort: string;
};

function uniqueRows<T extends { id: string }>(rows: T[]) {
	return [...new Map(rows.map((row) => [row.id, row])).values()];
}

export function buildMatchedPromptCohorts<T extends CohortPrompt>(
	prompts: T[],
	directTreatmentIds: Iterable<string>,
) {
	const directIds = new Set(directTreatmentIds);
	let treatment = prompts.filter((prompt) => directIds.has(prompt.id));
	if (treatment.length === 0) {
		treatment = prompts.filter(
			(prompt) =>
				prompt.brandExposure === "aided" || prompt.cohort === "treatment",
		);
	}
	const treatmentIds = new Set(treatment.map((prompt) => prompt.id));
	const control = uniqueRows(
		treatment.flatMap((target) => {
			const match = prompts.find(
				(candidate) =>
					!treatmentIds.has(candidate.id) &&
					candidate.promptGroup === target.promptGroup &&
					candidate.decisionStage === target.decisionStage &&
					candidate.locale === target.locale &&
					candidate.brandExposure === "blind",
			);
			return match ? [match] : [];
		}),
	);
	return { treatment: uniqueRows(treatment), control };
}

type RateMetric = { mentionRate: number; denominator: number };

export function calculateDifferenceInDifferences(args: {
	baselineTreatment: RateMetric;
	baselineControl: RateMetric;
	afterTreatment: RateMetric;
	afterControl: RateMetric;
}) {
	if (
		args.baselineTreatment.denominator === 0 ||
		args.baselineControl.denominator === 0 ||
		args.afterTreatment.denominator === 0 ||
		args.afterControl.denominator === 0
	) {
		return null;
	}
	const treatmentDelta =
		args.afterTreatment.mentionRate - args.baselineTreatment.mentionRate;
	const controlDelta =
		args.afterControl.mentionRate - args.baselineControl.mentionRate;
	return Math.round((treatmentDelta - controlDelta) * 100) / 100;
}
