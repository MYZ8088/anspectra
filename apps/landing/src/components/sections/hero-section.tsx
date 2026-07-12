import { DashboardBrowserPreview } from "@/components/previews/dashboard-browser-preview";

export function HeroSection(): React.JSX.Element {
	return (
		<section className="section-shell pb-12 pt-8 sm:pb-18 sm:pt-14">
			<div className="mx-auto grid max-w-6xl items-center gap-8 px-6 py-8 sm:px-8 sm:py-10 xl:grid-cols-[1.05fr_1fr] xl:gap-12 xl:px-10">
				<div className="ui-stagger">
					<h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
						Aloom GEO Detection
					</h1>
					<p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
						Measure how products appear across Doubao, DeepSeek, Yuanbao, and
						Qwen using fixed detection packs and your own authenticated
						accounts.
					</p>
				</div>

				<div className="ui-page-enter">
					<DashboardBrowserPreview />
				</div>
			</div>
		</section>
	);
}
