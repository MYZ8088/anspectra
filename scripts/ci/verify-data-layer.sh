#!/usr/bin/env bash

set -euo pipefail

fail() {
	printf '::error::%s\n' "$1" >&2
	exit 1
}

postgres_query() {
	docker compose exec -T db psql \
		-U "${POSTGRES_USER:-postgres}" \
		-d "${POSTGRES_DB:-anspectra}" \
		-Atqc "$1"
}

clickhouse_query() {
	docker compose exec -T clickhouse clickhouse-client \
		--user "${CLICKHOUSE_USER:-default}" \
		--password "${CLICKHOUSE_PASSWORD:-clickhouse}" \
		--query "$1"
}

expected_migrations="$({
	node -e "const journal=require('./packages/db/drizzle/meta/_journal.json'); process.stdout.write(String(journal.entries.length));"
})"
actual_migrations="$(postgres_query 'SELECT COUNT(DISTINCT hash) FROM drizzle.__drizzle_migrations;')"

if [[ "$actual_migrations" != "$expected_migrations" ]]; then
	fail "Expected ${expected_migrations} distinct Drizzle migrations, found ${actual_migrations}."
fi

extensions="$(postgres_query "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension WHERE extname IN ('http', 'pg_cron', 'pgcrypto');")"
if [[ "$extensions" != "http,pg_cron,pgcrypto" ]]; then
	fail "Required PostgreSQL extensions are incomplete: ${extensions:-none}."
fi

required_postgres_tables=(
	brand_profiles
	collection_runs
	collection_series
	detection_schedules
	prompt_templates
	sample_checkpoints
)

for table in "${required_postgres_tables[@]}"; do
	table_count="$(postgres_query "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = '${table}';")"
	if [[ "$table_count" != "1" ]]; then
		fail "Required PostgreSQL table is missing: ${table}."
	fi
done

required_clickhouse_tables=(
	answer_samples_v2
	prompt_analysis
	prompt_responses
	sample_analysis_v2
	sample_citations
	user_prompts
)

for table in "${required_clickhouse_tables[@]}"; do
	table_count="$(clickhouse_query "SELECT COUNT() FROM system.tables WHERE database = 'analytics' AND name = '${table}'")"
	if [[ "$table_count" != "1" ]]; then
		fail "Required ClickHouse table is missing: analytics.${table}."
	fi
done

redis_status="$(docker compose exec -T redis redis-cli \
	-a "${REDIS_PASSWORD:-redis}" \
	--no-auth-warning ping)"
if [[ "$redis_status" != "PONG" ]]; then
	fail "Redis health check returned: ${redis_status:-no response}."
fi

printf 'Data layer verified: %s migrations, %s PostgreSQL extensions, %s PostgreSQL core tables, %s ClickHouse tables, Redis %s.\n' \
	"$actual_migrations" \
	"3" \
	"${#required_postgres_tables[@]}" \
	"${#required_clickhouse_tables[@]}" \
	"$redis_status"
