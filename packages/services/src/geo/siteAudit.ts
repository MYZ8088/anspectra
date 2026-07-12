import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { db, schema } from "@aloom/db";
import { load } from "cheerio";
import { and, desc, eq } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import robotsParser from "robots-parser";

const USER_AGENT = "Aloom-GEO-Audit/1.0";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

const parseRobots = robotsParser as unknown as (
	url: string,
	content: string,
) => {
	isAllowed: (url: string, userAgent?: string) => boolean | undefined;
	getSitemaps: () => string[];
};

type PageSnapshot = {
	description: string;
	metaRobots: string;
	h1: string[];
	h2: string[];
	h3: string[];
	mainText: string;
	jsonLd: unknown[];
	faqSignals: string[];
	internalLinks: string[];
	initialHtmlHasMainContent: boolean;
};

function isPrivateAddress(address: string): boolean {
	return (
		/^127\./.test(address) ||
		/^10\./.test(address) ||
		/^192\.168\./.test(address) ||
		/^169\.254\./.test(address) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(address) ||
		address === "::1" ||
		address.startsWith("fc") ||
		address.startsWith("fd") ||
		address.startsWith("fe80:")
	);
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
	const url = new URL(rawUrl);
	if (!new Set(["http:", "https:"]).has(url.protocol)) {
		throw new Error("Only HTTP and HTTPS URLs can be audited");
	}
	if (url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
		throw new Error("Localhost URLs are not allowed in public site audits");
	}
	const addresses = await lookup(url.hostname, { all: true });
	if (addresses.some((entry) => isPrivateAddress(entry.address))) {
		throw new Error(
			"Private network addresses are not allowed in public site audits",
		);
	}
	return url;
}

async function fetchPublicText(rawUrl: string): Promise<{
	url: string;
	status: number;
	text: string;
}> {
	let currentUrl = (await assertPublicUrl(rawUrl)).toString();
	for (let redirect = 0; redirect < 5; redirect += 1) {
		const response = await fetch(currentUrl, {
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "text/html,application/xml",
			},
			redirect: "manual",
			signal: AbortSignal.timeout(15_000),
		});
		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get("location");
			if (!location)
				throw new Error(`Redirect without location: ${currentUrl}`);
			currentUrl = (
				await assertPublicUrl(new URL(location, currentUrl).toString())
			).toString();
			continue;
		}
		const contentLength = Number(response.headers.get("content-length") || 0);
		if (contentLength > MAX_RESPONSE_BYTES) {
			throw new Error(`Response exceeds ${MAX_RESPONSE_BYTES} bytes`);
		}
		const text = (await response.text()).slice(0, MAX_RESPONSE_BYTES);
		return { url: response.url || currentUrl, status: response.status, text };
	}
	throw new Error(`Too many redirects: ${rawUrl}`);
}

function arrayify<T>(value: T | T[] | undefined): T[] {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function extractSitemapUrls(xml: string): string[] {
	const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) as {
		urlset?: { url?: Array<{ loc?: string }> | { loc?: string } };
	};
	return arrayify(parsed.urlset?.url)
		.map((entry) => entry.loc?.trim())
		.filter((url): url is string => Boolean(url));
}

function extractPageSnapshot(
	html: string,
	origin: string,
): {
	title: string;
	canonicalUrl: string | null;
	snapshot: PageSnapshot;
} {
	const $ = load(html);
	const jsonLd = $('script[type="application/ld+json"]')
		.map((_index, element) => {
			try {
				return JSON.parse($(element).text()) as unknown;
			} catch {
				return null;
			}
		})
		.get()
		.filter((value) => value !== null);
	const contentRoot = $("main, article").first().length
		? $("main, article").first().clone()
		: $("body").clone();
	contentRoot.find("script,style,noscript,nav,footer,header").remove();
	const headings = (selector: string) =>
		$(selector)
			.map((_index, element) => $(element).text().replace(/\s+/g, " ").trim())
			.get()
			.filter(Boolean);
	const internalLinks = $("a[href]")
		.map((_index, element) => {
			try {
				const url = new URL($(element).attr("href") || "", origin);
				return url.origin === origin ? url.toString() : null;
			} catch {
				return null;
			}
		})
		.get()
		.filter((url): url is string => Boolean(url));
	const allHeadings = [...headings("h1"), ...headings("h2"), ...headings("h3")];
	return {
		title: $("title").first().text().trim(),
		canonicalUrl: $('link[rel="canonical"]').first().attr("href") || null,
		snapshot: {
			description: $('meta[name="description"]').attr("content")?.trim() || "",
			metaRobots: $('meta[name="robots"]').attr("content")?.trim() || "",
			h1: headings("h1"),
			h2: headings("h2"),
			h3: headings("h3"),
			mainText: contentRoot.text().replace(/\s+/g, " ").trim().slice(0, 50_000),
			jsonLd,
			faqSignals: allHeadings.filter((heading) =>
				/\?|？|faq|常见问题/i.test(heading),
			),
			internalLinks: [...new Set(internalLinks)].slice(0, 200),
			initialHtmlHasMainContent: contentRoot.text().trim().length >= 300,
		},
	};
}

function normalizeRoot(domain: string): URL {
	const raw = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
	const url = new URL(raw);
	url.pathname = "/";
	url.search = "";
	url.hash = "";
	return url;
}

export async function auditWorkspaceSite(args: {
	workspaceId: string;
	domain: string;
	maxPages?: number;
	seedUrl?: string;
}) {
	const root = normalizeRoot(args.domain);
	await assertPublicUrl(root.toString());
	const seed = args.seedUrl ? await assertPublicUrl(args.seedUrl) : root;
	if (seed.origin !== root.origin) {
		throw new Error("Audit seed URL must use the workspace site origin");
	}
	const robotsUrl = new URL("/robots.txt", root).toString();
	const robotsResult = await fetchPublicText(robotsUrl).catch(() => ({
		url: robotsUrl,
		status: 0,
		text: "",
	}));
	const robots = parseRobots(robotsUrl, robotsResult.text);
	const sitemapUrls = robots.getSitemaps();
	if (sitemapUrls.length === 0)
		sitemapUrls.push(new URL("/sitemap.xml", root).toString());
	const discovered = new Set<string>([seed.toString(), root.toString()]);
	for (const sitemapUrl of sitemapUrls.slice(0, 3)) {
		const sitemap = await fetchPublicText(sitemapUrl).catch(() => null);
		if (!sitemap) continue;
		for (const url of extractSitemapUrls(sitemap.text)) {
			try {
				const parsed = new URL(url);
				if (parsed.origin === root.origin) discovered.add(parsed.toString());
			} catch {}
		}
	}

	const selected = [...discovered].slice(0, Math.min(args.maxPages ?? 30, 100));
	const rows: Array<{ url: string; status: number; title: string }> = [];
	for (const url of selected) {
		if (robots.isAllowed(url, USER_AGENT) === false) continue;
		const result = await fetchPublicText(url).catch(() => null);
		if (!result) continue;
		const page = extractPageSnapshot(result.text, root.origin);
		const contentHash = createHash("sha256")
			.update(page.snapshot.mainText)
			.digest("hex");
		const [storedPage] = await db
			.insert(schema.sitePages)
			.values({
				workspaceId: args.workspaceId,
				url: result.url,
				title: page.title,
				canonicalUrl: page.canonicalUrl,
				contentHash,
				httpStatus: result.status,
				snapshot: page.snapshot,
				lastCrawledAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: [schema.sitePages.workspaceId, schema.sitePages.url],
				set: {
					title: page.title,
					canonicalUrl: page.canonicalUrl,
					contentHash,
					httpStatus: result.status,
					snapshot: page.snapshot,
					lastCrawledAt: new Date(),
					updatedAt: new Date(),
				},
			})
			.returning();
		if (storedPage) {
			await db.insert(schema.pageSnapshots).values({
				workspaceId: args.workspaceId,
				pageId: storedPage.id,
				url: result.url,
				trigger: "audit",
				contentHash,
				httpStatus: result.status,
				snapshot: page.snapshot,
				capturedAt: new Date(),
			});
		}
		const factCandidates = [
			page.snapshot.description
				? {
						predicate: "official_page_description",
						value: page.snapshot.description,
					}
				: null,
			page.snapshot.h1[0]
				? { predicate: "primary_heading", value: page.snapshot.h1[0] }
				: null,
		].filter((item): item is { predicate: string; value: string } =>
			Boolean(item),
		);
		for (const candidate of factCandidates) {
			const existingFact = await db.query.brandFacts.findFirst({
				where: and(
					eq(schema.brandFacts.workspaceId, args.workspaceId),
					eq(schema.brandFacts.sourceUrl, result.url),
					eq(schema.brandFacts.predicate, candidate.predicate),
					eq(schema.brandFacts.value, candidate.value),
				),
			});
			if (!existingFact) {
				await db.insert(schema.brandFacts).values({
					workspaceId: args.workspaceId,
					subject: page.title || root.hostname,
					predicate: candidate.predicate,
					value: candidate.value,
					sourceUrl: result.url,
					sourceType: "official_website",
					evidenceGrade: "A",
					retrievedAt: new Date(),
					supportedClaims: [candidate.value],
					confidence: 80,
					status: "verified",
					verifiedAt: new Date(),
				});
			} else {
				await db
					.update(schema.brandFacts)
					.set({
						sourceType: existingFact.sourceType ?? "official_website",
						evidenceGrade: existingFact.evidenceGrade ?? "A",
						retrievedAt: new Date(),
						supportedClaims: existingFact.supportedClaims?.length
							? existingFact.supportedClaims
							: [candidate.value],
						updatedAt: new Date(),
					})
					.where(eq(schema.brandFacts.id, existingFact.id));
			}
		}
		rows.push({ url: result.url, status: result.status, title: page.title });
		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	return {
		robots: { url: robotsUrl, status: robotsResult.status },
		discoveredCount: discovered.size,
		crawledCount: rows.length,
		pages: rows,
	};
}

export async function listWorkspaceSitePages(workspaceId: string) {
	return db.query.sitePages.findMany({
		where: eq(schema.sitePages.workspaceId, workspaceId),
		orderBy: [desc(schema.sitePages.lastCrawledAt)],
	});
}

export async function listWorkspaceFacts(workspaceId: string) {
	return db.query.brandFacts.findMany({
		where: eq(schema.brandFacts.workspaceId, workspaceId),
		orderBy: [desc(schema.brandFacts.createdAt)],
	});
}
