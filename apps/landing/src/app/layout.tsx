import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist } from "next/font/google";

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
const repositoryUrl = process.env.NEXT_PUBLIC_GITHUB_REPO_URL?.trim() || null;

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: "AnswerLoom | Official Web GEO Detection",
	description:
		"AnswerLoom measures product visibility across Doubao, DeepSeek, Yuanbao, and Qwen using preset prompt suites and official Web interfaces.",
	keywords: [
		"GEO",
		"generative engine optimization",
		"AI visibility",
		"AI visibility tracker",
		"AI visibility tracking",
		"brand visibility AI",
		"Doubao brand tracking",
		"DeepSeek brand tracking",
		"Qwen brand tracking",
		"open source GEO tool",
		"self-hosted GEO",
		"LLM visibility",
		"AI search detection",
		"AI mention tracking",
		"answerloom",
	],
	alternates: {
		canonical: siteUrl,
	},
	icons: {
		icon: [
			{
				url: "/logo.png",
				media: "(prefers-color-scheme: light)",
				type: "image/png",
			},
			{
				url: "/logo-dark.png",
				media: "(prefers-color-scheme: dark)",
				type: "image/png",
			},
		],
		shortcut: [
			{
				url: "/logo.png",
				type: "image/png",
			},
		],
		apple: [
			{
				url: "/logo.png",
				type: "image/png",
			},
		],
	},
	openGraph: {
		title: "AnswerLoom | Official Web GEO Detection",
		description:
			"Measure product visibility across Doubao, DeepSeek, Yuanbao, and Qwen through their official Web interfaces.",
		url: siteUrl,
		siteName: "AnswerLoom",
		type: "website",
		images: [
			{
				url: "/opengraph-image",
				width: 1200,
				height: 630,
				alt: "AnswerLoom official Web GEO detection report",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "AnswerLoom | Official Web GEO Detection",
		description:
			"Measure product visibility across Doubao, DeepSeek, Yuanbao, and Qwen through their official Web interfaces.",
		images: ["/twitter-image"],
	},
};

const jsonLd = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "AnswerLoom",
	url: siteUrl,
	description:
		"Open-source GEO detection for Doubao, DeepSeek, Yuanbao, and Qwen using persistent local browser profiles and official Web interfaces.",
	applicationCategory: "BusinessApplication",
	operatingSystem: "Linux, macOS, Windows",
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
	},
	license: "MIT",
	...(repositoryUrl ? { codeRepository: repositoryUrl } : {}),
	author: {
		"@type": "Organization",
		name: "AnswerLoom",
		url: siteUrl,
		...(repositoryUrl ? { sameAs: [repositoryUrl] } : {}),
	},
	keywords:
		"GEO, AI visibility, Doubao tracking, DeepSeek tracking, Yuanbao tracking, Qwen tracking, open source, self-hosted",
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
	return (
		<html lang="en" className={geist.variable} suppressHydrationWarning>
			<body>
				<script
					type="application/ld+json"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: structured data for search engines
					dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
				/>
				{children}
				<Analytics />
			</body>
		</html>
	);
}
