import type { ByModel } from "./metrics.js";
import type { PromptResponse } from "./prompts.js";

export const SOURCE_KIND_LIST = [
	"answer_link",
	"search_source",
	"legacy_unknown",
] as const;

export type SourceKind = (typeof SOURCE_KIND_LIST)[number];

export const SEARCH_SOURCE_COVERAGE_LIST = [
	"complete",
	"partial",
	"count_not_exposed",
	"not_exposed",
] as const;

export type SearchSourceCoverage = (typeof SEARCH_SOURCE_COVERAGE_LIST)[number];

export interface Source {
	title: string;
	cited_text: string;
	url: string;
	domain: string | null;
	favicon?: string | null;
	/** Where the official provider Web UI exposed this URL. */
	source_kind?: SourceKind;
}

export interface SourceLookup {
	sources: Source[];
}

// Sources page UI

export type DomainStats = {
	domain: string;
	totalOccurrences: number;
	sourceTextCount: number;
	usedPercentageAcrossAllDomains: number;
	avgSourcesPerDomain: number;
};

export type DomainResponseClient = {
	responses: PromptResponse[];
	domain_stats: DomainStats[];
};

export type SourceExcerpt = {
	cited_text: string;
	model_provider?: string;
};

export type GroupedSource = {
	title: string;
	url: string;
	excerpts: SourceExcerpt[];
	totalSources: number;
};

export type SourceGroupResult = {
	combined: GroupedSource[];
	byModel: ByModel<GroupedSource>;
};
