ALTER TABLE simulation_runs
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

UPDATE simulation_runs
SET last_heartbeat_at = started_at
WHERE last_heartbeat_at IS NULL
  AND status IN ('starting', 'running');
