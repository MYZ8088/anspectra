import { BrandLogo } from "@/components/common/brand-logo";
import { SITE_URLS } from "@/lib/landing-content";
import { ArrowLeft, Github } from "lucide-react";

const setup = `git clone https://github.com/MYZ8088/anspectra.git
cd anspectra
cp .env.example .env
pnpm install
pnpm camoufox:setup
pnpm camoufox:doctor
pnpm local:background`;

export default function DocsPage(): React.JSX.Element {
	return (
		<main className="docs-page">
			<header className="site-nav">
				<a className="brand-lockup" href="/">
					<span className="brand-carrier">
						<BrandLogo className="h-9 w-9" />
					</span>
					<span>Anspectra</span>
				</a>
				<nav>
					<a href="/">
						<ArrowLeft aria-hidden="true" /> Product
					</a>
					{SITE_URLS.github ? (
						<a className="nav-command" href={SITE_URLS.github}>
							<Github aria-hidden="true" /> GitHub
						</a>
					) : null}
				</nav>
			</header>
			<article className="docs-content">
				<p className="section-kicker">Self-hosting guide</p>
				<h1>Run Anspectra locally.</h1>
				<p className="docs-intro">
					The control plane uses Next.js, PostgreSQL, ClickHouse, Redis, and
					BullMQ. Official-Web samples are collected by a local Camoufox runner
					with persistent provider profiles.
				</p>

				<section>
					<h2>Requirements</h2>
					<ul>
						<li>macOS or Windows</li>
						<li>Node.js 20 or newer and pnpm 10</li>
						<li>Docker Desktop</li>
						<li>Python 3.12 for the pinned Camoufox runtime</li>
					</ul>
				</section>

				<section>
					<h2>Install</h2>
					<pre>
						<code>{setup}</code>
					</pre>
					<p>
						Open <code>http://localhost:3000</code>, create a workspace, and
						connect the providers you want to measure.
					</p>
				</section>

				<section>
					<h2>Model configuration</h2>
					<p>
						Structured analysis accepts an OpenAI-compatible endpoint. Configure
						it at the deployment level:
					</p>
					<pre>
						<code>{`LLM_BASE_URL=https://your-endpoint.example/v1
LLM_API_KEY=your-key
LLM_MODEL=your-model-name`}</code>
					</pre>
					<p>
						The configured model analyses captured answers. It is never used as
						a substitute for official-Web samples.
					</p>
				</section>

				<section>
					<h2>Provider sessions</h2>
					<p>
						Connect Providers opens a visible browser for login. Formal
						collection uses the same persistent profile, creates a fresh
						conversation for every prompt, and stores cookies only on the
						collector machine.
					</p>
				</section>
			</article>
		</main>
	);
}
