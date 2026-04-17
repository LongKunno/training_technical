package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"crypto_simulator/core_trading/internal/marketdata"
	"crypto_simulator/core_trading/internal/papertrading"
)

const queryTimeout = 5 * time.Second

type StateStore struct {
	db *sql.DB
}

func NewStateStore(db *sql.DB) *StateStore {
	return &StateStore{db: db}
}

func (s *StateStore) LoadState(accountID string) (papertrading.PersistentState, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return papertrading.PersistentState{}, false, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	state := papertrading.PersistentState{
		Account: papertrading.VirtualAccount{
			Positions: make(map[string]papertrading.Position),
		},
		MarketPrices: make(map[string]marketdata.PriceTickV1),
	}

	row := tx.QueryRowContext(ctx, `
		SELECT account_id, initial_balance, cash_balance, realized_pnl, fee_rate, slippage_rate
		FROM paper_accounts
		WHERE account_id = $1
	`, accountID)

	if err := row.Scan(
		&state.Account.ID,
		&state.InitialBalance,
		&state.Account.CashBalance,
		&state.RealizedPnL,
		&state.Rules.FeeRate,
		&state.Rules.SlippageRate,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return papertrading.PersistentState{}, false, nil
		}
		return papertrading.PersistentState{}, false, err
	}

	if err := loadOrders(ctx, tx, state.Account.ID, &state); err != nil {
		return papertrading.PersistentState{}, false, err
	}
	if err := loadPositions(ctx, tx, state.Account.ID, &state); err != nil {
		return papertrading.PersistentState{}, false, err
	}
	if err := loadMarketPrices(ctx, tx, &state); err != nil {
		return papertrading.PersistentState{}, false, err
	}
	if err := loadLatestSession(ctx, tx, state.Account.ID, &state); err != nil {
		return papertrading.PersistentState{}, false, err
	}

	if err := tx.Commit(); err != nil {
		return papertrading.PersistentState{}, false, err
	}

	return state, true, nil
}

func (s *StateStore) SaveState(state papertrading.PersistentState) error {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO paper_accounts (
			account_id,
			initial_balance,
			cash_balance,
			realized_pnl,
			fee_rate,
			slippage_rate,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (account_id) DO UPDATE SET
			initial_balance = EXCLUDED.initial_balance,
			cash_balance = EXCLUDED.cash_balance,
			realized_pnl = EXCLUDED.realized_pnl,
			fee_rate = EXCLUDED.fee_rate,
			slippage_rate = EXCLUDED.slippage_rate,
			updated_at = NOW()
	`,
		state.Account.ID,
		state.InitialBalance,
		state.Account.CashBalance,
		state.RealizedPnL,
		state.Rules.FeeRate,
		state.Rules.SlippageRate,
	); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM paper_orders WHERE account_id = $1`, state.Account.ID); err != nil {
		return err
	}
	for _, order := range state.Orders {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO paper_orders (
				id,
				account_id,
				symbol,
				side,
				quantity,
				price,
				requested_price,
				notional,
				fee,
				fee_rate,
				slippage_rate,
				status,
				executed_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (id) DO UPDATE SET
				account_id = EXCLUDED.account_id,
				symbol = EXCLUDED.symbol,
				side = EXCLUDED.side,
				quantity = EXCLUDED.quantity,
				price = EXCLUDED.price,
				requested_price = EXCLUDED.requested_price,
				notional = EXCLUDED.notional,
				fee = EXCLUDED.fee,
				fee_rate = EXCLUDED.fee_rate,
				slippage_rate = EXCLUDED.slippage_rate,
				status = EXCLUDED.status,
				executed_at = EXCLUDED.executed_at
		`,
			order.ID,
			order.AccountID,
			order.Symbol,
			string(order.Side),
			order.Quantity,
			order.Price,
			order.RequestedPrice,
			order.Notional,
			order.Fee,
			order.FeeRate,
			order.SlippageRate,
			order.Status,
			order.ExecutedAt,
		); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM paper_positions WHERE account_id = $1`, state.Account.ID); err != nil {
		return err
	}
	for _, position := range state.Account.Positions {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO paper_positions (
				account_id,
				symbol,
				quantity,
				average_price,
				updated_at
			)
			VALUES ($1, $2, $3, $4, NOW())
		`,
			state.Account.ID,
			position.Symbol,
			position.Quantity,
			position.AveragePrice,
		); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM market_prices`); err != nil {
		return err
	}
	for _, tick := range state.MarketPrices {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO market_prices (
				symbol,
				price,
				source,
				timestamp,
				updated_at
			)
			VALUES ($1, $2, $3, $4, NOW())
		`,
			tick.Symbol,
			tick.Price,
			tick.Source,
			tick.Timestamp,
		); err != nil {
			return err
		}
	}

	reportSnapshot, err := json.Marshal(state.Report)
	if err != nil {
		return err
	}
	processedSignals, err := json.Marshal(state.ProcessedSignals)
	if err != nil {
		return err
	}

	if state.Session.ID != "" {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO paper_sessions (
				session_id,
				account_id,
				status,
				started_at,
				stopped_at,
				reset_count,
				last_event_at,
				peak_equity,
				report_snapshot,
				processed_signal_ids,
				updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, NOW())
			ON CONFLICT (session_id) DO UPDATE SET
				account_id = EXCLUDED.account_id,
				status = EXCLUDED.status,
				started_at = EXCLUDED.started_at,
				stopped_at = EXCLUDED.stopped_at,
				reset_count = EXCLUDED.reset_count,
				last_event_at = EXCLUDED.last_event_at,
				peak_equity = EXCLUDED.peak_equity,
				report_snapshot = EXCLUDED.report_snapshot,
				processed_signal_ids = EXCLUDED.processed_signal_ids,
				updated_at = NOW()
		`,
			state.Session.ID,
			state.Account.ID,
			string(state.Session.Status),
			state.Session.StartedAt,
			state.Session.StoppedAt,
			state.Session.ResetCount,
			state.Session.LastEventAt,
			state.PeakEquity,
			string(reportSnapshot),
			string(processedSignals),
		); err != nil {
			return err
		}

		if _, err := tx.ExecContext(ctx, `DELETE FROM paper_audit_events WHERE session_id = $1`, state.Session.ID); err != nil {
			return err
		}
		for _, event := range state.AuditEvents {
			details, marshalErr := json.Marshal(event.Details)
			if marshalErr != nil {
				return marshalErr
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO paper_audit_events (
					id,
					session_id,
					account_id,
					event_type,
					message,
					symbol,
					event_timestamp,
					details,
					created_at
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
			`,
				event.ID,
				state.Session.ID,
				state.Account.ID,
				event.Type,
				event.Message,
				nullableString(event.Symbol),
				event.Timestamp,
				string(details),
			); err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func loadOrders(ctx context.Context, tx *sql.Tx, accountID string, state *papertrading.PersistentState) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			account_id,
			symbol,
			side,
			quantity,
			price,
			requested_price,
			notional,
			fee,
			fee_rate,
			slippage_rate,
			status,
			executed_at
		FROM paper_orders
		WHERE account_id = $1
		ORDER BY executed_at ASC, id ASC
	`, accountID)
	if err != nil {
		return err
	}
	defer func() {
		_ = rows.Close()
	}()

	for rows.Next() {
		var order papertrading.PaperOrder
		var side string
		if err := rows.Scan(
			&order.ID,
			&order.AccountID,
			&order.Symbol,
			&side,
			&order.Quantity,
			&order.Price,
			&order.RequestedPrice,
			&order.Notional,
			&order.Fee,
			&order.FeeRate,
			&order.SlippageRate,
			&order.Status,
			&order.ExecutedAt,
		); err != nil {
			return err
		}
		order.Side = papertrading.OrderSide(side)
		state.Orders = append(state.Orders, order)
	}

	return rows.Err()
}

func loadPositions(ctx context.Context, tx *sql.Tx, accountID string, state *papertrading.PersistentState) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT symbol, quantity, average_price
		FROM paper_positions
		WHERE account_id = $1
		ORDER BY symbol ASC
	`, accountID)
	if err != nil {
		return err
	}
	defer func() {
		_ = rows.Close()
	}()

	for rows.Next() {
		var position papertrading.Position
		if err := rows.Scan(&position.Symbol, &position.Quantity, &position.AveragePrice); err != nil {
			return err
		}
		state.Account.Positions[position.Symbol] = position
	}

	return rows.Err()
}

func loadMarketPrices(ctx context.Context, tx *sql.Tx, state *papertrading.PersistentState) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT symbol, price, source, timestamp
		FROM market_prices
		ORDER BY symbol ASC
	`)
	if err != nil {
		return err
	}
	defer func() {
		_ = rows.Close()
	}()

	for rows.Next() {
		var tick marketdata.PriceTickV1
		if err := rows.Scan(&tick.Symbol, &tick.Price, &tick.Source, &tick.Timestamp); err != nil {
			return err
		}
		state.MarketPrices[tick.Symbol] = tick
	}

	return rows.Err()
}

func loadLatestSession(ctx context.Context, tx *sql.Tx, accountID string, state *papertrading.PersistentState) error {
	row := tx.QueryRowContext(ctx, `
		SELECT
			session_id,
			status,
			started_at,
			stopped_at,
			reset_count,
			last_event_at,
			peak_equity,
			report_snapshot,
			processed_signal_ids
		FROM paper_sessions
		WHERE account_id = $1
		ORDER BY updated_at DESC, started_at DESC
		LIMIT 1
	`, accountID)

	var (
		statusRaw           string
		reportSnapshotRaw   []byte
		processedSignalsRaw []byte
	)
	if err := row.Scan(
		&state.Session.ID,
		&statusRaw,
		&state.Session.StartedAt,
		&state.Session.StoppedAt,
		&state.Session.ResetCount,
		&state.Session.LastEventAt,
		&state.PeakEquity,
		&reportSnapshotRaw,
		&processedSignalsRaw,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	state.Session.Status = papertrading.SessionStatus(statusRaw)

	if len(reportSnapshotRaw) > 0 {
		if err := json.Unmarshal(reportSnapshotRaw, &state.Report); err != nil {
			return err
		}
	}
	if len(processedSignalsRaw) > 0 {
		if err := json.Unmarshal(processedSignalsRaw, &state.ProcessedSignals); err != nil {
			return err
		}
	}

	return loadAuditEvents(ctx, tx, accountID, state)
}

func loadAuditEvents(ctx context.Context, tx *sql.Tx, accountID string, state *papertrading.PersistentState) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, session_id, event_type, message, COALESCE(symbol, ''), event_timestamp, details
		FROM paper_audit_events
		WHERE account_id = $1 AND session_id = $2
		ORDER BY event_timestamp ASC, id ASC
	`, accountID, state.Session.ID)
	if err != nil {
		return err
	}
	defer func() {
		_ = rows.Close()
	}()

	for rows.Next() {
		var (
			event      papertrading.AuditEvent
			detailsRaw []byte
		)
		if err := rows.Scan(
			&event.ID,
			&event.SessionID,
			&event.Type,
			&event.Message,
			&event.Symbol,
			&event.Timestamp,
			&detailsRaw,
		); err != nil {
			return err
		}
		if len(detailsRaw) > 0 {
			if err := json.Unmarshal(detailsRaw, &event.Details); err != nil {
				return err
			}
		}
		state.AuditEvents = append(state.AuditEvents, event)
	}

	return rows.Err()
}

func nullableString(value string) any {
	if value == "" {
		return nil
	}

	return value
}
