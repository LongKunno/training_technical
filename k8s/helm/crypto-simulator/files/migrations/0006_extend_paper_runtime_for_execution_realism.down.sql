ALTER TABLE paper_sessions
    DROP COLUMN IF EXISTS pending_execution_snapshot,
    DROP COLUMN IF EXISTS market_profile_snapshot;

ALTER TABLE paper_orders
    DROP COLUMN IF EXISTS terminal_reason,
    DROP COLUMN IF EXISTS remaining_quantity,
    DROP COLUMN IF EXISTS fill_count,
    DROP COLUMN IF EXISTS requested_notional,
    DROP COLUMN IF EXISTS requested_quantity;
