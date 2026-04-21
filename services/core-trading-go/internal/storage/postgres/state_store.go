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
	"crypto_simulator/core_trading/internal/simulation"
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
				requested_quantity,
				price,
				requested_price,
				notional,
				requested_notional,
				fee,
				fee_rate,
				slippage_rate,
				fill_count,
				remaining_quantity,
				status,
				terminal_reason,
				executed_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
			ON CONFLICT (id) DO UPDATE SET
				account_id = EXCLUDED.account_id,
				symbol = EXCLUDED.symbol,
				side = EXCLUDED.side,
				quantity = EXCLUDED.quantity,
				requested_quantity = EXCLUDED.requested_quantity,
				price = EXCLUDED.price,
				requested_price = EXCLUDED.requested_price,
				notional = EXCLUDED.notional,
				requested_notional = EXCLUDED.requested_notional,
				fee = EXCLUDED.fee,
				fee_rate = EXCLUDED.fee_rate,
				slippage_rate = EXCLUDED.slippage_rate,
				fill_count = EXCLUDED.fill_count,
				remaining_quantity = EXCLUDED.remaining_quantity,
				status = EXCLUDED.status,
				terminal_reason = EXCLUDED.terminal_reason,
				executed_at = EXCLUDED.executed_at
		`,
			order.ID,
			order.AccountID,
			order.Symbol,
			string(order.Side),
			order.Quantity,
			order.RequestedQuantity,
			order.Price,
			order.RequestedPrice,
			order.Notional,
			order.RequestedNotional,
			order.Fee,
			order.FeeRate,
			order.SlippageRate,
			order.FillCount,
			order.RemainingQuantity,
			order.Status,
			order.TerminalReason,
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
	marketProfileSnapshot, err := json.Marshal(state.MarketProfile)
	if err != nil {
		return err
	}
	pendingExecutionSnapshot, err := json.Marshal(state.PendingExecutions)
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
				market_profile_snapshot,
				pending_execution_snapshot,
				updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, NOW())
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
				market_profile_snapshot = EXCLUDED.market_profile_snapshot,
				pending_execution_snapshot = EXCLUDED.pending_execution_snapshot,
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
			string(marketProfileSnapshot),
			string(pendingExecutionSnapshot),
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

func (s *StateStore) ListBots() ([]simulation.BotSummary, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, `
		SELECT bot_id, name, description, runtime, current_version, default_scenario, updated_at
		FROM simulation_bots
		ORDER BY updated_at DESC, bot_id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	bots := make([]simulation.BotSummary, 0)
	for rows.Next() {
		var bot simulation.BotSummary
		if err := rows.Scan(
			&bot.BotID,
			&bot.Name,
			&bot.Description,
			&bot.Runtime,
			&bot.CurrentVersion,
			&bot.DefaultScenario,
			&bot.UpdatedAt,
		); err != nil {
			return nil, err
		}
		bots = append(bots, bot)
	}

	return bots, rows.Err()
}

func (s *StateStore) GetBot(botID string) (simulation.BotDetail, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	row := s.db.QueryRowContext(ctx, `
		SELECT bot_id, name, description, runtime, current_version, default_scenario, updated_at
		FROM simulation_bots
		WHERE bot_id = $1
	`, botID)

	var bot simulation.BotDetail
	if err := row.Scan(
		&bot.BotID,
		&bot.Name,
		&bot.Description,
		&bot.Runtime,
		&bot.CurrentVersion,
		&bot.DefaultScenario,
		&bot.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return simulation.BotDetail{}, false, nil
		}
		return simulation.BotDetail{}, false, err
	}

	versions, err := s.loadBotVersions(ctx, botID)
	if err != nil {
		return simulation.BotDetail{}, false, err
	}
	bot.Versions = versions

	return bot, true, nil
}

func (s *StateStore) ListRuns(accountID string, filter simulation.RunFilter) ([]simulation.RunSummary, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	filter = simulation.NormalizeRunFilter(filter)
	statusFilter := strings.TrimSpace(string(filter.Status))
	queryFilter := strings.TrimSpace(filter.Query)

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			r.run_id,
			COALESCE(r.experiment_id, ''),
			r.bot_id,
			b.name,
			r.bot_version,
			r.scenario_id,
			r.session_id,
			r.status,
			COALESCE(r.error_message, ''),
			r.started_at,
			r.completed_at,
			r.updated_at
		FROM simulation_runs r
		JOIN simulation_bots b ON b.bot_id = r.bot_id
		WHERE r.account_id = $1
		  AND ($2 = '' OR r.status = $2)
		  AND ($3 = '' OR r.run_id ILIKE '%' || $3 || '%' OR r.session_id ILIKE '%' || $3 || '%')
		  AND ($4 = '' OR r.bot_id = $4)
		  AND ($5 = '' OR r.bot_version = $5)
		  AND ($6 = '' OR r.scenario_id = $6)
		  AND ($7 = '' OR COALESCE(r.experiment_id, '') = $7)
		ORDER BY r.updated_at DESC, r.started_at DESC
		LIMIT $8 OFFSET $9
	`, accountID, statusFilter, queryFilter, filter.BotID, filter.BotVersion, filter.ScenarioID, filter.ExperimentID, filter.Limit, filter.Offset)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	runs := make([]simulation.RunSummary, 0)
	for rows.Next() {
		run, err := scanRunSummary(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}

	return runs, rows.Err()
}

func (s *StateStore) ListLeaderboard(accountID string, filter simulation.LeaderboardFilter) ([]simulation.LeaderboardEntry, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	filter = simulation.NormalizeLeaderboardFilter(filter)
	rows, err := s.db.QueryContext(ctx, `
		SELECT
			r.run_id,
			COALESCE(r.experiment_id, ''),
			r.bot_id,
			b.name,
			r.bot_version,
			r.scenario_id,
			r.session_id,
			r.status,
			COALESCE(r.error_message, ''),
			r.started_at,
			r.completed_at,
			r.updated_at,
			r.metrics_snapshot
		FROM simulation_runs r
		JOIN simulation_bots b ON b.bot_id = r.bot_id
		WHERE r.account_id = $1
		  AND r.status = 'completed'
		  AND r.metrics_snapshot IS NOT NULL
		  AND COALESCE(r.experiment_id, '') = ''
		  AND ($2 = '' OR r.bot_id = $2)
		  AND ($3 = '' OR r.bot_version = $3)
		  AND ($4 = '' OR r.scenario_id = $4)
		ORDER BY
			(r.metrics_snapshot->>'total_pnl')::double precision DESC,
			(r.metrics_snapshot->>'max_drawdown')::double precision ASC,
			r.updated_at DESC
		LIMIT $5 OFFSET $6
	`, accountID, filter.BotID, filter.BotVersion, filter.ScenarioID, filter.Limit, filter.Offset)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	entries := make([]simulation.LeaderboardEntry, 0)
	for rows.Next() {
		summary, metrics, err := scanLeaderboardEntry(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, simulation.LeaderboardEntry{
			RunSummary:      summary,
			MetricsSnapshot: metrics,
		})
	}

	return entries, rows.Err()
}

func (s *StateStore) ListExperiments(accountID string, filter simulation.ExperimentFilter) ([]simulation.ExperimentSummary, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	filter = simulation.NormalizeExperimentFilter(filter)
	statusFilter := strings.TrimSpace(string(filter.Status))
	queryFilter := strings.TrimSpace(filter.Query)

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			experiment_id,
			name,
			status,
			planned_runs,
			completed_runs,
			failed_runs,
			stopped_runs,
			COALESCE(active_run_id, ''),
			COALESCE(error_message, ''),
			created_at,
			started_at,
			completed_at,
			updated_at
		FROM simulation_experiments
		WHERE account_id = $1
		  AND ($2 = '' OR status = $2)
		  AND ($3 = '' OR experiment_id ILIKE '%' || $3 || '%' OR name ILIKE '%' || $3 || '%')
		ORDER BY updated_at DESC, created_at DESC
		LIMIT $4 OFFSET $5
	`, accountID, statusFilter, queryFilter, filter.Limit, filter.Offset)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	experiments := make([]simulation.ExperimentSummary, 0)
	for rows.Next() {
		experiment, err := scanExperimentSummary(rows)
		if err != nil {
			return nil, err
		}
		experiments = append(experiments, experiment)
	}
	return experiments, rows.Err()
}

func (s *StateStore) ListQueuedExperiments(accountID string) ([]simulation.ExperimentSummary, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	rows, err := s.db.QueryContext(ctx, `
		SELECT
			experiment_id,
			name,
			status,
			planned_runs,
			completed_runs,
			failed_runs,
			stopped_runs,
			COALESCE(active_run_id, ''),
			COALESCE(error_message, ''),
			created_at,
			started_at,
			completed_at,
			updated_at
		FROM simulation_experiments
		WHERE account_id = $1
		  AND status = $2
		ORDER BY created_at ASC, experiment_id ASC
	`, accountID, string(simulation.ExperimentStatusQueued))
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	experiments := make([]simulation.ExperimentSummary, 0)
	for rows.Next() {
		experiment, err := scanExperimentSummary(rows)
		if err != nil {
			return nil, err
		}
		experiments = append(experiments, experiment)
	}
	return experiments, rows.Err()
}

func (s *StateStore) GetExperiment(accountID string, experimentID string) (simulation.ExperimentDetail, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	row := s.db.QueryRowContext(ctx, `
		SELECT
			experiment_id,
			name,
			status,
			planned_runs,
			completed_runs,
			failed_runs,
			stopped_runs,
			COALESCE(active_run_id, ''),
			COALESCE(error_message, ''),
			execution_profile_snapshot,
			slots_snapshot,
			current_index,
			stop_requested,
			created_at,
			started_at,
			completed_at,
			updated_at
		FROM simulation_experiments
		WHERE account_id = $1 AND experiment_id = $2
	`, accountID, experimentID)

	var (
		experiment          simulation.ExperimentDetail
		statusRaw           string
		executionProfileRaw []byte
		slotsRaw            []byte
	)
	if err := row.Scan(
		&experiment.ExperimentID,
		&experiment.Name,
		&statusRaw,
		&experiment.PlannedRuns,
		&experiment.CompletedRuns,
		&experiment.FailedRuns,
		&experiment.StoppedRuns,
		&experiment.ActiveRunID,
		&experiment.ErrorMessage,
		&executionProfileRaw,
		&slotsRaw,
		&experiment.CurrentIndex,
		&experiment.StopRequested,
		&experiment.CreatedAt,
		&experiment.StartedAt,
		&experiment.CompletedAt,
		&experiment.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return simulation.ExperimentDetail{}, false, nil
		}
		return simulation.ExperimentDetail{}, false, err
	}

	experiment.Status = simulation.ExperimentStatus(statusRaw)
	executionProfile, err := decodeJSONStruct[simulation.ExecutionProfile](executionProfileRaw)
	if err != nil {
		return simulation.ExperimentDetail{}, false, err
	}
	slots, err := decodeJSONStruct[[]simulation.ExperimentRunSlot](slotsRaw)
	if err != nil {
		return simulation.ExperimentDetail{}, false, err
	}
	experiment.ExecutionProfileSnapshot = executionProfile
	experiment.Slots = slots
	return experiment, true, nil
}

func (s *StateStore) FindActiveExperiment(accountID string) (simulation.ExperimentDetail, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	row := s.db.QueryRowContext(ctx, `
		SELECT
			experiment_id,
			name,
			status,
			planned_runs,
			completed_runs,
			failed_runs,
			stopped_runs,
			COALESCE(active_run_id, ''),
			COALESCE(error_message, ''),
			execution_profile_snapshot,
			slots_snapshot,
			current_index,
			stop_requested,
			created_at,
			started_at,
			completed_at,
			updated_at
		FROM simulation_experiments
		WHERE account_id = $1
		  AND status IN ($2, $3)
		ORDER BY updated_at DESC, created_at DESC
		LIMIT 1
	`, accountID, string(simulation.ExperimentStatusStarting), string(simulation.ExperimentStatusRunning))

	var (
		experiment          simulation.ExperimentDetail
		statusRaw           string
		executionProfileRaw []byte
		slotsRaw            []byte
	)
	if err := row.Scan(
		&experiment.ExperimentID,
		&experiment.Name,
		&statusRaw,
		&experiment.PlannedRuns,
		&experiment.CompletedRuns,
		&experiment.FailedRuns,
		&experiment.StoppedRuns,
		&experiment.ActiveRunID,
		&experiment.ErrorMessage,
		&executionProfileRaw,
		&slotsRaw,
		&experiment.CurrentIndex,
		&experiment.StopRequested,
		&experiment.CreatedAt,
		&experiment.StartedAt,
		&experiment.CompletedAt,
		&experiment.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return simulation.ExperimentDetail{}, false, nil
		}
		return simulation.ExperimentDetail{}, false, err
	}

	experiment.Status = simulation.ExperimentStatus(statusRaw)
	executionProfile, err := decodeJSONStruct[simulation.ExecutionProfile](executionProfileRaw)
	if err != nil {
		return simulation.ExperimentDetail{}, false, err
	}
	slots, err := decodeJSONStruct[[]simulation.ExperimentRunSlot](slotsRaw)
	if err != nil {
		return simulation.ExperimentDetail{}, false, err
	}
	experiment.ExecutionProfileSnapshot = executionProfile
	experiment.Slots = slots
	return experiment, true, nil
}

func (s *StateStore) CreateExperiment(accountID string, experiment simulation.ExperimentDetail) error {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	executionProfileSnapshot, err := json.Marshal(experiment.ExecutionProfileSnapshot)
	if err != nil {
		return err
	}
	slotsSnapshot, err := json.Marshal(experiment.Slots)
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO simulation_experiments (
			experiment_id,
			account_id,
			name,
			status,
			planned_runs,
			completed_runs,
			failed_runs,
			stopped_runs,
			active_run_id,
			error_message,
			execution_profile_snapshot,
			slots_snapshot,
			current_index,
			stop_requested,
			created_at,
			started_at,
			completed_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17, NOW())
	`, experiment.ExperimentID, accountID, experiment.Name, string(experiment.Status), experiment.PlannedRuns, experiment.CompletedRuns, experiment.FailedRuns, experiment.StoppedRuns, nullableString(experiment.ActiveRunID), nullableString(experiment.ErrorMessage), string(executionProfileSnapshot), string(slotsSnapshot), experiment.CurrentIndex, experiment.StopRequested, experiment.CreatedAt, experiment.StartedAt, experiment.CompletedAt)
	return err
}

func (s *StateStore) UpdateExperiment(accountID string, experiment simulation.ExperimentDetail) error {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	executionProfileSnapshot, err := json.Marshal(experiment.ExecutionProfileSnapshot)
	if err != nil {
		return err
	}
	slotsSnapshot, err := json.Marshal(experiment.Slots)
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		UPDATE simulation_experiments
		SET
			name = $3,
			status = $4,
			planned_runs = $5,
			completed_runs = $6,
			failed_runs = $7,
			stopped_runs = $8,
			active_run_id = $9,
			error_message = $10,
			execution_profile_snapshot = $11::jsonb,
			slots_snapshot = $12::jsonb,
			current_index = $13,
			stop_requested = $14,
			created_at = $15,
			started_at = $16,
			completed_at = $17,
			updated_at = NOW()
		WHERE account_id = $1 AND experiment_id = $2
	`, accountID, experiment.ExperimentID, experiment.Name, string(experiment.Status), experiment.PlannedRuns, experiment.CompletedRuns, experiment.FailedRuns, experiment.StoppedRuns, nullableString(experiment.ActiveRunID), nullableString(experiment.ErrorMessage), string(executionProfileSnapshot), string(slotsSnapshot), experiment.CurrentIndex, experiment.StopRequested, experiment.CreatedAt, experiment.StartedAt, experiment.CompletedAt)
	return err
}

func (s *StateStore) GetRun(accountID string, runID string) (simulation.RunDetail, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	row := s.db.QueryRowContext(ctx, `
		SELECT
			r.run_id,
			COALESCE(r.experiment_id, ''),
			r.bot_id,
			b.name,
			r.bot_version,
			r.scenario_id,
			r.session_id,
			r.status,
			COALESCE(r.error_message, ''),
			r.last_heartbeat_at,
			r.started_at,
			r.completed_at,
			r.updated_at,
			r.config_snapshot,
			r.execution_profile_snapshot,
			r.market_profile_snapshot,
			r.metrics_snapshot,
			COALESCE(r.stopped_reason, '')
		FROM simulation_runs r
		JOIN simulation_bots b ON b.bot_id = r.bot_id
		WHERE r.account_id = $1 AND r.run_id = $2
	`, accountID, runID)

	var (
		run                 simulation.RunDetail
		statusRaw           string
		configRaw           []byte
		executionProfileRaw []byte
		marketProfileRaw    []byte
		metricsRaw          []byte
	)
	if err := row.Scan(
		&run.RunID,
		&run.ExperimentID,
		&run.BotID,
		&run.BotName,
		&run.BotVersion,
		&run.ScenarioID,
		&run.SessionID,
		&statusRaw,
		&run.ErrorMessage,
		&run.LastHeartbeatAt,
		&run.StartedAt,
		&run.CompletedAt,
		&run.UpdatedAt,
		&configRaw,
		&executionProfileRaw,
		&marketProfileRaw,
		&metricsRaw,
		&run.StoppedReason,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return simulation.RunDetail{}, false, nil
		}
		return simulation.RunDetail{}, false, err
	}

	run.Status = simulation.RunStatus(statusRaw)
	configSnapshot, err := decodeJSONMap(configRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	run.ConfigSnapshot = configSnapshot
	executionProfile, err := decodeJSONStruct[simulation.ExecutionProfile](executionProfileRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	marketProfile, err := decodeJSONStruct[simulation.MarketMicrostructureProfile](marketProfileRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	metricsSnapshot, err := decodeOptionalJSONStruct[simulation.RunMetricsSummary](metricsRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	run.ExecutionProfileSnapshot = executionProfile
	run.MarketProfileSnapshot = marketProfile
	run.MetricsSnapshot = metricsSnapshot

	return run, true, nil
}

func (s *StateStore) FindActiveRun(accountID string) (simulation.RunDetail, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	row := s.db.QueryRowContext(ctx, `
		SELECT
			r.run_id,
			COALESCE(r.experiment_id, ''),
			r.bot_id,
			b.name,
			r.bot_version,
			r.scenario_id,
			r.session_id,
			r.status,
			COALESCE(r.error_message, ''),
			r.started_at,
			r.completed_at,
			r.updated_at,
			r.config_snapshot,
			r.execution_profile_snapshot,
			r.market_profile_snapshot,
			r.metrics_snapshot,
			COALESCE(r.stopped_reason, '')
		FROM simulation_runs r
		JOIN simulation_bots b ON b.bot_id = r.bot_id
		WHERE r.account_id = $1
		  AND r.status IN ($2, $3)
		ORDER BY r.updated_at DESC, r.started_at DESC
		LIMIT 1
	`, accountID, string(simulation.RunStatusStarting), string(simulation.RunStatusRunning))

	var (
		run                 simulation.RunDetail
		statusRaw           string
		configRaw           []byte
		executionProfileRaw []byte
		marketProfileRaw    []byte
		metricsRaw          []byte
	)
	if err := row.Scan(
		&run.RunID,
		&run.ExperimentID,
		&run.BotID,
		&run.BotName,
		&run.BotVersion,
		&run.ScenarioID,
		&run.SessionID,
		&statusRaw,
		&run.ErrorMessage,
		&run.LastHeartbeatAt,
		&run.StartedAt,
		&run.CompletedAt,
		&run.UpdatedAt,
		&configRaw,
		&executionProfileRaw,
		&marketProfileRaw,
		&metricsRaw,
		&run.StoppedReason,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return simulation.RunDetail{}, false, nil
		}
		return simulation.RunDetail{}, false, err
	}

	run.Status = simulation.RunStatus(statusRaw)
	configSnapshot, err := decodeJSONMap(configRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	run.ConfigSnapshot = configSnapshot
	executionProfile, err := decodeJSONStruct[simulation.ExecutionProfile](executionProfileRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	marketProfile, err := decodeJSONStruct[simulation.MarketMicrostructureProfile](marketProfileRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	metricsSnapshot, err := decodeOptionalJSONStruct[simulation.RunMetricsSummary](metricsRaw)
	if err != nil {
		return simulation.RunDetail{}, false, err
	}
	run.ExecutionProfileSnapshot = executionProfile
	run.MarketProfileSnapshot = marketProfile
	run.MetricsSnapshot = metricsSnapshot

	return run, true, nil
}

func (s *StateStore) CreateRun(accountID string, run simulation.RunDetail) error {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	configSnapshot, err := json.Marshal(run.ConfigSnapshot)
	if err != nil {
		return err
	}
	executionProfileSnapshot, err := json.Marshal(run.ExecutionProfileSnapshot)
	if err != nil {
		return err
	}
	marketProfileSnapshot, err := json.Marshal(run.MarketProfileSnapshot)
	if err != nil {
		return err
	}

	_, err = s.db.ExecContext(ctx, `
		INSERT INTO simulation_runs (
			run_id,
			account_id,
			experiment_id,
			bot_id,
			bot_version,
			scenario_id,
			session_id,
			status,
			error_message,
			config_snapshot,
			execution_profile_snapshot,
			market_profile_snapshot,
			last_heartbeat_at,
			started_at,
			completed_at,
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, NOW())
	`, run.RunID, accountID, nullableString(run.ExperimentID), run.BotID, run.BotVersion, run.ScenarioID, run.SessionID, string(run.Status), nullableString(run.ErrorMessage), string(configSnapshot), string(executionProfileSnapshot), string(marketProfileSnapshot), run.LastHeartbeatAt, run.StartedAt, run.CompletedAt)
	return err
}

func (s *StateStore) UpdateRunStatus(accountID string, runID string, status simulation.RunStatus, errorMessage string, stoppedReason string, completedAt *time.Time, metrics *simulation.RunMetricsSummary) error {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	var metricsPayload any
	if metrics != nil {
		rawMetrics, err := json.Marshal(metrics)
		if err != nil {
			return err
		}
		metricsPayload = string(rawMetrics)
	}

	_, err := s.db.ExecContext(ctx, `
		UPDATE simulation_runs
		SET
			status = $3,
			error_message = $4,
			stopped_reason = CASE WHEN $5 = '' THEN stopped_reason ELSE $5 END,
			completed_at = CASE WHEN $6::timestamptz IS NULL THEN completed_at ELSE $6 END,
			metrics_snapshot = CASE WHEN $7::jsonb IS NULL THEN metrics_snapshot ELSE $7::jsonb END,
			updated_at = NOW()
		WHERE account_id = $1 AND run_id = $2
	`, accountID, runID, string(status), nullableString(errorMessage), stoppedReason, completedAt, metricsPayload)
	return err
}

func (s *StateStore) UpdateRunHeartbeat(accountID string, runID string, heartbeatAt time.Time) error {
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	_, err := s.db.ExecContext(ctx, `
		UPDATE simulation_runs
		SET
			last_heartbeat_at = $3,
			updated_at = NOW()
		WHERE account_id = $1 AND run_id = $2
	`, accountID, runID, heartbeatAt)
	return err
}

func loadOrders(ctx context.Context, tx *sql.Tx, accountID string, state *papertrading.PersistentState) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT
			id,
			account_id,
			symbol,
			side,
			quantity,
			requested_quantity,
			price,
			requested_price,
			notional,
			requested_notional,
			fee,
			fee_rate,
			slippage_rate,
			fill_count,
			remaining_quantity,
			status,
			terminal_reason,
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
			&order.RequestedQuantity,
			&order.Price,
			&order.RequestedPrice,
			&order.Notional,
			&order.RequestedNotional,
			&order.Fee,
			&order.FeeRate,
			&order.SlippageRate,
			&order.FillCount,
			&order.RemainingQuantity,
			&order.Status,
			&order.TerminalReason,
			&order.ExecutedAt,
		); err != nil {
			return err
		}
		order.Side = papertrading.OrderSide(side)
		state.Orders = append(state.Orders, order)
	}

	return rows.Err()
}

func (s *StateStore) loadBotVersions(ctx context.Context, botID string) ([]simulation.BotVersion, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT bot_id, version, title, description, entrypoint, config_schema, default_config, updated_at
		FROM simulation_bot_versions
		WHERE bot_id = $1
		ORDER BY updated_at DESC, version DESC
	`, botID)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = rows.Close()
	}()

	versions := make([]simulation.BotVersion, 0)
	for rows.Next() {
		var (
			version          simulation.BotVersion
			configSchemaRaw  []byte
			defaultConfigRaw []byte
		)
		if err := rows.Scan(
			&version.BotID,
			&version.Version,
			&version.Title,
			&version.Description,
			&version.Entrypoint,
			&configSchemaRaw,
			&defaultConfigRaw,
			&version.UpdatedAt,
		); err != nil {
			return nil, err
		}

		configSchema, err := decodeJSONMap(configSchemaRaw)
		if err != nil {
			return nil, err
		}
		defaultConfig, err := decodeJSONMap(defaultConfigRaw)
		if err != nil {
			return nil, err
		}
		version.ConfigSchema = configSchema
		version.DefaultConfig = defaultConfig
		versions = append(versions, version)
	}

	return versions, rows.Err()
}

func scanRunSummary(scanner interface {
	Scan(dest ...any) error
}) (simulation.RunSummary, error) {
	var (
		run       simulation.RunSummary
		statusRaw string
	)
	if err := scanner.Scan(
		&run.RunID,
		&run.ExperimentID,
		&run.BotID,
		&run.BotName,
		&run.BotVersion,
		&run.ScenarioID,
		&run.SessionID,
		&statusRaw,
		&run.ErrorMessage,
		&run.StartedAt,
		&run.CompletedAt,
		&run.UpdatedAt,
	); err != nil {
		return simulation.RunSummary{}, err
	}
	run.Status = simulation.RunStatus(statusRaw)
	return run, nil
}

func scanLeaderboardEntry(scanner interface {
	Scan(dest ...any) error
}) (simulation.RunSummary, simulation.RunMetricsSummary, error) {
	var (
		run        simulation.RunSummary
		statusRaw  string
		metricsRaw []byte
	)
	if err := scanner.Scan(
		&run.RunID,
		&run.ExperimentID,
		&run.BotID,
		&run.BotName,
		&run.BotVersion,
		&run.ScenarioID,
		&run.SessionID,
		&statusRaw,
		&run.ErrorMessage,
		&run.StartedAt,
		&run.CompletedAt,
		&run.UpdatedAt,
		&metricsRaw,
	); err != nil {
		return simulation.RunSummary{}, simulation.RunMetricsSummary{}, err
	}
	run.Status = simulation.RunStatus(statusRaw)
	metrics, err := decodeJSONStruct[simulation.RunMetricsSummary](metricsRaw)
	if err != nil {
		return simulation.RunSummary{}, simulation.RunMetricsSummary{}, err
	}
	return run, metrics, nil
}

func scanExperimentSummary(scanner interface {
	Scan(dest ...any) error
}) (simulation.ExperimentSummary, error) {
	var (
		experiment simulation.ExperimentSummary
		statusRaw  string
	)
	if err := scanner.Scan(
		&experiment.ExperimentID,
		&experiment.Name,
		&statusRaw,
		&experiment.PlannedRuns,
		&experiment.CompletedRuns,
		&experiment.FailedRuns,
		&experiment.StoppedRuns,
		&experiment.ActiveRunID,
		&experiment.ErrorMessage,
		&experiment.CreatedAt,
		&experiment.StartedAt,
		&experiment.CompletedAt,
		&experiment.UpdatedAt,
	); err != nil {
		return simulation.ExperimentSummary{}, err
	}
	experiment.Status = simulation.ExperimentStatus(statusRaw)
	return experiment, nil
}

func decodeJSONMap(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload == nil {
		return map[string]any{}, nil
	}

	return payload, nil
}

func decodeJSONStruct[T any](raw []byte) (T, error) {
	var payload T
	if len(raw) == 0 {
		return payload, nil
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return payload, err
	}
	return payload, nil
}

func decodeOptionalJSONStruct[T any](raw []byte) (*T, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var payload T
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return &payload, nil
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
			processed_signal_ids,
			market_profile_snapshot,
			pending_execution_snapshot
		FROM paper_sessions
		WHERE account_id = $1
		ORDER BY updated_at DESC, started_at DESC
		LIMIT 1
	`, accountID)

	var (
		statusRaw           string
		reportSnapshotRaw   []byte
		processedSignalsRaw []byte
		marketProfileRaw    []byte
		pendingRaw          []byte
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
		&marketProfileRaw,
		&pendingRaw,
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
	if len(marketProfileRaw) > 0 {
		if err := json.Unmarshal(marketProfileRaw, &state.MarketProfile); err != nil {
			return err
		}
	}
	if len(pendingRaw) > 0 {
		if err := json.Unmarshal(pendingRaw, &state.PendingExecutions); err != nil {
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
