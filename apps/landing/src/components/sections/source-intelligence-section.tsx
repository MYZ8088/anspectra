import { SourceIntelligencePreview } from "@/components/previews/source-intelligence-preview";
import { SectionHeading } from "@anspectra/ui";

export function SourceIntelligenceSection(): React.JSX.Element {
	return (
		<section
			className="section-shell py-12 sm:py-14"
			id="source-intelligence"
			aria-labelledby="source-intelligence-title"
		>
			<SectionHeading
				eyebrow="Sources & Citations"
				title="Know which sources shape AI decisions."
				description="Find the publishers visible in answers from Doubao, DeepSeek, Yuanbao, and Qwen."
			/>
			<SourceIntelligencePreview />
		</section>
	);
}
