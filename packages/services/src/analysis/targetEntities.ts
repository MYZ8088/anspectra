import type { AnalysisInputSingle, BrandAnalysisResult } from "@aloom/types";

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value?.trim();
		if (!trimmed) continue;
		const key = trimmed.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(trimmed);
	}
	return result;
}

export function targetEntities(input: AnalysisInputSingle): string[] {
	return uniqueNonEmpty([
		input.brandName,
		...(input.brandAliases ?? []),
		...(input.products ?? []),
	]);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textContainsEntity(text: string, entity: string): boolean {
	if (/\p{Script=Han}/u.test(entity)) {
		return text.toLocaleLowerCase().includes(entity.toLocaleLowerCase());
	}
	return new RegExp(
		`(?<![\\p{L}\\p{N}])${escapeRegExp(entity)}(?![\\p{L}\\p{N}])`,
		"iu",
	).test(text);
}

export function findMatchedTargetEntities(
	response: string,
	entities: string[],
): string[] {
	const proseWithoutRawUrls = response
		.replace(/https?:\/\/\S+/giu, " ")
		.replace(/www\.\S+/giu, " ");
	return entities.filter((entity) =>
		textContainsEntity(proseWithoutRawUrls, entity),
	);
}

function normalizedEntity(value: string): string {
	return value
		.toLocaleLowerCase()
		.normalize("NFKC")
		.replace(/[^\p{L}\p{N}]+/gu, "");
}

function isConfiguredTarget(value: string, entities: string[]): boolean {
	const normalized = normalizedEntity(value);
	if (!normalized) return false;
	return entities.some((entity) => {
		const target = normalizedEntity(entity);
		if (!target) return false;
		return (
			normalized === target ||
			(target.length >= 4 && normalized.includes(target)) ||
			(normalized.length >= 4 && target.includes(normalized))
		);
	});
}

/**
 * Enforces only facts that are deterministic from the confirmed profile and
 * captured answer. Rich scoring remains model-derived; the fallback is
 * intentionally conservative when a model overlooks a configured product.
 */
export function applyTargetEntitySafeguards(args: {
	input: AnalysisInputSingle;
	result: BrandAnalysisResult;
}): BrandAnalysisResult {
	const entities = targetEntities(args.input);
	const matched = findMatchedTargetEntities(args.input.response, entities);
	const competitors = args.result.competitors.filter(
		(competitor) => !isConfiguredTarget(competitor.name, entities),
	);
	const result: BrandAnalysisResult = {
		...args.result,
		competitors,
		metadata: {
			brandName: args.input.brandName,
			brandDomain: args.input.brandDomain,
			brandAliases: args.input.brandAliases ?? [],
			products: args.input.products ?? [],
			matchedTargetEntities: matched,
		},
	};

	if (matched.length === 0 || result.presence.mentioned) return result;

	const visibility = Math.max(result.presence.visibility, 15);
	const sentiment = result.sentiment.score || 50;
	const recommendation =
		result.recommendation.type === "not_mentioned"
			? "mentioned_only"
			: result.recommendation.type;
	const recommendationValue =
		recommendation === "top_pick"
			? 100
			: recommendation === "strong_alternative"
				? 80
				: recommendation === "conditional"
					? 60
					: recommendation === "discouraged"
						? 10
						: 30;
	const rankValue = result.position.rankPosition
		? result.position.rankPosition === 1
			? 100
			: result.position.rankPosition === 2
				? 80
				: result.position.rankPosition === 3
					? 65
					: result.position.rankPosition === 4
						? 50
						: result.position.rankPosition === 5
							? 40
							: 30
		: 15;
	const overall = Math.round(
		visibility * 0.25 +
			rankValue * 0.25 +
			sentiment * 0.25 +
			recommendationValue * 0.25,
	);
	const targetShare = Math.round((100 / (competitors.length + 1)) * 100) / 100;

	return {
		...result,
		geoScore: { overall },
		presence: { mentioned: true, visibility },
		sentiment: { score: sentiment },
		recommendation: { type: recommendation },
		risks: {
			items: result.risks.items.filter(
				(risk) => risk.type !== "missing_from_response",
			),
		},
		scorecard: {
			...result.scorecard,
			visibility: { score: visibility, numerator: 1, denominator: 1 },
			competition: {
				score: targetShare,
				targetShare,
				competitorShare: Math.round((100 - targetShare) * 100) / 100,
			},
		},
	};
}
