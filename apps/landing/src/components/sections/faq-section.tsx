import { Card } from "@anspectra/ui";

type FaqItem = {
	question: string;
	answer: string;
};

const FAQ_ITEMS: FaqItem[] = [
	{
		question: "What is Anspectra?",
		answer:
			"Anspectra is an open-source GEO detection platform. It measures how a product appears in Doubao, DeepSeek, Yuanbao, and Qwen and reports visibility, rank, sentiment, recommendation strength, source exposure, and stability.",
	},
	{
		question: "What is GEO (Generative Engine Optimization)?",
		answer:
			"GEO stands for Generative Engine Optimization. Anspectra focuses on its measurement layer: whether your product appears in AI-generated responses, where it ranks, how it is framed, which competitors appear, and whether it is recommended.",
	},
	{
		question: "How is Anspectra different from API-based AI trackers?",
		answer:
			"Anspectra opens the official provider interfaces the same way a signed-in user does. Web answers can include wording, ordering, modes, and visible sources that differ from API output, so API responses are never substituted for monitoring samples.",
	},
	{
		question: "Which AI providers does Anspectra support?",
		answer:
			"Formal detection supports Doubao, DeepSeek, Yuanbao, and Qwen. Each provider uses a dedicated persistent local browser profile and your own authenticated account.",
	},
	{
		question: "Is Anspectra free?",
		answer:
			"Yes. Anspectra is Apache-2.0 licensed and free to run locally. You configure an OpenAI-compatible endpoint for answer analysis and use your own provider accounts for official Web collection.",
	},
	{
		question: "Does Anspectra store my data in the cloud?",
		answer:
			"Provider cookies and browser profiles remain on the collector machine. Detection metadata is stored in PostgreSQL and captured answers in ClickHouse. Only captured answer text and configured evidence are sent to the selected analysis model.",
	},
	{
		question: "What is a GEO score?",
		answer:
			"Anspectra does not hide results behind one composite score. Reports show completion, mention, candidate, recommendation, rank, sentiment, source exposure, competition, factuality, and stability with their sample denominators.",
	},
	{
		question: "How do I get started with Anspectra?",
		answer:
			"Clone the repository, configure .env, run pnpm camoufox:setup, then run pnpm local. Connect the providers, confirm a product profile, select a preset detection suite, and click Run detection.",
	},
];

const jsonLd = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: FAQ_ITEMS.map(({ question, answer }) => ({
		"@type": "Question",
		name: question,
		acceptedAnswer: {
			"@type": "Answer",
			text: answer,
		},
	})),
};

export function FaqSection(): React.JSX.Element {
	return (
		<section
			className="section-shell py-12 sm:py-14"
			id="faq"
			aria-labelledby="faq-title"
		>
			<script
				type="application/ld+json"
				// biome-ignore lint/security/noDangerouslySetInnerHtml: structured data for search engines
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
			<Card className="landing-surface p-6">
				<h2
					id="faq-title"
					className="text-2xl font-semibold tracking-tight sm:text-3xl"
				>
					Frequently asked questions
				</h2>
				<p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
					Common questions about Anspectra, GEO, and AI visibility tracking.
				</p>
				<dl className="mt-8 grid gap-6 sm:grid-cols-2">
					{FAQ_ITEMS.map(({ question, answer }) => (
						<div key={question} className="landing-muted-card px-4 py-4">
							<dt className="text-sm font-semibold leading-6">{question}</dt>
							<dd className="mt-2 text-sm leading-6 text-muted-foreground">
								{answer}
							</dd>
						</div>
					))}
				</dl>
			</Card>
		</section>
	);
}
