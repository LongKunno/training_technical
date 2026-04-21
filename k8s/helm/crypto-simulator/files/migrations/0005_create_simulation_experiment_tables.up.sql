CREATE TABLE IF NOT EXISTS simulation_experiments (
    experiment_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    planned_runs INTEGER NOT NULL DEFAULT 0,
    completed_runs INTEGER NOT NULL DEFAULT 0,
    failed_runs INTEGER NOT NULL DEFAULT 0,
    stopped_runs INTEGER NOT NULL DEFAULT 0,
    active_run_id TEXT,
    error_message TEXT,
    execution_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    slots_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    current_index INTEGER NOT NULL DEFAULT 0,
    stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE simulation_runs
    ADD COLUMN IF NOT EXISTS experiment_id TEXT,
    ADD COLUMN IF NOT EXISTS market_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE simulation_runs
    DROP CONSTRAINT IF EXISTS simulation_runs_experiment_id_fkey,
    ADD CONSTRAINT simulation_runs_experiment_id_fkey
        FOREIGN KEY (experiment_id)
        REFERENCES simulation_experiments(experiment_id)
        ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_simulation_runs_account_experiment_updated
    ON simulation_runs(account_id, experiment_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulation_experiments_account_updated
    ON simulation_experiments(account_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulation_experiments_account_status
    ON simulation_experiments(account_id, status, updated_at DESC);
