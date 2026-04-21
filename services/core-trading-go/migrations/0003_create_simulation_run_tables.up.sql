CREATE TABLE IF NOT EXISTS simulation_bots (
    bot_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    runtime TEXT NOT NULL DEFAULT 'python',
    current_version TEXT NOT NULL,
    default_scenario TEXT NOT NULL DEFAULT 'baseline',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulation_bot_versions (
    bot_id TEXT NOT NULL REFERENCES simulation_bots(bot_id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    entrypoint TEXT NOT NULL DEFAULT '',
    config_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    default_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (bot_id, version)
);

CREATE TABLE IF NOT EXISTS simulation_runs (
    run_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES simulation_bots(bot_id) ON DELETE RESTRICT,
    bot_version TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES paper_sessions(session_id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    error_message TEXT,
    config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_account_updated
    ON simulation_runs(account_id, updated_at DESC, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_account_status
    ON simulation_runs(account_id, status, updated_at DESC);

INSERT INTO simulation_bots (
    bot_id,
    name,
    description,
    runtime,
    current_version,
    default_scenario
)
VALUES (
    'baseline-roundtrip',
    'Baseline Roundtrip',
    'Reference bot that opens a paper position on the first replay tick per symbol and closes it on the final tick so scenarios produce measurable realized PnL.',
    'python',
    'v1',
    'baseline'
)
ON CONFLICT (bot_id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    runtime = EXCLUDED.runtime,
    current_version = EXCLUDED.current_version,
    default_scenario = EXCLUDED.default_scenario,
    updated_at = NOW();

INSERT INTO simulation_bot_versions (
    bot_id,
    version,
    title,
    description,
    entrypoint,
    config_schema,
    default_config
)
VALUES (
    'baseline-roundtrip',
    'v1',
    'Baseline Roundtrip v1',
    'Uses scenario replay ticks as a deterministic benchmark bot. Buy on first tick, sell on final tick, and keep pacing configurable for UI demos.',
    'baseline_roundtrip_v1',
    '{
      "trade_notional": {"type": "number", "minimum": 10},
      "tick_interval_ms": {"type": "integer", "minimum": 0}
    }'::jsonb,
    '{"trade_notional": 1000, "tick_interval_ms": 250}'::jsonb
)
ON CONFLICT (bot_id, version) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    entrypoint = EXCLUDED.entrypoint,
    config_schema = EXCLUDED.config_schema,
    default_config = EXCLUDED.default_config,
    updated_at = NOW();
