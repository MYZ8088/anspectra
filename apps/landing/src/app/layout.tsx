import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";

const geist = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

const siteUrl =
	process.env.NEXT_PUBLIC_SITE_URL ?? "https://anspectra.pages.dev";
const repositoryUrl = process.env.NEXT_PUBLIC_GITHUB_REPO_URL?.trim() || null;

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: "Anspectra | Official Web GEO Detection",
	description:
		"Anspectra measures product visibility across Doubao, DeepSeek, Yuanbao, and Qwen using preset prompt suites and official Web interfaces.",
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
		"anspectra",
	],
	alternates: {
		canonical: siteUrl,
	},
	icons: {
		icon: [
			{
				url: "/anspectra-mark-v2.png",
				media: "(prefers-color-scheme: light)",
				type: "image/png",
			},
			{
				url: "/anspectra-mark-v2-dark.png",
				media: "(prefers-color-scheme: dark)",
				type: "image/png",
			},
		],
		shortcut: [
			{
				url: "/anspectra-mark-v2.png",
				type: "image/png",
			},
		],
		apple: [
			{
				url: "/anspectra-mark-v2.png",
				type: "image/png",
			},
		],
	},
	openGraph: {
		title: "Anspectra | Official Web GEO Detection",
		description:
			"Measure product visibility across Doubao, DeepSeek, Yuanbao, and Qwen through their official Web interfaces.",
		url: siteUrl,
		siteName: "Anspectra",
		type: "website",
		images: [
			{
				url: "/opengraph-image",
				width: 1200,
				height: 630,
				alt: "Anspectra official Web GEO detection report",
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: "Anspectra | Official Web GEO Detection",
		description:
			"Measure product visibility across Doubao, DeepSeek, Yuanbao, and Qwen through their official Web interfaces.",
		images: ["/twitter-image"],
	},
};

const jsonLd = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "Anspectra",
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
	license: "Apache-2.0",
	...(repositoryUrl ? { codeRepository: repositoryUrl } : {}),
	author: {
		"@type": "Organization",
		name: "Anspectra",
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
			</body>
		</html>
	);
}
