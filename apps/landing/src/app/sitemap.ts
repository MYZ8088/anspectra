import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
	const siteUrl =
		process.env.NEXT_PUBLIC_SITE_URL ?? "https://anspectra.pages.dev";
	return [
		{
			url: siteUrl,
			changeFrequency: "weekly",
			priority: 1,
			alternates: {
				languages: {
					en: siteUrl,
					"zh-CN": `${siteUrl}/zh-CN/`,
				},
			},
		},
		{
			url: `${siteUrl}/zh-CN/`,
			changeFrequency: "weekly",
			priority: 1,
			alternates: {
				languages: {
					en: siteUrl,
					"zh-CN": `${siteUrl}/zh-CN/`,
				},
			},
		},
		{
			url: `${siteUrl}/docs/`,
			changeFrequency: "monthly",
			priority: 0.7,
		},
	];
}
