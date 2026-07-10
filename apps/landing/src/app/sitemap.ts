import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
	const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";
	return [
		{
			url: siteUrl,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${siteUrl}/#open-source`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
	];
}
