package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
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

func (s *StateStore) ListSessions(accountID string, filter papertrading.SessionHistoryFilter) ([]papertrading.SessionHistoryEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	if filter.Limit <= 0 {
		filter.Limit = 20
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}
	statusFilter := strings.TrimSpace(string(filter.Status))
	queryFilter := strings.TrimSpace(filter.Query)

	rows, err := s.db.QueryContext(ctx, `
		SELECT session_id, status, started_at, stopped_at, last_event_at, reset_count, report_snapshot
		FROM paper_sessions
		WHERE account_id = $1
		  AND ($2 = '' OR status = $2)
		  AND ($3 = '' OR session_id ILIKE '%' || $3 || '%')
		ORDER BY updated_at DESC, started_at DESC
		LIMIT $4 OFFSET $5
	`, accountID, statusFilter, queryFilter, filter.Limit, filter.Offset)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	entries := make([]papertrading.SessionHistoryEntry, 0)
	for rows.Next() {
		var (
			entry     papertrading.SessionHistoryEntry
			status    string
			reportRaw []byte
			report    papertrading.SessionReport
		)
		if err := rows.Scan(
			&entry.SessionID,
			&status,
			&entry.StartedAt,
			&entry.StoppedAt,
			&entry.LastEventAt,
			&entry.ResetCount,
			&reportRaw,
		); err != nil {
			return nil, err
		}
		entry.Status = papertrading.SessionStatus(status)
		if len(reportRaw) > 0 {
			if err := json.Unmarshal(reportRaw, &report); err != nil {
				return nil, err
			}
			entry.FilledOrders = report.FilledOrders
			entry.RejectedSignals = report.RejectedSignals
			entry.RealizedPnL = report.RealizedPnL
			entry.TotalPnL = report.TotalPnL
			entry.MaxDrawdown = report.MaxDrawdown
		}
		entries = append(entries, entry)
	}

	return entries, rows.Err()
}

func (s *StateStore) LoadSessionReport(accountID string, sessionID string) (papertrading.SessionReport, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	var raw []byte
	row := s.db.QueryRowContext(ctx, `
		SELECT report_snapshot
		FROM paper_sessions
		WHERE account_id = $1 AND session_id = $2
	`, accountID, sessionID)

	if err := row.Scan(&raw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return papertrading.SessionReport{}, false, nil
		}
		return papertrading.SessionReport{}, false, err
	}

	var report papertrading.SessionReport
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &report); err != nil {
			return papertrading.SessionReport{}, false, err
		}
	}

	return report, true, nil
}

func (s *StateStore) LoadSessionAudit(accountID string, sessionID string, limit int, offset int) ([]papertrading.AuditEvent, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	var exists bool
	if err := s.db.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM paper_sessions WHERE account_id = $1 AND session_id = $2
		)
	`, accountID, sessionID).Scan(&exists); err != nil {
		return nil, false, err
	}
	if !exists {
		return nil, false, nil
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, session_id, event_type, message, COALESCE(symbol, ''), event_timestamp, details
		FROM paper_audit_events
		WHERE account_id = $1 AND session_id = $2
		ORDER BY event_timestamp ASC, id ASC
		LIMIT $3 OFFSET $4
	`, accountID, sessionID, limit, offset)
	if err != nil {
		return nil, false, err
	}
	defer func() {
		_ = rows.Close()
	}()

	events := make([]papertrading.AuditEvent, 0)
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
			return nil, false, err
		}
		if len(detailsRaw) > 0 {
			if err := json.Unmarshal(detailsRaw, &event.Details); err != nil {
				return nil, false, err
			}
		}
		events = append(events, event)
	}

	return events, true, rows.Err()
}

func (s *StateStore) LoadSessionTimeline(accountID string, sessionID string) ([]papertrading.SessionTimelinePoint, bool, error) {
	report, found, err := s.LoadSessionReport(accountID, sessionID)
	if err != nil || !found {
		return nil, found, err
	}

	return report.Timeline, true, nil
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
