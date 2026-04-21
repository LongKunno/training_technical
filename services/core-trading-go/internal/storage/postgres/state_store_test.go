package postgres_test

import (
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
	mock.ExpectExec(`DELETE FROM paper_orders WHERE account_id = \$1`).
		WithArgs("paper-account-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`INSERT INTO paper_orders`).
		WithArgs(
			"paper-order-1",
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
