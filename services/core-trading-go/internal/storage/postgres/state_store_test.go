package postgres_test

import (
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"crypto_simulator/core_trading/internal/marketdata"
	"crypto_simulator/core_trading/internal/papertrading"
	"crypto_simulator/core_trading/internal/simulation"
	"crypto_simulator/core_trading/internal/storage/postgres"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestListRunsAppliesExperimentFilter(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	store := postgres.NewStateStore(db)
	startedAt := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"run_id",
		"experiment_id",
		"bot_id",
		"name",
		"bot_version",
		"scenario_id",
		"session_id",
		"status",
		"error_message",
		"started_at",
		"completed_at",
		"updated_at",
	}).AddRow(
		"sim-run-1",
		"sim-exp-1",
		"buy-and-hold",
		"Buy And Hold",
		"v1",
		"trend-up",
		"sim-run-1",
		"completed",
		"",
		startedAt,
		startedAt.Add(2*time.Minute),
		startedAt.Add(2*time.Minute),
	)

	mock.ExpectQuery(regexp.QuoteMeta(`
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
	`)).
		WithArgs("paper-account-1", "", "", "", "", "", "sim-exp-1", 10, 0).
		WillReturnRows(rows)

	runs, err := store.ListRuns("paper-account-1", simulation.RunFilter{
		ExperimentID: "sim-exp-1",
		Limit:        10,
		Offset:       0,
	})
	if err != nil {
		t.Fatalf("expected list runs to succeed, got error: %v", err)
	}

	if len(runs) != 1 || runs[0].ExperimentID != "sim-exp-1" {
		t.Fatalf("unexpected filtered runs %+v", runs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestListLeaderboardOnlyQueriesStandaloneCompletedRuns(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	store := postgres.NewStateStore(db)
	startedAt := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	metrics := `{"total_pnl":120,"max_drawdown":18,"filled_orders":4,"rejected_signals":0,"fees_paid":1.5,"slippage_cost":0.5,"realized_pnl":90,"unrealized_pnl":30}`
	rows := sqlmock.NewRows([]string{
		"run_id",
		"experiment_id",
		"bot_id",
		"name",
		"bot_version",
		"scenario_id",
		"session_id",
		"status",
		"error_message",
		"started_at",
		"completed_at",
		"updated_at",
		"metrics_snapshot",
	}).AddRow(
		"sim-run-standalone",
		"",
		"buy-and-hold",
		"Buy And Hold",
		"v1",
		"trend-up",
		"sim-run-standalone",
		"completed",
		"",
		startedAt,
		startedAt.Add(2*time.Minute),
		startedAt.Add(2*time.Minute),
		metrics,
	)

	mock.ExpectQuery(`(?s)FROM simulation_runs r.*AND r\.metrics_snapshot IS NOT NULL.*AND COALESCE\(r\.experiment_id, ''\) = ''`).
		WithArgs("paper-account-1", "buy-and-hold", "v1", "trend-up", 5, 0).
		WillReturnRows(rows)

	entries, err := store.ListLeaderboard("paper-account-1", simulation.LeaderboardFilter{
		BotID:      "buy-and-hold",
		BotVersion: "v1",
		ScenarioID: "trend-up",
		Limit:      5,
		Offset:     0,
	})
	if err != nil {
		t.Fatalf("expected leaderboard query to succeed, got error: %v", err)
	}

	if len(entries) != 1 || entries[0].ExperimentID != "" || entries[0].MetricsSnapshot.TotalPnL != 120 {
		t.Fatalf("unexpected leaderboard entries %+v", entries)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestSaveStatePersistsExtendedOrderFieldsAndRuntimeSnapshots(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	store := postgres.NewStateStore(db)
	startedAt := time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC)
	lastEventAt := startedAt.Add(2 * time.Minute)

	state := papertrading.PersistentState{
		Account: papertrading.VirtualAccount{
			ID:          "paper-account-1",
			CashBalance: 9050,
			Positions:   map[string]papertrading.Position{},
		},
		InitialBalance: 10000,
		RealizedPnL:    125,
		Rules: papertrading.SimulationRules{
			FeeRate:      0.001,
			SlippageRate: 0.002,
		},
		MarketProfile: papertrading.MarketExecutionProfile{
			SignalLatencyTicks:     2,
			SpreadBps:              7.5,
			MaxFillNotionalPerTick: 2500,
		},
		Orders: []papertrading.PaperOrder{
			{
				ID:                "paper-order-1",
				SessionID:         "sim-session-1",
				AccountID:         "paper-account-1",
				Symbol:            "BTCUSDT",
				Side:              papertrading.OrderSideBuy,
				Quantity:          1.25,
				RequestedQuantity: 2,
				Price:             105,
				RequestedPrice:    104,
				Notional:          131.25,
				RequestedNotional: 208,
				Fee:               0.13,
				FeeRate:           0.001,
				SlippageRate:      0.002,
				FillCount:         2,
				RemainingQuantity: 0.75,
				Status:            "partially_filled",
				TerminalReason:    "",
				ExecutedAt:        lastEventAt,
			},
		},
		PendingExecutions: []papertrading.PendingExecution{
			{
				OrderID:               "paper-order-1",
				SignalID:              "sig-1",
				StrategyID:            "baseline-roundtrip",
				Symbol:                "BTCUSDT",
				Side:                  papertrading.OrderSideBuy,
				RequestedQuantity:     2,
				RequestedNotional:     208,
				RequestedPrice:        104,
				RemainingQuantity:     0.75,
				RemainingLatencyTicks: 1,
				CreatedAt:             startedAt,
			},
		},
		MarketPrices: map[string]marketdata.PriceTickV1{
			"BTCUSDT": {
				Symbol:    "BTCUSDT",
				Price:     105,
				Source:    "mock-replay",
				Timestamp: lastEventAt,
			},
		},
		Session: papertrading.SimulationSession{
			ID:          "sim-session-1",
			Status:      papertrading.SessionStatusRunning,
			StartedAt:   startedAt,
			LastEventAt: lastEventAt,
		},
		Report: papertrading.SessionReport{
			SessionID: startedAt.Format(time.RFC3339Nano),
			Status:    papertrading.SessionStatusRunning,
			StartedAt: startedAt,
		},
		PeakEquity:       10125,
		ProcessedSignals: []string{"sig-1"},
	}

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO paper_accounts`).
		WithArgs("paper-account-1", 10000.0, 9050.0, 125.0, 0.001, 0.002).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`DELETE FROM paper_orders WHERE account_id = \$1 AND session_id = \$2`).
		WithArgs("paper-account-1", "sim-session-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`INSERT INTO paper_orders`).
		WithArgs(
			"paper-order-1",
			"sim-session-1",
			"paper-account-1",
			"BTCUSDT",
			"buy",
			1.25,
			2.0,
			105.0,
			104.0,
			131.25,
			208.0,
			0.13,
			0.001,
			0.002,
			2,
			0.75,
			"partially_filled",
			"",
			lastEventAt,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`DELETE FROM paper_positions WHERE account_id = \$1`).
		WithArgs("paper-account-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`DELETE FROM market_prices`).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`INSERT INTO market_prices`).
		WithArgs("BTCUSDT", 105.0, "mock-replay", lastEventAt).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO paper_sessions`).
		WithArgs(
			"sim-session-1",
			"paper-account-1",
			"running",
			startedAt,
			nil,
			0,
			lastEventAt,
			10125.0,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`DELETE FROM paper_audit_events WHERE session_id = \$1`).
		WithArgs("sim-session-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	if err := store.SaveState(state); err != nil {
		t.Fatalf("expected save state to succeed, got error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLoadSessionReportAndTimelineFromSnapshot(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	store := postgres.NewStateStore(db)
	startedAt := time.Date(2026, 4, 25, 9, 0, 0, 0, time.UTC)
	report := papertrading.SessionReport{
		SessionID:       "session-history-1",
		Status:          papertrading.SessionStatusStopped,
		StartedAt:       startedAt,
		FilledOrders:    2,
		RejectedSignals: 1,
		TotalPnL:        42,
		MaxDrawdown:     3.5,
		Timeline: []papertrading.SessionTimelinePoint{
			{
				Timestamp:   startedAt,
				Equity:      1000,
				EventType:   "session_started",
				CashBalance: 1000,
			},
			{
				Timestamp:     startedAt.Add(time.Minute),
				Equity:        1042,
				UnrealizedPnL: 42,
				EventType:     "market_tick",
				CashBalance:   900,
			},
		},
	}
	rawReport, err := json.Marshal(report)
	if err != nil {
		t.Fatalf("failed to marshal report: %v", err)
	}

	query := `SELECT report_snapshot\s+FROM paper_sessions\s+WHERE account_id = \$1 AND session_id = \$2`
	mock.ExpectQuery(query).
		WithArgs("paper-account-1", "session-history-1").
		WillReturnRows(sqlmock.NewRows([]string{"report_snapshot"}).AddRow(rawReport))
	mock.ExpectQuery(query).
		WithArgs("paper-account-1", "session-history-1").
		WillReturnRows(sqlmock.NewRows([]string{"report_snapshot"}).AddRow(rawReport))

	loadedReport, found, err := store.LoadSessionReport("paper-account-1", "session-history-1")
	if err != nil {
		t.Fatalf("expected load report to succeed, got %v", err)
	}
	if !found {
		t.Fatal("expected historical report to be found")
	}
	if loadedReport.TotalPnL != 42 || loadedReport.MaxDrawdown != 3.5 || len(loadedReport.Timeline) != 2 {
		t.Fatalf("expected report snapshot fields to restore, got %+v", loadedReport)
	}

	timeline, found, err := store.LoadSessionTimeline("paper-account-1", "session-history-1")
	if err != nil {
		t.Fatalf("expected load timeline to succeed, got %v", err)
	}
	if !found {
		t.Fatal("expected historical timeline to be found")
	}
	if len(timeline) != 2 || timeline[1].EventType != "market_tick" || timeline[1].Equity != 1042 {
		t.Fatalf("expected timeline to come from report snapshot, got %+v", timeline)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestLoadSessionOrdersFiltersBySessionAndSymbol(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create sqlmock: %v", err)
	}
	defer func() {
		_ = db.Close()
	}()

	store := postgres.NewStateStore(db)
	executedAt := time.Date(2026, 4, 25, 10, 15, 0, 0, time.UTC)

	mock.ExpectQuery(`SELECT EXISTS`).
		WithArgs("paper-account-1", "session-history-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	rows := sqlmock.NewRows([]string{
		"id",
		"session_id",
		"account_id",
		"symbol",
		"side",
		"quantity",
		"requested_quantity",
		"price",
		"requested_price",
		"notional",
		"requested_notional",
		"fee",
		"fee_rate",
		"slippage_rate",
		"fill_count",
		"remaining_quantity",
		"status",
		"terminal_reason",
		"executed_at",
	}).AddRow(
		"paper-order-1",
		"session-history-1",
		"paper-account-1",
		"BTCUSDT",
		"buy",
		1.5,
		2.0,
		101.0,
		100.0,
		151.5,
		200.0,
		0.15,
		0.001,
		0.002,
		2,
		0.5,
		"stopped",
		"cancel_after_ticks",
		executedAt,
	)

	mock.ExpectQuery(`FROM paper_orders`).
		WithArgs("paper-account-1", "session-history-1", "BTCUSDT", "buy", 10, 0).
		WillReturnRows(rows)

	orders, found, err := store.LoadSessionOrders("paper-account-1", "session-history-1", papertrading.OrderFilter{
		Symbol: "BTCUSDT",
		Side:   papertrading.OrderSideBuy,
		Limit:  10,
		Offset: 0,
	})
	if err != nil {
		t.Fatalf("expected load session orders to succeed, got error: %v", err)
	}
	if !found {
		t.Fatal("expected session orders to be found")
	}
	if len(orders) != 1 {
		t.Fatalf("expected one order, got %+v", orders)
	}
	if orders[0].SessionID != "session-history-1" || orders[0].TerminalReason != "cancel_after_ticks" {
		t.Fatalf("unexpected restored order %+v", orders[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}
