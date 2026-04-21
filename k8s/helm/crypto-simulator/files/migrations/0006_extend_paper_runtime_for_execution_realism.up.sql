ALTER TABLE paper_orders
    ADD COLUMN IF NOT EXISTS requested_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS requested_notional DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS fill_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remaining_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS terminal_reason TEXT NOT NULL DEFAULT '';

UPDATE paper_orders
SET
    requested_quantity = CASE
        WHEN requested_quantity = 0 THEN quantity
        ELSE requested_quantity
    END,
    requested_notional = CASE
        WHEN requested_notional = 0 AND notional > 0 THEN notional
        WHEN requested_notional = 0 THEN quantity * requested_price
        ELSE requested_notional
    END,
    fill_count = CASE
        WHEN fill_count = 0 AND quantity > 0 THEN 1
        ELSE fill_count
    END,
    remaining_quantity = 0
WHERE TRUE;

ALTER TABLE paper_sessions
    ADD COLUMN IF NOT EXISTS market_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS pending_execution_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;
