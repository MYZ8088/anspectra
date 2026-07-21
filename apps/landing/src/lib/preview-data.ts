import type { DashboardCompetitorData } from "@anspectra/ui";

export const PREVIEW_BRAND = {
	name: "PostHog",
	domain: "posthog.com",
} as const;

export const PREVIEW_COMPETITORS: DashboardCompetitorData[] = [
	{
		name: "PostHog",
		domain: "posthog.com",
		appearances: 164,
		visibility: 76,
		avgSentiment: 81,
		avgRank: 1.8,
		recCount: 118,
		isBrand: true,
	},
	{
		name: "Mixpanel",
		domain: "mixpanel.com",
		appearances: 151,
		visibility: 70,
		avgSentiment: 78,
		avgRank: 2.1,
		recCount: 109,
	},
	{
		name: "Amplitude",
		domain: "amplitude.com",
		appearances: 143,
		visibility: 66,
		avgSentiment: 77,
		avgRank: 2.4,
		recCount: 101,
	},
	{
		name: "Matomo",
		domain: "matomo.org",
		appearances: 92,
		visibility: 43,
		avgSentiment: 72,
		avgRank: 3.1,
		recCount: 55,
	},
	{
		name: "Plausible",
		domain: "plausible.io",
		appearances: 71,
		visibility: 33,
		avgSentiment: 75,
		avgRank: 3.6,
		recCount: 42,
	},
	{
		name: "OpenReplay",
		domain: "openreplay.com",
		appearances: 48,
		visibility: 22,
		avgSentiment: 68,
		avgRank: 4.2,
		recCount: 25,
	},
];

export const PREVIEW_TOTAL_RESPONSES = 216;
export const PREVIEW_TOTAL_CITATIONS = 184;

export const PREVIEW_PERCEPTION = {
	bestKnownFor: "open-source product analytics with broad product tooling",
	pricingPerception: "mid_range",
	coreClaims: [
		"self-hosted and cloud deployment options",
		"product analytics and session replay in one platform",
		"feature flags and experiments alongside analytics",
		"developer-focused implementation workflow",
	],
	differentiators: [
		"open-source deployment path",
		"integrated product stack",
		"warehouse-friendly data access",
		"transparent public documentation",
		"strong startup adoption signal",
	],
} as const;

export const PREVIEW_SOURCE_GROUPS = [
	{
		domain: "posthog.com",
		urls: 18,
		citations: 47,
		share: 25.5,
		brandMentions: 41,
		providers: ["doubao", "deepseek", "hunyuan", "qwen"],
	},
	{
		domain: "github.com",
		urls: 16,
		citations: 39,
		share: 21.2,
		brandMentions: 34,
		providers: ["deepseek", "qwen"],
	},
	{
		domain: "mixpanel.com",
		urls: 11,
		citations: 28,
		share: 15.2,
		brandMentions: 22,
		providers: ["doubao", "deepseek", "hunyuan"],
	},
	{
		domain: "amplitude.com",
		urls: 10,
		citations: 24,
		share: 13,
		brandMentions: 20,
		providers: ["doubao", "hunyuan", "qwen"],
	},
	{
		domain: "matomo.org",
		urls: 8,
		citations: 18,
		share: 9.8,
		brandMentions: 14,
		providers: ["deepseek", "qwen"],
	},
	{
		domain: "g2.com",
		urls: 7,
		citations: 13,
		share: 7.1,
		brandMentions: 12,
		providers: ["doubao", "hunyuan"],
	},
	{
		domain: "plausible.io",
		urls: 5,
		citations: 9,
		share: 4.9,
		brandMentions: 8,
		providers: ["deepseek", "qwen"],
	},
	{
		domain: "openreplay.com",
		urls: 4,
		citations: 6,
		share: 3.3,
		brandMentions: 5,
		providers: ["doubao", "hunyuan"],
	},
] as const;

export const PREVIEW_CITATION_ROWS = [
	{
		domain: "posthog.com",
		title: "PostHog Product Analytics",
		provider: "doubao",
		citations: 14,
		excerpt:
			"The official product page describes analytics, replay, flags, and deployment options.",
	},
	{
		domain: "github.com",
		title: "PostHog Open-Source Repository",
		provider: "deepseek",
		citations: 12,
		excerpt:
			"The repository exposes the license, release activity, architecture, and contribution history.",
	},
	{
		domain: "mixpanel.com",
		title: "Mixpanel Product Analytics",
		provider: "hunyuan",
		citations: 9,
		excerpt:
			"Mixpanel documentation is visible in answers comparing fast hosted analytics workflows.",
	},
	{
		domain: "amplitude.com",
		title: "Amplitude Analytics Platform",
		provider: "qwen",
		citations: 8,
		excerpt:
			"Amplitude appears in evaluation-stage answers about governance and enterprise analytics.",
	},
] as const;

export const PREVIEW_BRAND_METRICS = {
	presenceRate: 76,
	recommendationRate: 55,
	sentimentScore: 81,
	avgRank: 1.8,
} as const;

export const PREVIEW_AGGREGATE_STATS = {
	presenceRate: 76,
	rank: 2,
	topSource: "posthog.com",
	topCompetitor: "Mixpanel",
	topCompetitorDomain: "mixpanel.com",
} as const;

export const PREVIEW_COMPETITOR_PROVIDERS: Record<string, string[]> = {
	PostHog: ["doubao", "deepseek", "hunyuan", "qwen"],
	Mixpanel: ["doubao", "deepseek", "hunyuan"],
	Amplitude: ["doubao", "hunyuan", "qwen"],
	Matomo: ["deepseek", "qwen"],
	Plausible: ["deepseek", "qwen"],
	OpenReplay: ["doubao", "hunyuan"],
} as const;

export const PREVIEW_PROMPT_RESPONSES = [
	{
		id: "resp-1",
		modelProvider: "doubao",
		modelName: "Doubao",
		promptRunAt: "2026-07-10T06:15:00.000Z",
		response:
			"For a B2B SaaS team comparing product analytics platforms, PostHog is commonly included when open-source deployment, session replay, and feature flags matter. Mixpanel is often positioned as a focused hosted analytics choice, while Amplitude is frequently associated with enterprise product analytics governance. The right shortlist depends on deployment, data ownership, implementation effort, and expected analysis depth.",
		isAnalysed: true,
		metrics: { geoScore: 82, sentiment: 81, visibility: 86, position: 1 },
		sources: [
			{
				title: "PostHog Product Analytics",
				url: "https://posthog.com/product-analytics",
			},
			{
				title: "PostHog GitHub Repository",
				url: "https://github.com/PostHog/posthog",
			},
		],
	},
	{
		id: "resp-2",
		modelProvider: "deepseek",
		modelName: "DeepSeek",
		promptRunAt: "2026-07-10T09:40:00.000Z",
		response:
			"A privacy-conscious startup should verify where events are stored, whether self-hosting is operationally realistic, how identity resolution works, and which capabilities require paid tiers. PostHog, Matomo, and Plausible can all appear in an open-source shortlist, but they serve different analytics depths. PostHog is the broadest product stack of the three; Matomo has a longer web analytics history; Plausible favors a narrower privacy-first model.",
		isAnalysed: true,
		metrics: { geoScore: 77, sentiment: 78, visibility: 79, position: 2 },
		sources: [
			{
				title: "PostHog Self-Hosting Documentation",
				url: "https://posthog.com/docs/self-host",
			},
			{
				title: "Matomo Analytics",
				url: "https://matomo.org/",
			},
		],
	},
	{
		id: "resp-3",
		modelProvider: "hunyuan",
		modelName: "Yuanbao",
		promptRunAt: "2026-07-10T13:05:00.000Z",
		response:
			"When comparing PostHog, Mixpanel, and Amplitude, teams should separate product fit from implementation cost. PostHog is often considered for an integrated open-source product stack. Mixpanel is usually evaluated for straightforward event analysis and reporting. Amplitude is commonly considered by larger teams that need structured product analytics practices. Buyers should verify current pricing and deployment limits on official pages.",
		isAnalysed: true,
		metrics: { geoScore: 74, sentiment: 76, visibility: 75, position: 2 },
		sources: [],
	},
	{
		id: "resp-4",
		modelProvider: "qwen",
		modelName: "Qwen",
		promptRunAt: "2026-07-10T16:30:00.000Z",
		response:
			"For a team that wants product analytics plus replay and feature delivery controls, PostHog may enter the candidate set. For a narrower hosted analytics workflow, Mixpanel may be easier to evaluate. For enterprise-scale behavioral analytics programs, Amplitude is frequently discussed. A fair comparison should use the same event volume, retention window, governance requirements, and implementation period.",
		isAnalysed: true,
		metrics: { geoScore: 79, sentiment: 80, visibility: 82, position: 1 },
		sources: [
			{
				title: "Amplitude Product Analytics",
				url: "https://amplitude.com/product-analytics",
			},
		],
	},
] as const;
