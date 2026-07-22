import type { Metadata } from "next";

const siteUrl =
	process.env.NEXT_PUBLIC_SITE_URL ?? "https://anspectra.pages.dev";

export const metadata: Metadata = {
	title: "Anspectra | 基于官方 Web 的 GEO 检测",
	description:
		"Anspectra 使用预设提示词套件和真实官方 Web 界面，测量产品在豆包、DeepSeek、元宝和千问回答中的可见性。",
	alternates: {
		canonical: `${siteUrl}/zh-CN/`,
		languages: {
			en: siteUrl,
			"zh-CN": `${siteUrl}/zh-CN/`,
		},
	},
	openGraph: {
		title: "Anspectra | 基于官方 Web 的 GEO 检测",
		description:
			"通过豆包、DeepSeek、元宝和千问的真实官方 Web 界面测量产品可见性。",
		url: `${siteUrl}/zh-CN/`,
		locale: "zh_CN",
	},
};

export default function ChineseLayout({
	children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
	return <>{children}</>;
}
