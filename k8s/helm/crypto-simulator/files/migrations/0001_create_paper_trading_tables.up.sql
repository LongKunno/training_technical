CREATE TABLE IF NOT EXISTS paper_accounts (
    account_id TEXT PRIMARY KEY,
    initial_balance DOUBLE PRECISION NOT NULL,
    cash_balance DOUBLE PRECISION NOT NULL,
    realized_pnl DOUBLE PRECISION NOT NULL,
    fee_rate DOUBLE PRECISION NOT NULL,
    slippage_rate DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_orders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES paper_accounts(account_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    requested_price DOUBLE PRECISION NOT NULL,
    notional DOUBLE PRECISION NOT NULL,
    fee DOUBLE PRECISION NOT NULL,
    fee_rate DOUBLE PRECISION NOT NULL,
    slippage_rate DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_positions (
    account_id TEXT NOT NULL REFERENCES paper_accounts(account_id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL,
    average_price DOUBLE PRECISION NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, symbol)
);

CREATE TABLE IF NOT EXISTS market_prices (
    symbol TEXT PRIMARY KEY,
    price DOUBLE PRECISION NOT NULL,
    source TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
