import {
	Activity,
	Boxes,
	Database,
	Eye,
	GitBranch,
	KeyRound,
	Radar,
	SearchCheck,
	ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const githubRepoUrl = process.env.NEXT_PUBLIC_GITHUB_REPO_URL?.trim() || null;
const landingUrl =
	process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3001";
const appUrl =
	process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";

export const SITE_URLS = {
	github: githubRepoUrl,
	githubLicense: githubRepoUrl ? `${githubRepoUrl}/blob/main/LICENSE` : null,
	signup: `${appUrl}/signup`,
	login: `${appUrl}/login`,
	docs: process.env.NEXT_PUBLIC_DOCS_URL?.trim() || `${landingUrl}/docs`,
	homepage: landingUrl,
} as const;

type FeatureItem = {
	title: string;
	description: string;
	icon: LucideIcon;
};

export const FEATURE_ITEMS: FeatureItem[] = [
	{
		title: "Free to Run Locally",
		description:
			"Install once and run entirely on your own machine with no subscription, no usage limits.",
		icon: KeyRound,
	},
	{
		title: "Your Own Provider Accounts",
		description:
			"Log in to each AI provider with your own account. Sessions stay on your machine.",
		icon: ShieldCheck,
	},
	{
		title: "AI Visibility Tracking",
		description: "See where your brand appears and where it disappears.",
		icon: Eye,
	},
	{
		title: "GEO Monitoring",
		description: "Track recommendation strength, rank, and sentiment by model.",
		icon: Radar,
	},
	{
		title: "Multi-Provider Prompt Testing",
		description:
			"Run one selected prompt suite across Doubao, DeepSeek, Yuanbao, and Qwen.",
		icon: SearchCheck,
	},
	{
		title: "Self-hostable Architecture",
		description: "Deploy web, worker, queue, and analytics in your own infra.",
		icon: Boxes,
	},
	{
		title: "ClickHouse Analytics",
		description:
			"Store high-volume responses and analytics with low-latency queries.",
		icon: Database,
	},
	{
		title: "Open-source Transparency",
		description: "Audit every step from prompt execution to final metric.",
		icon: Activity,
	},
];

export const STORAGE_KEY = "aloom-landing-theme" as const;

export const METHOD_POINTS = [
	"Doubao, DeepSeek, Yuanbao, and Qwen are monitored through their official Web interfaces, never through model APIs.",
	"You log in to each provider with your own account. Sessions are stored locally on your machine and never leave your infrastructure.",
	"A workspace-configured model analyzes captured answers after collection; it is never used as the monitoring data source.",
	"UI responses can differ from API responses in ranking, wording, and citation behavior for the same prompt.",
	"Every formal series freezes prompt hashes, providers, modes, sampling depth, and collection checkpoints.",
] as const;

export const OPEN_SOURCE_POINTS: Array<{ text: string; icon: LucideIcon }> = [
	{
		text: "Free to run locally with no subscription for official Web collection.",
		icon: KeyRound,
	},
	{
		text: "Use your own provider accounts. Sessions live on your machine, never elsewhere.",
		icon: ShieldCheck,
	},
	{
		text: "Fully open-source codebase with auditable commits and change history.",
		icon: GitBranch,
	},
	{
		text: "Self-hostable Docker stack for web, worker, queue, and analytics.",
		icon: Boxes,
	},
	{
		text: "Full data ownership for prompts, responses, citations, and analytics.",
		icon: Database,
	},
];

export const FOOTER_LINKS = [
	{ label: "Docs", href: SITE_URLS.docs },
	...(SITE_URLS.github ? [{ label: "GitHub", href: SITE_URLS.github }] : []),
	...(SITE_URLS.githubLicense
		? [{ label: "License", href: SITE_URLS.githubLicense }]
		: []),
];
