ALTER TABLE simulation_runs
    ADD COLUMN IF NOT EXISTS execution_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS metrics_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS stopped_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_simulation_runs_account_bot_updated
    ON simulation_runs(account_id, bot_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_account_scenario_updated
    ON simulation_runs(account_id, scenario_id, updated_at DESC);

INSERT INTO simulation_bots (
    bot_id,
    name,
    description,
    runtime,
    current_version,
    default_scenario
)
VALUES
    (
        'buy-and-hold',
        'Buy and Hold',
        'Benchmark bot that buys once on the first replay tick per symbol and holds into the final marked price.',
        'python',
        'v1',
        'trend-up'
    ),
    (
        'moving-average-cross',
        'Moving Average Cross',
        'Deterministic trend-following bot that reacts to replay prices using fast and slow moving averages.',
        'python',
        'v1',
        'range-chop'
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
VALUES
    (
        'buy-and-hold',
        'v1',
        'Buy and Hold v1',
        'Buys the first replay tick per symbol and leaves the position open until the scenario completes.',
        'buy_and_hold_v1',
        '{
          "trade_notional": {"type": "number", "minimum": 10},
          "tick_interval_ms": {"type": "integer", "minimum": 0}
        }'::jsonb,
        '{"trade_notional": 1000, "tick_interval_ms": 250}'::jsonb
    ),
    (
        'moving-average-cross',
        'v1',
        'Moving Average Cross v1',
        'Tracks fast and slow moving averages over replay ticks and trades on crossovers.',
        'moving_average_cross_v1',
        '{
          "trade_notional": {"type": "number", "minimum": 10},
          "tick_interval_ms": {"type": "integer", "minimum": 0},
          "fast_window": {"type": "integer", "minimum": 2},
          "slow_window": {"type": "integer", "minimum": 3}
        }'::jsonb,
        '{"trade_notional": 1000, "tick_interval_ms": 250, "fast_window": 2, "slow_window": 3}'::jsonb
    )
ON CONFLICT (bot_id, version) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    entrypoint = EXCLUDED.entrypoint,
    config_schema = EXCLUDED.config_schema,
    default_config = EXCLUDED.default_config,
    updated_at = NOW();
