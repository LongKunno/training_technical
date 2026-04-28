ALTER TABLE paper_orders
    ADD COLUMN IF NOT EXISTS session_id TEXT NOT NULL DEFAULT '';

UPDATE paper_orders AS po
SET session_id = latest.session_id
FROM (
    SELECT DISTINCT ON (account_id)
        account_id,
        session_id
    FROM paper_sessions
    ORDER BY account_id, updated_at DESC, started_at DESC
) AS latest
WHERE po.account_id = latest.account_id
  AND po.session_id = '';

ALTER TABLE paper_orders
    DROP CONSTRAINT IF EXISTS paper_orders_pkey;

ALTER TABLE paper_orders
    ADD CONSTRAINT paper_orders_pkey PRIMARY KEY (session_id, id);

CREATE INDEX IF NOT EXISTS idx_paper_orders_account_session_executed
    ON paper_orders(account_id, session_id, executed_at DESC, id DESC);
