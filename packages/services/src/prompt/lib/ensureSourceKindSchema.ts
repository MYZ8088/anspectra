import { clickhouse } from "@anspectra/db";

let sourceKindSchemaPromise: Promise<void> | null = null;

export async function ensureSourceKindSchema(): Promise<void> {
	if (!sourceKindSchemaPromise) {
		sourceKindSchemaPromise = (async () => {
			await clickhouse.command({
				query:
					"ALTER TABLE analytics.sample_citations ADD COLUMN IF NOT EXISTS source_kind LowCardinality(String) DEFAULT 'legacy_unknown'",
			});
			await clickhouse.command({
				query:
					"ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS reported_search_source_count Nullable(UInt16)",
			});
			await clickhouse.command({
				query:
					"ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS search_source_coverage LowCardinality(String) DEFAULT 'not_exposed'",
			});
		})().catch((error) => {
			sourceKindSchemaPromise = null;
			throw error;
		});
	}
	return sourceKindSchemaPromise;
}
