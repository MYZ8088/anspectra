CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.user_prompts (
    id String,
    user_id String,
    workspace_id String,
    prompt String,
    created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree()
PRIMARY KEY (workspace_id, prompt)
ORDER BY (workspace_id, prompt, created_at);

CREATE TABLE IF NOT EXISTS analytics.prompt_responses (
    id String,
    prompt_id String,
    prompt String,
    user_id String,
    workspace_id String,
    model String,
    model_provider LowCardinality(String),
    response String,
    sources Array(Tuple(
        title String,
        cited_text String,
        url String,
        domain Nullable(String),
        favicon Nullable(String)
    )),
    is_analysed Bool DEFAULT false,
    prompt_run_at DateTime,
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(prompt_run_at)
ORDER BY (workspace_id, prompt_run_at, model_provider, prompt_id);

CREATE TABLE IF NOT EXISTS analytics.prompt_analysis (
    id String,
    prompt_id String,
    workspace_id String,
    user_id String,
    model_provider LowCardinality(String),
    brand_analysis String DEFAULT '',
    prompt_run_at DateTime,
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(prompt_run_at)
ORDER BY (
    workspace_id,
    prompt_id,
    prompt_run_at,
    model_provider
);

-- Migration: Add prompt column if it doesn't exist (safe to run multiple times)
ALTER TABLE analytics.prompt_analysis ADD COLUMN IF NOT EXISTS prompt String DEFAULT '';

CREATE TABLE IF NOT EXISTS analytics.answer_samples_v2 (
    id String,
    legacy_response_id Nullable(String),
    run_id Nullable(String),
    checkpoint_id Nullable(String),
	    prompt_set_id Nullable(String),
	    series_id Nullable(String),
	    prompt_id String,
	    prompt String,
	    prompt_group LowCardinality(String) DEFAULT '',
	    prompt_hash String DEFAULT '',
	    prompt_origin LowCardinality(String) DEFAULT 'legacy',
	    decision_stage LowCardinality(String) DEFAULT '',
	    locale LowCardinality(String) DEFAULT '',
	    brand_exposure LowCardinality(String) DEFAULT '',
	    repeat_index UInt16 DEFAULT 0,
    user_id String,
    workspace_id String,
    model String,
    model_provider LowCardinality(String),
    response String,
    sources Array(Tuple(
        title String,
        cited_text String,
        url String,
        domain Nullable(String),
        favicon Nullable(String)
    )),
	    source_exposure LowCardinality(String) DEFAULT 'not_exposed',
	    reported_search_source_count Nullable(UInt16),
	    search_source_coverage LowCardinality(String) DEFAULT 'not_exposed',
	    requested_mode LowCardinality(String) DEFAULT 'default',
	    actual_mode LowCardinality(String) DEFAULT 'default',
    conversation_id Nullable(String),
    conversation_url Nullable(String),
    conversation_isolation LowCardinality(String) DEFAULT 'fresh',
    evidence_level LowCardinality(String) DEFAULT 'live_web',
    account_state LowCardinality(String) DEFAULT 'authenticated',
    region String DEFAULT '',
    network_fingerprint String DEFAULT '',
    status LowCardinality(String) DEFAULT 'completed',
    error_code Nullable(String),
    error_message Nullable(String),
    prompt_run_at DateTime,
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(prompt_run_at)
ORDER BY (workspace_id, prompt_run_at, model_provider, prompt_id, repeat_index);

CREATE TABLE IF NOT EXISTS analytics.sample_citations (
    id String,
    sample_id String,
    workspace_id String,
    model_provider LowCardinality(String),
    source_index UInt16,
    title String,
    cited_text String,
    url String,
    domain Nullable(String),
    source_kind LowCardinality(String) DEFAULT 'legacy_unknown',
    support_level LowCardinality(String) DEFAULT 'unreviewed',
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, sample_id, source_index);

CREATE TABLE IF NOT EXISTS analytics.sample_analysis_v2 (
    id String,
    sample_id String,
    prompt_id String,
    workspace_id String,
    user_id String,
    model_provider LowCardinality(String),
    analysis_json String,
    analysis_model String DEFAULT '',
    template_version String DEFAULT '',
	raw_output String DEFAULT '',
	status LowCardinality(String) DEFAULT 'completed',
	error String DEFAULT '',
	attempt_count UInt8 DEFAULT 1,
    prompt_run_at DateTime,
    created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(prompt_run_at)
ORDER BY (workspace_id, sample_id, model_provider);

ALTER TABLE analytics.sample_analysis_v2 ADD COLUMN IF NOT EXISTS raw_output String DEFAULT '';
ALTER TABLE analytics.sample_analysis_v2 ADD COLUMN IF NOT EXISTS status LowCardinality(String) DEFAULT 'completed';
ALTER TABLE analytics.sample_analysis_v2 ADD COLUMN IF NOT EXISTS error String DEFAULT '';
ALTER TABLE analytics.sample_analysis_v2 ADD COLUMN IF NOT EXISTS attempt_count UInt8 DEFAULT 1;
ALTER TABLE analytics.sample_citations ADD COLUMN IF NOT EXISTS source_kind LowCardinality(String) DEFAULT 'legacy_unknown';

ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS series_id Nullable(String);
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS prompt_hash String DEFAULT '';
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS prompt_origin LowCardinality(String) DEFAULT 'legacy';
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS decision_stage LowCardinality(String) DEFAULT '';
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS locale LowCardinality(String) DEFAULT '';
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS brand_exposure LowCardinality(String) DEFAULT '';
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS requested_mode LowCardinality(String) DEFAULT 'default';
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS actual_mode LowCardinality(String) DEFAULT 'default';
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS reported_search_source_count Nullable(UInt16);
ALTER TABLE analytics.answer_samples_v2 ADD COLUMN IF NOT EXISTS search_source_coverage LowCardinality(String) DEFAULT 'not_exposed';
