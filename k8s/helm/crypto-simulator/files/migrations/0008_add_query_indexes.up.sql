CREATE INDEX IF NOT EXISTS idx_paper_sessions_account_status_updated
    ON paper_sessions(account_id, status, updated_at DESC, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_simulation_runs_active_by_account
    ON simulation_runs(account_id, updated_at DESC, started_at DESC)
    WHERE status IN ('starting', 'running');

CREATE INDEX IF NOT EXISTS idx_simulation_runs_leaderboard_completed
    ON simulation_runs(
        account_id,
        ((metrics_snapshot->>'total_pnl')::double precision) DESC,
        ((metrics_snapshot->>'max_drawdown')::double precision) ASC,
        updated_at DESC
    )
    WHERE status = 'completed'
      AND metrics_snapshot IS NOT NULL
      AND experiment_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_simulation_experiments_queued_by_account
    ON simulation_experiments(account_id, created_at ASC, experiment_id ASC)
    WHERE status = 'queued';
