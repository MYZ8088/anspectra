import { BrandLogo } from "@/components/common/brand-logo";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { SITE_URLS } from "@/lib/landing-content";
import { Button } from "@anspectra/ui";
import { Github, Server } from "lucide-react";

export function SiteHeader(): React.JSX.Element {
	return (
		<header className="section-shell sticky top-0 z-40 pt-4 sm:pt-5">
			<div className="landing-surface flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
				<a
					href={SITE_URLS.homepage}
					className="inline-flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg"
					target="_blank"
					rel="noreferrer noopener"
				>
					<BrandLogo className="h-6 w-6" />
					Anspectra
				</a>

				<div className="flex shrink-0 items-center gap-2">
					{SITE_URLS.github ? (
						<Button asChild variant="outline">
							<a
								href={SITE_URLS.github}
								target="_blank"
								rel="noreferrer noopener"
							>
								<Github className="h-4 w-4" aria-hidden="true" />
								<span className="hidden sm:inline">GitHub</span>
							</a>
						</Button>
					) : null}
					<Button asChild variant="outline" className="hidden md:inline-flex">
						<a href={SITE_URLS.docs} target="_blank" rel="noreferrer noopener">
							<Server className="h-4 w-4" aria-hidden="true" />
							Self Host
						</a>
					</Button>
					<ThemeToggle />
				</div>
			</div>
		</header>
	);
}
