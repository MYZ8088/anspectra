import { BrandLogo } from "@/components/common/brand-logo";
import { SITE_URLS } from "@/lib/landing-content";
import {
	ArrowRight,
	Check,
	Code2,
	ExternalLink,
	Github,
	Laptop,
	Link2,
	LockKeyhole,
	Radar,
	Repeat2,
	Search,
} from "lucide-react";

const providers = [
	{ name: "Doubao", score: 66.8, delta: 4.7, completion: "36 / 36" },
	{ name: "DeepSeek", score: 73.4, delta: 6.1, completion: "36 / 36" },
	{ name: "Yuanbao", score: 61.2, delta: 3.3, completion: "36 / 36" },
	{ name: "Qwen", score: 69.5, delta: 5.4, completion: "36 / 36" },
] as const;

const workflow = [
	{
		number: "01",
		title: "Confirm the product profile",
		description:
			"Scan the official site, then confirm the brand, category, products, audience, region, and competitors.",
	},
	{
		number: "02",
		title: "Freeze a detection set",
		description:
			"Choose a fixed prompt suite, language, providers, modes, and cadence. Review every rendered prompt before it runs.",
	},
	{
		number: "03",
		title: "Collect official-Web answers",
		description:
			"Each prompt starts a fresh conversation in a persistent local browser profile. Samples and failures are checkpointed independently.",
	},
	{
		number: "04",
		title: "Compare measured output",
		description:
			"Inspect visibility, rank, recommendation, competition, evidence, and stability by provider, intent, stage, and prompt.",
	},
] as const;

function TrendChart(): React.JSX.Element {
	return (
		<div className="report-chart" aria-label="Two-cycle GEO score trend">
			<div className="report-chart-grid" aria-hidden="true" />
			<svg
				viewBox="0 0 560 180"
				role="img"
				aria-label="Score increased from 62.1 to 67.8"
				preserveAspectRatio="none"
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
				<span>Cycle 1</span>
				<strong>62.1</strong>
			</div>
			<div className="report-chart-label report-chart-label-end">
				<span>Cycle 2</span>
				<strong>67.8</strong>
			</div>
		</div>
	);
}

function ReportPreview(): React.JSX.Element {
	return (
		<div
			className="report-preview"
			aria-label="Anspectra two-cycle detection report preview"
		>
			<div className="report-toolbar">
				<div>
					<p className="report-eyebrow">Anspectra Two-Cycle Demo</p>
					<h2>Quick Scan report</h2>
				</div>
				<span className="demo-label">Demo data</span>
			</div>

			<div className="report-summary">
				<div className="report-score">
					<span>GEO score</span>
					<strong>67.8</strong>
					<small>+5.7 from cycle 1</small>
				</div>
				<div className="report-stat">
					<span>Collected</span>
					<strong>144 / 144</strong>
					<small>2 cycles · 4 providers</small>
				</div>
				<div className="report-stat">
					<span>Recommendation</span>
					<strong>41.7%</strong>
					<small>+6.9 points</small>
				</div>
			</div>

			<div className="report-main">
				<div className="report-trend">
					<div className="report-subhead">
						<h3>Measured change</h3>
						<span>Jul 8 – Jul 15</span>
					</div>
					<TrendChart />
				</div>
				<div className="provider-list">
					<div className="report-subhead">
						<h3>Provider scorecards</h3>
						<span>Cycle 2</span>
					</div>
					{providers.map((provider) => (
						<div className="provider-row" key={provider.name}>
							<div>
								<strong>{provider.name}</strong>
								<span>{provider.completion}</span>
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

export default function LandingPage(): React.JSX.Element {
	return (
		<main className="landing-page">
			<header className="site-nav">
				<a className="brand-lockup" href="#top" aria-label="Anspectra home">
					<span className="brand-carrier">
						<BrandLogo className="h-9 w-9" />
					</span>
					<span>Anspectra</span>
				</a>
				<nav aria-label="Primary navigation">
					<a href="#product">Product</a>
					<a href="#method">Method</a>
					<a href={SITE_URLS.docs}>Docs</a>
					{SITE_URLS.github ? (
						<a
							className="nav-command"
							href={SITE_URLS.github}
							target="_blank"
							rel="noreferrer"
						>
							<Github aria-hidden="true" />
							GitHub
						</a>
					) : null}
				</nav>
			</header>

			<section className="hero-band" id="top">
				<div className="hero-copy">
					<p className="section-kicker">Official-Web GEO detection</p>
					<h1>Anspectra</h1>
					<p className="hero-lede">
						Measure how a product appears in real answers from Doubao, DeepSeek,
						Yuanbao, and Qwen with fixed prompt suites and comparable browser
						samples.
					</p>
					<div className="hero-actions">
						{SITE_URLS.github ? (
							<a
								className="button-primary"
								href={SITE_URLS.github}
								target="_blank"
								rel="noreferrer"
							>
								<Github aria-hidden="true" />
								View on GitHub
							</a>
						) : null}
						<a className="button-secondary" href={SITE_URLS.docs}>
							Read the docs
							<ArrowRight aria-hidden="true" />
						</a>
					</div>
					<ul className="hero-facts" aria-label="Key product facts">
						<li>
							<Check aria-hidden="true" /> Fixed, versioned prompt packs
						</li>
						<li>
							<Check aria-hidden="true" /> Local persistent browser profiles
						</li>
						<li>
							<Check aria-hidden="true" /> Sample-level evidence and failures
						</li>
					</ul>
				</div>
				<div className="hero-product" id="product">
					<ReportPreview />
				</div>
			</section>

			<section className="measurement-band" aria-labelledby="measurement-title">
				<div className="section-heading">
					<p className="section-kicker">One report, several views</p>
					<h2 id="measurement-title">
						A measurement system, not a mention counter.
					</h2>
					<p>
						Reports keep the denominator visible and separate collection failure
						from analysis failure.
					</p>
				</div>
				<div className="metric-strip">
					<div>
						<strong>Visibility</strong>
						<span>Mention, candidate, recommendation, and rank</span>
					</div>
					<div>
						<strong>Competition</strong>
						<span>Target share and extracted competitor share</span>
					</div>
					<div>
						<strong>Evidence</strong>
						<span>Search sources and answer links tracked separately</span>
					</div>
					<div>
						<strong>Stability</strong>
						<span>Mode-matched changes across repeated cycles</span>
					</div>
				</div>
			</section>

			<section className="source-band" aria-labelledby="source-title">
				<div className="source-copy">
					<p className="section-kicker">Evidence without guesswork</p>
					<h2 id="source-title">
						Search sources are not the same as links in an answer.
					</h2>
					<p>
						Anspectra preserves both evidence surfaces. If a provider does not
						expose extractable links, it records <code>not_exposed</code>{" "}
						instead of claiming that no source exists.
					</p>
				</div>
				<table
					className="evidence-table"
					aria-label="Evidence classification example"
				>
					<thead>
						<tr className="evidence-row evidence-header">
							<th scope="col">Evidence surface</th>
							<th scope="col">Observed item</th>
							<th scope="col">Recorded as</th>
						</tr>
					</thead>
					<tbody>
						<tr className="evidence-row">
							<td>
								<Search aria-hidden="true" /> Provider search card
							</td>
							<td>anspectra.pages.dev</td>
							<td>
								<strong>Search source</strong>
							</td>
						</tr>
						<tr className="evidence-row">
							<td>
								<Link2 aria-hidden="true" /> Visible markdown link
							</td>
							<td>github.com/MYZ8088/anspectra</td>
							<td>
								<strong>Answer link</strong>
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
					<p className="section-kicker">Repeatable by construction</p>
					<h2 id="method-title">From product profile to comparable series.</h2>
				</div>
				<ol className="workflow-list">
					{workflow.map((item) => (
						<li key={item.number}>
							<span>{item.number}</span>
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
					<p className="section-kicker">Self-hosted control plane</p>
					<h2 id="capability-title">Real Web answers, local account state.</h2>
				</div>
				<div className="capability-grid">
					<div>
						<Laptop aria-hidden="true" />
						<h3>Persistent collector</h3>
						<p>
							One Camoufox profile per provider preserves the browser identity
							used for login and collection.
						</p>
					</div>
					<div>
						<LockKeyhole aria-hidden="true" />
						<h3>Local credentials</h3>
						<p>
							Cookies, local storage, and provider sessions stay on the user's
							computer and are never uploaded.
						</p>
					</div>
					<div>
						<Repeat2 aria-hidden="true" />
						<h3>Comparable cycles</h3>
						<p>
							Prompt hashes, providers, modes, locale, and run plan remain
							attached to the same detection series.
						</p>
					</div>
					<div>
						<Radar aria-hidden="true" />
						<h3>Provider scorecards</h3>
						<p>
							Overall results and per-provider reports share the same planned
							sample denominator and evidence model.
						</p>
					</div>
				</div>
			</section>

			<section className="open-source-band">
				<div>
					<Code2 aria-hidden="true" />
					<p className="section-kicker">Open source</p>
					<h2>Audit the route from prompt to report.</h2>
					<p>
						Run the control plane, queues, browser collector, and analytics
						store in your own environment.
					</p>
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
				<p>Official-Web GEO detection for measurable AI visibility.</p>
				<div>
					<a href={SITE_URLS.docs}>Documentation</a>
					<a href="mailto:z1250835369@gmail.com">Contact</a>
				</div>
			</footer>
		</main>
	);
}
