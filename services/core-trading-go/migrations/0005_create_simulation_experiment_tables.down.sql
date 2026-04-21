DROP INDEX IF EXISTS idx_simulation_experiments_account_status;
DROP INDEX IF EXISTS idx_simulation_experiments_account_updated;
DROP INDEX IF EXISTS idx_simulation_runs_account_experiment_updated;

ALTER TABLE simulation_runs
    DROP CONSTRAINT IF EXISTS simulation_runs_experiment_id_fkey;

ALTER TABLE simulation_runs
    DROP COLUMN IF EXISTS market_profile_snapshot,
    DROP COLUMN IF EXISTS experiment_id;

DROP TABLE IF EXISTS simulation_experiments;
