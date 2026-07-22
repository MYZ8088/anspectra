import { BrandLogo } from "@/components/common/brand-logo";
import { SITE_URLS } from "@/lib/landing-content";
import { ProviderLogo } from "@anspectra/ui/provider-logo";
import {
	ArrowRight,
	Check,
	Code2,
	ExternalLink,
	Github,
	Globe2,
	Laptop,
	Link2,
	LockKeyhole,
	Radar,
	Repeat2,
	Search,
} from "lucide-react";

const providers = [
	{ key: "doubao", score: 66.8, delta: 4.7, completion: "36 / 36" },
	{ key: "deepseek", score: 73.4, delta: 6.1, completion: "36 / 36" },
	{ key: "hunyuan", score: 61.2, delta: 3.3, completion: "36 / 36" },
	{ key: "qwen", score: 69.5, delta: 5.4, completion: "36 / 36" },
] as const;

export type LandingLocale = "en" | "zh-CN";

const LANDING_COPY = {
	en: {
		nav: {
			product: "Product",
			method: "Method",
			docs: "Docs",
			github: "GitHub",
			language: "中文",
			languageLabel: "View the Chinese site",
			languageHref: "/zh-CN/",
		},
		hero: {
			kicker: "Official-Web GEO detection",
			lede: "Measure how a product appears in real answers from Doubao, DeepSeek, Yuanbao, and Qwen with fixed prompt suites and comparable browser samples.",
			github: "View on GitHub",
			docs: "Read the docs",
			facts: [
				"Fixed, versioned prompt packs",
				"Local persistent browser profiles",
				"Sample-level evidence and failures",
			],
		},
		report: {
			aria: "Anspectra two-cycle detection report preview",
			project: "Anspectra Two-Cycle Demo",
			title: "Quick Scan report",
			demo: "Demo data",
			geoScore: "GEO score",
			scoreDelta: "+5.7 from cycle 1",
			collected: "Collected",
			collectedDetail: "2 cycles · 4 providers",
			recommendation: "Recommendation",
			recommendationDelta: "+6.9 points",
			measuredChange: "Measured change",
			dateRange: "Jul 8 – Jul 15",
			trendAria: "Two-cycle GEO score trend",
			trendDetail: "Score increased from 62.1 to 67.8",
			cycle1: "Cycle 1",
			cycle2: "Cycle 2",
			providerScorecards: "Provider scorecards",
			providerCycle: "Cycle 2",
			providerLabels: {
				doubao: "Doubao",
				deepseek: "DeepSeek",
				hunyuan: "Yuanbao",
				qwen: "Qwen",
			},
		},
		measurement: {
			label: "Report anatomy",
			title: "A measurement system, not a mention counter.",
			description:
				"Reports keep the denominator visible and separate collection failure from analysis failure.",
			metrics: [
				["Visibility", "Mention, candidate, recommendation, and rank"],
				["Competition", "Target share and extracted competitor share"],
				["Evidence", "Search sources and answer links tracked separately"],
				["Stability", "Mode-matched changes across repeated cycles"],
			],
		},
		evidence: {
			label: "Evidence model",
			title: "Search sources are not the same as links in an answer.",
			descriptionBefore:
				"Anspectra preserves both evidence surfaces. If a provider does not expose extractable links, it records",
			descriptionAfter: "instead of claiming that no source exists.",
			tableLabel: "Evidence classification example",
			headers: ["Evidence surface", "Observed item", "Recorded as"],
			searchCard: "Provider search card",
			searchSource: "Search source",
			visibleLink: "Visible markdown link",
			answerLink: "Answer link",
		},
		method: {
			label: "How detection stays comparable",
			title: "From product profile to comparable series.",
			workflow: [
				{
					title: "Confirm the product profile",
					description:
						"Scan the official site, then confirm the brand, category, products, audience, region, and competitors.",
				},
				{
					title: "Freeze a detection set",
					description:
						"Choose a fixed prompt suite, language, providers, modes, and cadence. Review every rendered prompt before it runs.",
				},
				{
					title: "Collect official-Web answers",
					description:
						"Each prompt starts a fresh conversation in a persistent local browser profile. Samples and failures are checkpointed independently.",
				},
				{
					title: "Compare measured output",
					description:
						"Inspect visibility, rank, recommendation, competition, evidence, and stability by provider, intent, stage, and prompt.",
				},
			],
		},
		capabilities: {
			label: "Self-hosted control plane",
			title: "Real Web answers, local account state.",
			items: [
				{
					title: "Persistent collector",
					description:
						"One Camoufox profile per provider preserves the browser identity used for login and collection.",
				},
				{
					title: "Local credentials",
					description:
						"Cookies, local storage, and provider sessions stay on the user's computer and are never uploaded.",
				},
				{
					title: "Comparable cycles",
					description:
						"Prompt hashes, providers, modes, locale, and run plan remain attached to the same detection series.",
				},
				{
					title: "Provider scorecards",
					description:
						"Overall results and per-provider reports share the same planned sample denominator and evidence model.",
				},
			],
		},
		openSource: {
			label: "Open source",
			title: "Audit the route from prompt to report.",
			description:
				"Run the control plane, queues, browser collector, and analytics store in your own environment.",
		},
		footer: {
			description: "Official-Web GEO detection for measurable AI visibility.",
			docs: "Documentation",
			contact: "Contact",
		},
	},
	"zh-CN": {
		nav: {
			product: "产品",
			method: "方法",
			docs: "文档",
			github: "GitHub",
			language: "EN",
			languageLabel: "查看英文网站",
			languageHref: "/",
		},
		hero: {
			kicker: "基于官方 Web 的 GEO 检测",
			lede: "使用固定提示词套件和可比的浏览器样本，测量产品在豆包、DeepSeek、元宝和千问真实回答中的出现方式。",
			github: "在 GitHub 查看",
			docs: "阅读文档",
			facts: [
				"固定且版本化的提示词套件",
				"保存在本机的持久浏览器资料",
				"可追溯到单个样本的证据与失败记录",
			],
		},
		report: {
			aria: "Anspectra 两轮检测报告预览",
			project: "Anspectra 两轮演示",
			title: "快速扫描报告",
			demo: "演示数据",
			geoScore: "GEO 得分",
			scoreDelta: "较第 1 轮提升 5.7",
			collected: "已采集",
			collectedDetail: "2 轮 · 4 个平台",
			recommendation: "推荐率",
			recommendationDelta: "提升 6.9 个百分点",
			measuredChange: "测量变化",
			dateRange: "7 月 8 日至 7 月 15 日",
			trendAria: "两轮 GEO 得分趋势",
			trendDetail: "得分从 62.1 上升至 67.8",
			cycle1: "第 1 轮",
			cycle2: "第 2 轮",
			providerScorecards: "平台评分",
			providerCycle: "第 2 轮",
			providerLabels: {
				doubao: "豆包",
				deepseek: "DeepSeek",
				hunyuan: "元宝",
				qwen: "千问",
			},
		},
		measurement: {
			label: "报告结构",
			title: "一套测量系统，而不只是品牌提及计数。",
			description: "报告始终展示完整分母，并将采集失败与分析失败分开呈现。",
			metrics: [
				["可见性", "品牌出现、候选、推荐和绝对排名"],
				["竞争性", "目标品牌份额与回答中识别出的竞品份额"],
				["证据性", "分别记录搜索来源与回答正文链接"],
				["稳定性", "比较相同平台模式下的多轮变化"],
			],
		},
		evidence: {
			label: "证据模型",
			title: "平台搜索来源与回答正文链接不是同一种证据。",
			descriptionBefore:
				"Anspectra 会分别保留两类证据。如果平台没有展示可抽取链接，系统会记录",
			descriptionAfter: "，而不会据此断言回答没有来源。",
			tableLabel: "证据分类示例",
			headers: ["证据界面", "观察到的内容", "记录类型"],
			searchCard: "平台搜索卡片",
			searchSource: "搜索来源",
			visibleLink: "回答中的可见链接",
			answerLink: "回答链接",
		},
		method: {
			label: "如何保持检测可比",
			title: "从产品资料到可比较的检测序列。",
			workflow: [
				{
					title: "确认产品资料",
					description:
						"扫描官网后，由用户确认品牌、品类、产品、受众、地区和竞品。",
				},
				{
					title: "冻结检测集合",
					description:
						"选择固定提示词套件、语言、平台、模式和周期，并在执行前预览每条实际提示词。",
				},
				{
					title: "采集官方 Web 回答",
					description:
						"每条提示词都在持久本机浏览器资料中开启独立新对话，样本和失败分别保存 checkpoint。",
				},
				{
					title: "比较测量结果",
					description:
						"按平台、意图、阶段和提示词查看可见性、排名、推荐、竞争、证据与稳定性。",
				},
			],
		},
		capabilities: {
			label: "自托管控制面",
			title: "真实 Web 回答，账号状态留在本机。",
			items: [
				{
					title: "持久采集器",
					description:
						"每个平台使用一个 Camoufox profile，保留登录与采集所使用的浏览器身份。",
				},
				{
					title: "本机凭证",
					description:
						"Cookie、localStorage 和平台会话始终保存在用户电脑中，不上传到服务端。",
				},
				{
					title: "可比较的周期",
					description:
						"提示词哈希、平台、模式、语言和运行计划始终绑定在同一个检测序列中。",
				},
				{
					title: "平台独立评分",
					description: "总报告和各平台报告使用相同的计划样本分母与证据模型。",
				},
			],
		},
		openSource: {
			label: "开源",
			title: "审查从提示词到报告的完整路径。",
			description: "在自己的环境中运行控制面、队列、浏览器采集器和分析数据库。",
		},
		footer: {
			description: "基于官方 Web 的 GEO 检测，让 AI 可见性可以被测量。",
			docs: "文档",
			contact: "联系",
		},
	},
} as const;

type LandingCopy = (typeof LANDING_COPY)[LandingLocale];

function TrendChart(props: {
	report: LandingCopy["report"];
}): React.JSX.Element {
	return (
		<div className="report-chart" aria-label={props.report.trendAria}>
			<div className="report-chart-grid" aria-hidden="true" />
			<svg
				viewBox="0 0 560 180"
				role="img"
				aria-label={props.report.trendDetail}
				preserveAspectRatio="xMidYMid meet"
			>
				<polyline
					points="24,125 536,62"
					fill="none"
					stroke="#08a8d1"
					strokeWidth="4"
					vectorEffect="non-scaling-stroke"
				/>
				<circle
					cx="24"
					cy="125"
					r="6"
					fill="#ffffff"
					stroke="#08a8d1"
					strokeWidth="4"
				/>
				<circle
					cx="536"
					cy="62"
					r="6"
					fill="#ffffff"
					stroke="#08a8d1"
					strokeWidth="4"
				/>
			</svg>
			<div className="report-chart-label report-chart-label-start">
				<span>{props.report.cycle1}</span>
				<strong>62.1</strong>
			</div>
			<div className="report-chart-label report-chart-label-end">
				<span>{props.report.cycle2}</span>
				<strong>67.8</strong>
			</div>
		</div>
	);
}

function ReportPreview(props: { copy: LandingCopy }): React.JSX.Element {
	const report = props.copy.report;
	return (
		<div className="report-preview" aria-label={report.aria}>
			<div className="report-toolbar">
				<div>
					<p className="report-eyebrow">{report.project}</p>
					<h2>{report.title}</h2>
				</div>
				<span className="demo-label">{report.demo}</span>
			</div>

			<div className="report-summary">
				<div className="report-score">
					<span>{report.geoScore}</span>
					<strong>67.8</strong>
					<small>{report.scoreDelta}</small>
				</div>
				<div className="report-stat">
					<span>{report.collected}</span>
					<strong>144 / 144</strong>
					<small>{report.collectedDetail}</small>
				</div>
				<div className="report-stat">
					<span>{report.recommendation}</span>
					<strong>41.7%</strong>
					<small>{report.recommendationDelta}</small>
				</div>
			</div>

			<div className="report-main">
				<div className="report-trend">
					<div className="report-subhead">
						<h3>{report.measuredChange}</h3>
						<span>{report.dateRange}</span>
					</div>
					<TrendChart report={report} />
				</div>
				<div className="provider-list">
					<div className="report-subhead">
						<h3>{report.providerScorecards}</h3>
						<span>{report.providerCycle}</span>
					</div>
					{providers.map((provider) => (
						<div className="provider-row" key={provider.key}>
							<div className="provider-name">
								<ProviderLogo
									provider={provider.key}
									title={report.providerLabels[provider.key]}
								/>
								<div>
									<strong>{report.providerLabels[provider.key]}</strong>
									<span>{provider.completion}</span>
								</div>
							</div>
							<div className="provider-meter" aria-hidden="true">
								<span style={{ width: `${provider.score}%` }} />
							</div>
							<strong>{provider.score}</strong>
							<small>+{provider.delta}</small>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export function AnspectraLanding(props: {
	locale: LandingLocale;
}): React.JSX.Element {
	const copy = LANDING_COPY[props.locale];
	const capabilityIcons = [Laptop, LockKeyhole, Repeat2, Radar] as const;

	return (
		<main className="landing-page" lang={props.locale}>
			<header className="site-nav">
				<a className="brand-lockup" href="#top" aria-label="Anspectra home">
					<span className="brand-carrier">
						<BrandLogo className="h-9 w-9" />
					</span>
					<span>Anspectra</span>
				</a>
				<nav aria-label="Primary navigation">
					<a href="#product">{copy.nav.product}</a>
					<a href="#method">{copy.nav.method}</a>
					<a href={SITE_URLS.docs}>{copy.nav.docs}</a>
					<a
						className="nav-language"
						href={copy.nav.languageHref}
						hrefLang={props.locale === "en" ? "zh-CN" : "en"}
						aria-label={copy.nav.languageLabel}
					>
						<Globe2 aria-hidden="true" />
						{copy.nav.language}
					</a>
					{SITE_URLS.github ? (
						<a
							className="nav-command"
							href={SITE_URLS.github}
							target="_blank"
							rel="noreferrer"
						>
							<Github aria-hidden="true" />
							{copy.nav.github}
						</a>
					) : null}
				</nav>
			</header>

			<section className="hero-band" id="top">
				<div className="hero-copy">
					<p className="section-kicker">{copy.hero.kicker}</p>
					<h1>Anspectra</h1>
					<p className="hero-lede">{copy.hero.lede}</p>
					<div className="hero-actions">
						{SITE_URLS.github ? (
							<a
								className="button-primary"
								href={SITE_URLS.github}
								target="_blank"
								rel="noreferrer"
							>
								<Github aria-hidden="true" />
								{copy.hero.github}
							</a>
						) : null}
						<a className="button-secondary" href={SITE_URLS.docs}>
							{copy.hero.docs}
							<ArrowRight aria-hidden="true" />
						</a>
					</div>
					<ul className="hero-facts" aria-label="Key product facts">
						{copy.hero.facts.map((fact) => (
							<li key={fact}>
								<Check aria-hidden="true" /> {fact}
							</li>
						))}
					</ul>
				</div>
				<div className="hero-product" id="product">
					<ReportPreview copy={copy} />
				</div>
			</section>

			<section className="measurement-band" aria-labelledby="measurement-title">
				<div className="section-heading">
					<p className="section-kicker">{copy.measurement.label}</p>
					<h2 id="measurement-title">{copy.measurement.title}</h2>
					<p>{copy.measurement.description}</p>
				</div>
				<div className="metric-strip">
					{copy.measurement.metrics.map(([title, description]) => (
						<div key={title}>
							<strong>{title}</strong>
							<span>{description}</span>
						</div>
					))}
				</div>
			</section>

			<section className="source-band" aria-labelledby="source-title">
				<div className="source-copy">
					<p className="section-kicker">{copy.evidence.label}</p>
					<h2 id="source-title">{copy.evidence.title}</h2>
					<p>
						{copy.evidence.descriptionBefore} <code>not_exposed</code>
						{copy.evidence.descriptionAfter}
					</p>
				</div>
				<table className="evidence-table" aria-label={copy.evidence.tableLabel}>
					<thead>
						<tr className="evidence-row evidence-header">
							{copy.evidence.headers.map((header) => (
								<th scope="col" key={header}>
									{header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						<tr className="evidence-row">
							<td>
								<Search aria-hidden="true" /> {copy.evidence.searchCard}
							</td>
							<td>anspectra.pages.dev</td>
							<td>
								<strong>{copy.evidence.searchSource}</strong>
							</td>
						</tr>
						<tr className="evidence-row">
							<td>
								<Link2 aria-hidden="true" /> {copy.evidence.visibleLink}
							</td>
							<td>github.com/MYZ8088/anspectra</td>
							<td>
								<strong>{copy.evidence.answerLink}</strong>
							</td>
						</tr>
					</tbody>
				</table>
			</section>

			<section
				className="method-band"
				id="method"
				aria-labelledby="method-title"
			>
				<div className="section-heading">
					<p className="section-kicker">{copy.method.label}</p>
					<h2 id="method-title">{copy.method.title}</h2>
				</div>
				<ol className="workflow-list">
					{copy.method.workflow.map((item, index) => (
						<li key={item.title}>
							<span>{String(index + 1).padStart(2, "0")}</span>
							<div>
								<h3>{item.title}</h3>
								<p>{item.description}</p>
							</div>
						</li>
					))}
				</ol>
			</section>

			<section className="capability-band" aria-labelledby="capability-title">
				<div className="section-heading">
					<p className="section-kicker">{copy.capabilities.label}</p>
					<h2 id="capability-title">{copy.capabilities.title}</h2>
				</div>
				<div className="capability-grid">
					{copy.capabilities.items.map((item, index) => {
						const Icon = capabilityIcons[index] ?? Radar;
						return (
							<div key={item.title}>
								<Icon aria-hidden="true" />
								<h3>{item.title}</h3>
								<p>{item.description}</p>
							</div>
						);
					})}
				</div>
			</section>

			<section className="open-source-band">
				<div>
					<Code2 aria-hidden="true" />
					<p className="section-kicker">{copy.openSource.label}</p>
					<h2>{copy.openSource.title}</h2>
					<p>{copy.openSource.description}</p>
				</div>
				{SITE_URLS.github ? (
					<a
						className="button-light"
						href={SITE_URLS.github}
						target="_blank"
						rel="noreferrer"
					>
						<Github aria-hidden="true" />
						MYZ8088/anspectra
						<ExternalLink aria-hidden="true" />
					</a>
				) : null}
			</section>

			<footer className="site-footer">
				<div className="brand-lockup">
					<span className="brand-carrier">
						<BrandLogo className="h-9 w-9" />
					</span>
					<span>Anspectra</span>
				</div>
				<p>{copy.footer.description}</p>
				<div>
					<a href={SITE_URLS.docs}>{copy.footer.docs}</a>
					<a href="mailto:z1250835369@gmail.com">{copy.footer.contact}</a>
				</div>
			</footer>
		</main>
	);
}
