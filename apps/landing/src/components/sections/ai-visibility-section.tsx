import { AiVisibilityPreview } from "@/components/previews/ai-visibility-preview";
import { SectionHeading } from "@anspectra/ui";

export function AiVisibilitySection(): React.JSX.Element {
	return (
		<section
			className="section-shell py-12 sm:py-14"
			id="competitor-comparison"
			aria-labelledby="competitor-comparison-title"
		>
			<SectionHeading
				eyebrow="Competitor Comparison"
				title="See how your brand performs across AI answers"
				description="Compare observed mentions, recommendations, rank, and sentiment across the four supported official Web providers."
			/>
			<AiVisibilityPreview />
		</section>
	);
}
