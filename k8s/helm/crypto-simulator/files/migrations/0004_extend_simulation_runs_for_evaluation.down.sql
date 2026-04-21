DROP INDEX IF EXISTS idx_simulation_runs_account_scenario_updated;
DROP INDEX IF EXISTS idx_simulation_runs_account_bot_updated;

DELETE FROM simulation_bot_versions
WHERE (bot_id = 'buy-and-hold' AND version = 'v1')
   OR (bot_id = 'moving-average-cross' AND version = 'v1');

DELETE FROM simulation_bots
WHERE bot_id IN ('buy-and-hold', 'moving-average-cross');

ALTER TABLE simulation_runs
    DROP COLUMN IF EXISTS stopped_reason,
    DROP COLUMN IF EXISTS metrics_snapshot,
    DROP COLUMN IF EXISTS execution_profile_snapshot;
