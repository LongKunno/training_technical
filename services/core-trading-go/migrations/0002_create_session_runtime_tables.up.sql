CREATE TABLE IF NOT EXISTS paper_sessions (
    session_id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES paper_accounts(account_id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    stopped_at TIMESTAMPTZ,
    reset_count INTEGER NOT NULL DEFAULT 0,
    last_event_at TIMESTAMPTZ NOT NULL,
    peak_equity DOUBLE PRECISION NOT NULL DEFAULT 0,
    report_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed_signal_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_sessions_account_updated
    ON paper_sessions(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS paper_audit_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES paper_sessions(session_id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES paper_accounts(account_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    symbol TEXT,
    event_timestamp TIMESTAMPTZ NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paper_audit_events_session_time
    ON paper_audit_events(session_id, event_timestamp ASC, id ASC);
