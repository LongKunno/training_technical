DROP INDEX IF EXISTS idx_paper_orders_account_session_executed;

ALTER TABLE paper_orders
    DROP CONSTRAINT IF EXISTS paper_orders_pkey;

DELETE FROM paper_orders
WHERE ctid IN (
    SELECT ctid
    FROM (
        SELECT
            ctid,
            ROW_NUMBER() OVER (
                PARTITION BY id
                ORDER BY executed_at DESC, session_id DESC
            ) AS row_number
        FROM paper_orders
    ) AS ranked
    WHERE row_number > 1
);

ALTER TABLE paper_orders
    ADD CONSTRAINT paper_orders_pkey PRIMARY KEY (id);

ALTER TABLE paper_orders
    DROP COLUMN IF EXISTS session_id;
