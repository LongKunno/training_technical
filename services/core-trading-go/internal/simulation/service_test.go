package simulation_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"crypto_simulator/core_trading/internal/papertrading"
	"crypto_simulator/core_trading/internal/simulation"
)

func TestCreateRunStartsSessionPersistsRunAndCallsRunner(t *testing.T) {
	t.Parallel()

	store := &fakeStore{
		bot: simulation.BotDetail{
			BotSummary: simulation.BotSummary{
				BotID:           "baseline-roundtrip",
				Name:            "Baseline Roundtrip",
				CurrentVersion:  "v1",
				DefaultScenario: "baseline",
			},
			Versions: []simulation.BotVersion{
				{
					BotID:         "baseline-roundtrip",
					Version:       "v1",
					DefaultConfig: map[string]any{"trade_notional": 1000.0},
				},
			},
		},
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "manual-session",
			Status: papertrading.SessionStatusRunning,
		},
	}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	run, err := service.CreateRun(context.Background(), simulation.CreateRunRequest{
		BotID:      "baseline-roundtrip",
		ScenarioID: "baseline",
	})
	if err != nil {
		t.Fatalf("expected create run to succeed, got error: %v", err)
	}

	if run.Status != simulation.RunStatusRunning {
		t.Fatalf("expected run status %q, got %q", simulation.RunStatusRunning, run.Status)
	}
	if run.BotID != "baseline-roundtrip" {
		t.Fatalf("unexpected bot id %q", run.BotID)
	}
	if run.ConfigSnapshot["trade_notional"] != 1000.0 {
		t.Fatalf("expected default config to be persisted, got %+v", run.ConfigSnapshot)
	}
	if run.ExecutionProfileSnapshot.InitialBalance != 10000 {
		t.Fatalf("expected execution profile snapshot to be populated, got %+v", run.ExecutionProfileSnapshot)
	}
	if store.createdRun.RunID == "" || store.createdRun.SessionID == "" {
		t.Fatalf("expected persisted run identifiers, got %+v", store.createdRun)
	}
	if runner.startRequest.RunID != run.RunID {
		t.Fatalf("expected runner to receive run %q, got %+v", run.RunID, runner.startRequest)
	}
	if engine.startCalls != 1 {
		t.Fatalf("expected one session start, got %d", engine.startCalls)
	}
}

func TestUpdateRunStatusStopsCurrentSessionOnTerminalStatus(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	run := simulation.RunDetail{
		RunSummary: simulation.RunSummary{
			RunID:      "sim-run-1",
			BotID:      "baseline-roundtrip",
			BotVersion: "v1",
			ScenarioID: "baseline",
			SessionID:  "sim-run-1",
			Status:     simulation.RunStatusRunning,
			StartedAt:  now,
			UpdatedAt:  now,
		},
		ConfigSnapshot: map[string]any{"trade_notional": 1000.0},
	}
	store := &fakeStore{
		run: run,
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "sim-run-1",
			Status: papertrading.SessionStatusRunning,
		},
	}
	service := simulation.NewService("paper-account-1", engine, store, &fakeRunner{}, &fakeScenarioClient{})

	updatedRun, err := service.UpdateRunStatus(context.Background(), "sim-run-1", simulation.RunStatusUpdate{
		Status: simulation.RunStatusCompleted,
	})
	if err != nil {
		t.Fatalf("expected update to succeed, got error: %v", err)
	}

	if updatedRun.Status != simulation.RunStatusCompleted {
		t.Fatalf("expected completed run, got %q", updatedRun.Status)
	}
	if engine.stopCalls != 1 {
		t.Fatalf("expected terminal update to stop current session, got %d", engine.stopCalls)
	}
	if store.updatedStatus != simulation.RunStatusCompleted {
		t.Fatalf("expected store status update to be completed, got %q", store.updatedStatus)
	}
	if store.completedAt == nil {
		t.Fatal("expected completed_at to be recorded")
	}
	if store.metrics == nil || store.metrics.TotalPnL != 75 {
		t.Fatalf("expected metrics snapshot to be recorded, got %+v", store.metrics)
	}
}

func TestCreateRunUsesExecutionProfileOverridesAndLegacyConfigAlias(t *testing.T) {
	t.Parallel()

	initialBalance := 15000.0
	feeRate := 0.0015
	slippageRate := 0.0025
	riskControls := papertrading.RiskControls{
		AllowedSymbols:      []string{"BTCUSDT", "ETHUSDT"},
		MaxPositionQuantity: 5,
		MaxOrderNotional:    5000,
		MaxDailyLoss:        2500,
		CooldownSeconds:     0,
		MaxOpenNotional:     7000,
	}

	store := &fakeStore{
		bot: simulation.BotDetail{
			BotSummary: simulation.BotSummary{
				BotID:           "buy-and-hold",
				Name:            "Buy And Hold",
				CurrentVersion:  "v1",
				DefaultScenario: "trend-up",
			},
			Versions: []simulation.BotVersion{
				{
					BotID:         "buy-and-hold",
					Version:       "v1",
					DefaultConfig: map[string]any{"trade_notional": 1000.0, "tick_interval_ms": 250.0},
				},
			},
		},
	}
	engine := &fakeEngine{}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	run, err := service.CreateRun(context.Background(), simulation.CreateRunRequest{
		BotID:      "buy-and-hold",
		ScenarioID: "trend-up",
		Config: map[string]any{
			"trade_notional": 750.0,
			"fast_window":    2.0,
			"slow_window":    4.0,
		},
		ExecutionProfile: &simulation.ExecutionProfileInput{
			InitialBalance: &initialBalance,
			FeeRate:        &feeRate,
			SlippageRate:   &slippageRate,
			RiskControls:   &riskControls,
		},
	})
	if err != nil {
		t.Fatalf("expected create run to succeed, got error: %v", err)
	}

	if got := run.ConfigSnapshot["trade_notional"]; got != 750.0 {
		t.Fatalf("expected trade_notional override 750, got %+v", got)
	}
	if got := run.ConfigSnapshot["tick_interval_ms"]; got != 250.0 {
		t.Fatalf("expected default tick_interval_ms 250, got %+v", got)
	}
	if got := runner.startRequest.Config["slow_window"]; got != 4.0 {
		t.Fatalf("expected runner to receive merged config, got %+v", runner.startRequest.Config)
	}
	if run.ExecutionProfileSnapshot.InitialBalance != initialBalance {
		t.Fatalf("expected execution profile initial balance %v, got %+v", initialBalance, run.ExecutionProfileSnapshot)
	}
	if engine.lastProfile.InitialBalance != initialBalance {
		t.Fatalf("expected engine to receive overridden profile, got %+v", engine.lastProfile)
	}
	if engine.lastProfile.Rules.FeeRate != feeRate || engine.lastProfile.Rules.SlippageRate != slippageRate {
		t.Fatalf("expected engine fee/slippage overrides, got %+v", engine.lastProfile.Rules)
	}
	if len(engine.lastProfile.Rules.RiskControls.AllowedSymbols) != 2 {
		t.Fatalf("expected engine risk controls to be copied, got %+v", engine.lastProfile.Rules.RiskControls)
	}
}

func TestListRunsNormalizesExpandedFilters(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	service := simulation.NewService("paper-account-1", &fakeEngine{}, store, &fakeRunner{}, &fakeScenarioClient{})

	_, err := service.ListRuns(simulation.RunFilter{
		Query:        "  sim-run  ",
		BotID:        "  buy-and-hold ",
		BotVersion:   " v1 ",
		ScenarioID:   " trend-up ",
		ExperimentID: " sim-exp-1 ",
		Limit:        0,
		Offset:       -5,
	})
	if err != nil {
		t.Fatalf("expected list runs to succeed, got error: %v", err)
	}

	if store.lastRunFilter.Query != "sim-run" {
		t.Fatalf("expected trimmed query, got %+v", store.lastRunFilter)
	}
	if store.lastRunFilter.BotID != "buy-and-hold" || store.lastRunFilter.BotVersion != "v1" || store.lastRunFilter.ScenarioID != "trend-up" {
		t.Fatalf("expected trimmed run filters, got %+v", store.lastRunFilter)
	}
	if store.lastRunFilter.ExperimentID != "sim-exp-1" {
		t.Fatalf("expected trimmed experiment filter, got %+v", store.lastRunFilter)
	}
	if store.lastRunFilter.Limit != 20 || store.lastRunFilter.Offset != 0 {
		t.Fatalf("expected normalized pagination, got %+v", store.lastRunFilter)
	}
}

func TestListLeaderboardNormalizesFilters(t *testing.T) {
	t.Parallel()

	store := &fakeStore{}
	service := simulation.NewService("paper-account-1", &fakeEngine{}, store, &fakeRunner{}, &fakeScenarioClient{})

	_, err := service.ListLeaderboard(simulation.LeaderboardFilter{
		BotID:      "  moving-average-cross ",
		BotVersion: " v1 ",
		ScenarioID: " range-chop ",
		Limit:      0,
		Offset:     -1,
	})
	if err != nil {
		t.Fatalf("expected leaderboard query to succeed, got error: %v", err)
	}

	if store.lastLeaderboardFilter.BotID != "moving-average-cross" || store.lastLeaderboardFilter.BotVersion != "v1" || store.lastLeaderboardFilter.ScenarioID != "range-chop" {
		t.Fatalf("expected trimmed leaderboard filters, got %+v", store.lastLeaderboardFilter)
	}
	if store.lastLeaderboardFilter.Limit != 20 || store.lastLeaderboardFilter.Offset != 0 {
		t.Fatalf("expected normalized leaderboard pagination, got %+v", store.lastLeaderboardFilter)
	}
}

func TestUpdateRunStatusFailedPersistsStoppedReasonAndTrimmedError(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 4, 20, 10, 0, 0, 0, time.UTC)
	store := &fakeStore{
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:      "sim-run-2",
				BotID:      "moving-average-cross",
				BotVersion: "v1",
				ScenarioID: "range-chop",
				SessionID:  "sim-run-2",
				Status:     simulation.RunStatusRunning,
				StartedAt:  now,
				UpdatedAt:  now,
			},
			ConfigSnapshot: map[string]any{"trade_notional": 1000.0},
		},
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "sim-run-2",
			Status: papertrading.SessionStatusRunning,
		},
	}
	service := simulation.NewService("paper-account-1", engine, store, &fakeRunner{}, &fakeScenarioClient{})

	run, err := service.UpdateRunStatus(context.Background(), "sim-run-2", simulation.RunStatusUpdate{
		Status:       simulation.RunStatusFailed,
		ErrorMessage: " runner exploded ",
	})
	if err != nil {
		t.Fatalf("expected failed update to succeed, got error: %v", err)
	}

	if run.Status != simulation.RunStatusFailed {
		t.Fatalf("expected failed run status, got %q", run.Status)
	}
	if store.lastStoppedReason != "runner_failure" {
		t.Fatalf("expected runner_failure stop reason, got %q", store.lastStoppedReason)
	}
	if store.lastErrorMessage != "runner exploded" {
		t.Fatalf("expected trimmed error message, got %q", store.lastErrorMessage)
	}
	if store.metrics == nil || store.metrics.TotalPnL != 75 {
		t.Fatalf("expected metrics snapshot on failure, got %+v", store.metrics)
	}
}

func TestCreateExperimentExpandsMatrixStartsSingleChildAndPersistsSnapshots(t *testing.T) {
	t.Parallel()

	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional":   1000.0,
				"tick_interval_ms": 250.0,
			}),
			"buy-and-hold": makeBotDetail("buy-and-hold", "Buy And Hold", "trend-up", map[string]any{
				"trade_notional":   500.0,
				"tick_interval_ms": 100.0,
			}),
		},
	}
	engine := &fakeEngine{}
	runner := &fakeRunner{}
	scenarios := &fakeScenarioClient{
		scenarios: map[string]simulation.ScenarioCatalogEntry{
			"baseline":   makeScenario("baseline", 1, 5, 2500),
			"range-chop": makeScenario("range-chop", 2, 9, 1800),
		},
	}
	service := simulation.NewService("paper-account-1", engine, store, runner, scenarios)

	initialBalance := 25000.0
	experiment, err := service.CreateExperiment(context.Background(), simulation.CreateExperimentRequest{
		Name: "Matrix batch",
		Bots: []simulation.ExperimentBotRequest{
			{BotID: "baseline-roundtrip"},
			{BotID: "buy-and-hold"},
		},
		Scenarios:   []string{"baseline", "range-chop"},
		Repetitions: 2,
		ExecutionProfile: &simulation.ExecutionProfileInput{
			InitialBalance: &initialBalance,
		},
	})
	if err != nil {
		t.Fatalf("expected create experiment to succeed, got error: %v", err)
	}

	if experiment.PlannedRuns != 8 || len(experiment.Slots) != 8 {
		t.Fatalf("expected 8 planned slots, got planned=%d slots=%d", experiment.PlannedRuns, len(experiment.Slots))
	}
	if experiment.Status != simulation.ExperimentStatusRunning {
		t.Fatalf("expected running experiment, got %q", experiment.Status)
	}
	if experiment.ActiveRunID == "" {
		t.Fatal("expected active child run to be assigned")
	}
	if store.createRunCalls != 1 {
		t.Fatalf("expected exactly one child run to be created initially, got %d", store.createRunCalls)
	}
	if len(runner.startRequests) != 1 {
		t.Fatalf("expected one runner start request, got %d", len(runner.startRequests))
	}
	if store.createdRun.ExperimentID != experiment.ExperimentID {
		t.Fatalf("expected child run to inherit experiment id, got %+v", store.createdRun)
	}
	if store.createdRun.ExecutionProfileSnapshot.InitialBalance != initialBalance {
		t.Fatalf("expected execution snapshot to be persisted, got %+v", store.createdRun.ExecutionProfileSnapshot)
	}
	if store.createdRun.MarketProfileSnapshot.SignalLatencyTicks != 1 {
		t.Fatalf("expected market snapshot from scenario catalog, got %+v", store.createdRun.MarketProfileSnapshot)
	}
}

func TestExperimentAdvancesSequentiallyAcrossChildRuns(t *testing.T) {
	t.Parallel()

	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional": 1000.0,
			}),
		},
	}
	engine := &fakeEngine{}
	runner := &fakeRunner{}
	scenarios := &fakeScenarioClient{
		scenarios: map[string]simulation.ScenarioCatalogEntry{
			"baseline":   makeScenario("baseline", 1, 5, 2500),
			"range-chop": makeScenario("range-chop", 2, 9, 1800),
		},
	}
	service := simulation.NewService("paper-account-1", engine, store, runner, scenarios)

	experiment, err := service.CreateExperiment(context.Background(), simulation.CreateExperimentRequest{
		Name:        "Sequential lanes",
		Bots:        []simulation.ExperimentBotRequest{{BotID: "baseline-roundtrip"}},
		Scenarios:   []string{"baseline", "range-chop"},
		Repetitions: 1,
	})
	if err != nil {
		t.Fatalf("expected create experiment to succeed, got error: %v", err)
	}

	firstRunID := experiment.ActiveRunID
	if firstRunID == "" {
		t.Fatal("expected first child run to start immediately")
	}

	firstRun, err := service.UpdateRunStatus(context.Background(), firstRunID, simulation.RunStatusUpdate{
		Status: simulation.RunStatusCompleted,
	})
	if err != nil {
		t.Fatalf("expected first child completion to succeed, got error: %v", err)
	}

	if firstRun.Status != simulation.RunStatusCompleted {
		t.Fatalf("expected completed first child, got %q", firstRun.Status)
	}
	if store.experiment.CurrentIndex != 1 {
		t.Fatalf("expected experiment to advance to slot index 1, got %d", store.experiment.CurrentIndex)
	}
	if store.experiment.CompletedRuns != 1 {
		t.Fatalf("expected completed counter to increment, got %+v", store.experiment)
	}
	if store.createRunCalls != 2 {
		t.Fatalf("expected second child to start just in time, got %d create calls", store.createRunCalls)
	}
	if store.experiment.ActiveRunID == "" || store.experiment.ActiveRunID == firstRunID {
		t.Fatalf("expected a new active child run, got %+v", store.experiment)
	}
	if len(store.createdRuns) != 2 {
		t.Fatalf("expected both created child runs to be tracked, got %d", len(store.createdRuns))
	}
}

func TestUpdateRunStatusIgnoresDuplicateTerminalCallbackForExperimentChild(t *testing.T) {
	t.Parallel()

	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional": 1000.0,
			}),
		},
	}
	engine := &fakeEngine{}
	runner := &fakeRunner{}
	scenarios := &fakeScenarioClient{
		scenarios: map[string]simulation.ScenarioCatalogEntry{
			"baseline":   makeScenario("baseline", 1, 5, 2500),
			"range-chop": makeScenario("range-chop", 2, 9, 1800),
		},
	}
	service := simulation.NewService("paper-account-1", engine, store, runner, scenarios)

	experiment, err := service.CreateExperiment(context.Background(), simulation.CreateExperimentRequest{
		Name:        "Sequential lanes",
		Bots:        []simulation.ExperimentBotRequest{{BotID: "baseline-roundtrip"}},
		Scenarios:   []string{"baseline", "range-chop"},
		Repetitions: 1,
	})
	if err != nil {
		t.Fatalf("expected create experiment to succeed, got error: %v", err)
	}

	firstRunID := experiment.ActiveRunID
	if _, err := service.UpdateRunStatus(context.Background(), firstRunID, simulation.RunStatusUpdate{
		Status: simulation.RunStatusCompleted,
	}); err != nil {
		t.Fatalf("expected first child completion to succeed, got error: %v", err)
	}

	currentIndex := store.experiment.CurrentIndex
	completedRuns := store.experiment.CompletedRuns
	failedRuns := store.experiment.FailedRuns
	createRunCalls := store.createRunCalls
	activeRunID := store.experiment.ActiveRunID

	updatedRun, err := service.UpdateRunStatus(context.Background(), firstRunID, simulation.RunStatusUpdate{
		Status:       simulation.RunStatusFailed,
		ErrorMessage: "late callback",
	})
	if err != nil {
		t.Fatalf("expected duplicate terminal callback to be ignored, got error: %v", err)
	}

	if updatedRun.Status != simulation.RunStatusCompleted {
		t.Fatalf("expected original terminal status to be preserved, got %+v", updatedRun)
	}
	if store.experiment.CurrentIndex != currentIndex || store.experiment.CompletedRuns != completedRuns || store.experiment.FailedRuns != failedRuns {
		t.Fatalf("expected duplicate terminal callback not to advance experiment twice, got %+v", store.experiment)
	}
	if store.createRunCalls != createRunCalls {
		t.Fatalf("expected duplicate terminal callback not to create extra child runs, got %d", store.createRunCalls)
	}
	if store.experiment.ActiveRunID != activeRunID {
		t.Fatalf("expected active child run to stay unchanged, got %+v", store.experiment)
	}
}

func TestStopExperimentStopsActiveChildAndMarksExperimentStopped(t *testing.T) {
	t.Parallel()

	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional": 1000.0,
			}),
		},
	}
	engine := &fakeEngine{}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	experiment, err := service.CreateExperiment(context.Background(), simulation.CreateExperimentRequest{
		Name:        "Stop batch",
		Bots:        []simulation.ExperimentBotRequest{{BotID: "baseline-roundtrip"}},
		Scenarios:   []string{"baseline", "range-chop"},
		Repetitions: 1,
	})
	if err != nil {
		t.Fatalf("expected create experiment to succeed, got error: %v", err)
	}

	stoppedExperiment, err := service.StopExperiment(context.Background(), experiment.ExperimentID)
	if err != nil {
		t.Fatalf("expected stop experiment to succeed, got error: %v", err)
	}

	if len(runner.stopRunIDs) != 1 || runner.stopRunIDs[0] != experiment.ActiveRunID {
		t.Fatalf("expected active child run to be stopped, got %+v", runner.stopRunIDs)
	}
	if stoppedExperiment.Status != simulation.ExperimentStatusStopped {
		t.Fatalf("expected stopped experiment, got %q", stoppedExperiment.Status)
	}
	if stoppedExperiment.ActiveRunID != "" {
		t.Fatalf("expected no active run after stop, got %+v", stoppedExperiment)
	}
	if !stoppedExperiment.StopRequested {
		t.Fatalf("expected stop_requested to be persisted, got %+v", stoppedExperiment)
	}
	if stoppedExperiment.StoppedRuns != 1 || stoppedExperiment.CurrentIndex != 1 {
		t.Fatalf("expected stopped counters to advance, got %+v", stoppedExperiment)
	}
	if stoppedExperiment.CompletedAt == nil {
		t.Fatalf("expected terminal timestamp after stop, got %+v", stoppedExperiment)
	}
}

func TestCreateRunRejectedWhenQueuedExperimentExists(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	store := &fakeStore{
		bot: makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
			"trade_notional": 1000.0,
		}),
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID:  "sim-exp-queued",
				Name:          "Queued benchmark",
				Status:        simulation.ExperimentStatusQueued,
				PlannedRuns:   1,
				CreatedAt:     now,
				UpdatedAt:     now,
				QueuePosition: 1,
			},
			ExecutionProfileSnapshot: simulation.ExecutionProfile{
				InitialBalance: 10000,
			},
			Slots: []simulation.ExperimentRunSlot{
				{SlotIndex: 0, BotID: "baseline-roundtrip", BotName: "Baseline Roundtrip", BotVersion: "v1", ScenarioID: "baseline"},
			},
		},
	}

	service := simulation.NewService("paper-account-1", &fakeEngine{}, store, &fakeRunner{}, &fakeScenarioClient{})

	_, err := service.CreateRun(context.Background(), simulation.CreateRunRequest{
		BotID:      "baseline-roundtrip",
		ScenarioID: "baseline",
	})
	if err == nil {
		t.Fatal("expected queued experiment to block standalone run creation")
	}
	if !strings.Contains(err.Error(), simulation.ErrSimulationBusy.Error()) {
		t.Fatalf("expected simulation busy error, got %v", err)
	}
}

func TestCreateExperimentQueuesWhileStandaloneRunIsActive(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional": 1000.0,
			}),
		},
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:           "sim-run-busy",
				BotID:           "baseline-roundtrip",
				BotName:         "Baseline Roundtrip",
				BotVersion:      "v1",
				ScenarioID:      "baseline",
				SessionID:       "sim-run-busy",
				Status:          simulation.RunStatusRunning,
				LastHeartbeatAt: &now,
				StartedAt:       now,
				UpdatedAt:       now,
			},
		},
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "sim-run-busy",
			Status: papertrading.SessionStatusRunning,
		},
	}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	experiment, err := service.CreateExperiment(context.Background(), simulation.CreateExperimentRequest{
		Name:        "Queued benchmark",
		Bots:        []simulation.ExperimentBotRequest{{BotID: "baseline-roundtrip"}},
		Scenarios:   []string{"baseline"},
		Repetitions: 1,
	})
	if err != nil {
		t.Fatalf("expected queued experiment creation to succeed, got error: %v", err)
	}

	if experiment.Status != simulation.ExperimentStatusQueued {
		t.Fatalf("expected queued experiment, got %q", experiment.Status)
	}
	if experiment.QueuePosition != 1 {
		t.Fatalf("expected first queue position, got %+v", experiment)
	}
	if store.createRunCalls != 0 {
		t.Fatalf("expected no child run to start while standalone run is active, got %d", store.createRunCalls)
	}
	if len(runner.startRequests) != 0 {
		t.Fatalf("expected runner not to start queued child immediately, got %+v", runner.startRequests)
	}
}

func TestQueuedExperimentStartsAfterStandaloneRunCompletes(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional": 1000.0,
			}),
		},
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:           "sim-run-busy",
				BotID:           "baseline-roundtrip",
				BotName:         "Baseline Roundtrip",
				BotVersion:      "v1",
				ScenarioID:      "baseline",
				SessionID:       "sim-run-busy",
				Status:          simulation.RunStatusRunning,
				LastHeartbeatAt: &now,
				StartedAt:       now,
				UpdatedAt:       now,
			},
		},
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "sim-run-busy",
			Status: papertrading.SessionStatusRunning,
		},
	}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	experiment, err := service.CreateExperiment(context.Background(), simulation.CreateExperimentRequest{
		Name:        "Queued benchmark",
		Bots:        []simulation.ExperimentBotRequest{{BotID: "baseline-roundtrip"}},
		Scenarios:   []string{"baseline"},
		Repetitions: 1,
	})
	if err != nil {
		t.Fatalf("expected queued experiment creation to succeed, got error: %v", err)
	}
	if experiment.Status != simulation.ExperimentStatusQueued {
		t.Fatalf("expected queued experiment before standalone completion, got %+v", experiment)
	}

	_, err = service.UpdateRunStatus(context.Background(), "sim-run-busy", simulation.RunStatusUpdate{
		Status: simulation.RunStatusCompleted,
	})
	if err != nil {
		t.Fatalf("expected standalone completion to trigger queued experiment start, got error: %v", err)
	}

	if store.createRunCalls != 1 {
		t.Fatalf("expected queued experiment to start one child run after standalone completion, got %d", store.createRunCalls)
	}
	if store.experiment.Status != simulation.ExperimentStatusRunning {
		t.Fatalf("expected queued experiment to transition to running, got %+v", store.experiment)
	}
	if store.experiment.ActiveRunID == "" {
		t.Fatalf("expected queued experiment to own the new child run, got %+v", store.experiment)
	}
	if len(runner.startRequests) != 1 {
		t.Fatalf("expected runner to receive exactly one queued child start, got %+v", runner.startRequests)
	}
}

func TestStopQueuedExperimentMarksTerminalImmediately(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional": 1000.0,
			}),
		},
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:           "sim-run-busy",
				BotID:           "baseline-roundtrip",
				BotName:         "Baseline Roundtrip",
				BotVersion:      "v1",
				ScenarioID:      "baseline",
				SessionID:       "sim-run-busy",
				Status:          simulation.RunStatusRunning,
				LastHeartbeatAt: &now,
				StartedAt:       now,
				UpdatedAt:       now,
			},
		},
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "sim-run-busy",
			Status: papertrading.SessionStatusRunning,
		},
	}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	experiment, err := service.CreateExperiment(context.Background(), simulation.CreateExperimentRequest{
		Name:        "Queued benchmark",
		Bots:        []simulation.ExperimentBotRequest{{BotID: "baseline-roundtrip"}},
		Scenarios:   []string{"baseline"},
		Repetitions: 1,
	})
	if err != nil {
		t.Fatalf("expected queued experiment creation to succeed, got error: %v", err)
	}

	stoppedExperiment, err := service.StopExperiment(context.Background(), experiment.ExperimentID)
	if err != nil {
		t.Fatalf("expected queued experiment stop to succeed, got error: %v", err)
	}

	if stoppedExperiment.Status != simulation.ExperimentStatusStopped {
		t.Fatalf("expected queued experiment to stop immediately, got %+v", stoppedExperiment)
	}
	if !stoppedExperiment.StopRequested {
		t.Fatalf("expected stop_requested to persist on queued experiment, got %+v", stoppedExperiment)
	}
	if stoppedExperiment.CompletedAt == nil {
		t.Fatalf("expected queued experiment stop to persist completed_at, got %+v", stoppedExperiment)
	}
	if store.createRunCalls != 0 {
		t.Fatalf("expected queued experiment stop not to create child runs, got %d", store.createRunCalls)
	}
	if len(runner.stopRunIDs) != 0 {
		t.Fatalf("expected no child stop call for queued experiment, got %+v", runner.stopRunIDs)
	}
}

func TestHeartbeatRunPersistsTimestampForActiveRun(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 4, 21, 11, 0, 0, 0, time.UTC)
	store := &fakeStore{
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:      "sim-run-heartbeat",
				BotID:      "baseline-roundtrip",
				BotName:    "Baseline Roundtrip",
				BotVersion: "v1",
				ScenarioID: "baseline",
				SessionID:  "sim-run-heartbeat",
				Status:     simulation.RunStatusRunning,
				StartedAt:  now.Add(-time.Minute),
				UpdatedAt:  now.Add(-time.Minute),
			},
		},
	}
	service := simulation.NewService("paper-account-1", &fakeEngine{}, store, &fakeRunner{}, &fakeScenarioClient{})

	run, err := service.HeartbeatRun(context.Background(), "sim-run-heartbeat", now)
	if err != nil {
		t.Fatalf("expected heartbeat update to succeed, got error: %v", err)
	}

	if run.LastHeartbeatAt == nil || !run.LastHeartbeatAt.Equal(now) {
		t.Fatalf("expected heartbeat timestamp to persist, got %+v", run)
	}
}

func TestReconcileFailsStaleRunAsRunnerLost(t *testing.T) {
	t.Parallel()

	staleAt := time.Now().UTC().Add(-2 * time.Minute)
	store := &fakeStore{
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:           "sim-run-stale",
				BotID:           "baseline-roundtrip",
				BotName:         "Baseline Roundtrip",
				BotVersion:      "v1",
				ScenarioID:      "baseline",
				SessionID:       "sim-run-stale",
				Status:          simulation.RunStatusRunning,
				LastHeartbeatAt: &staleAt,
				StartedAt:       staleAt,
				UpdatedAt:       staleAt,
			},
		},
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "sim-run-stale",
			Status: papertrading.SessionStatusRunning,
		},
	}
	service := simulation.NewService("paper-account-1", engine, store, &fakeRunner{}, &fakeScenarioClient{})

	if err := service.Reconcile(context.Background()); err != nil {
		t.Fatalf("expected reconcile to fail stale run cleanly, got error: %v", err)
	}

	if store.run.Status != simulation.RunStatusFailed {
		t.Fatalf("expected stale run to be marked failed, got %+v", store.run)
	}
	if store.lastStoppedReason != "runner_lost" {
		t.Fatalf("expected runner_lost stop reason, got %q", store.lastStoppedReason)
	}
	if store.metrics == nil || store.metrics.TotalPnL != 75 {
		t.Fatalf("expected reconcile to persist report metrics, got %+v", store.metrics)
	}
	if engine.stopCalls != 1 {
		t.Fatalf("expected stale run reconcile to stop the in-memory session, got %d", engine.stopCalls)
	}
}

func TestRestoreSkipsDuplicateStartWhenActiveChildStillRunning(t *testing.T) {
	t.Parallel()

	startedAt := time.Date(2026, 4, 21, 9, 0, 0, 0, time.UTC)
	store := &fakeStore{
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID: "sim-exp-running",
				Name:         "Restore running",
				Status:       simulation.ExperimentStatusRunning,
				PlannedRuns:  2,
				ActiveRunID:  "sim-run-active",
				CreatedAt:    startedAt,
				UpdatedAt:    startedAt,
			},
			Slots: []simulation.ExperimentRunSlot{
				{SlotIndex: 0, BotID: "baseline-roundtrip", BotName: "Baseline Roundtrip", BotVersion: "v1", ScenarioID: "baseline"},
				{SlotIndex: 1, BotID: "baseline-roundtrip", BotName: "Baseline Roundtrip", BotVersion: "v1", ScenarioID: "range-chop"},
			},
		},
		runs: []simulation.RunDetail{
			{
				RunSummary: simulation.RunSummary{
					RunID:        "sim-run-active",
					ExperimentID: "sim-exp-running",
					BotID:        "baseline-roundtrip",
					BotName:      "Baseline Roundtrip",
					BotVersion:   "v1",
					ScenarioID:   "baseline",
					SessionID:    "sim-run-active",
					Status:       simulation.RunStatusRunning,
					StartedAt:    startedAt,
					UpdatedAt:    startedAt,
				},
			},
		},
	}
	engine := &fakeEngine{
		currentSession: papertrading.SimulationSession{
			ID:     "sim-run-active",
			Status: papertrading.SessionStatusRunning,
		},
	}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	if err := service.Restore(context.Background()); err != nil {
		t.Fatalf("expected restore to succeed, got error: %v", err)
	}

	if store.createRunCalls != 0 {
		t.Fatalf("expected restore not to start a duplicate child run, got %d create calls", store.createRunCalls)
	}
	if len(runner.startRequests) != 0 {
		t.Fatalf("expected runner not to receive duplicate start, got %+v", runner.startRequests)
	}
}

func TestRestoreResumesNextSlotWhenActiveChildAlreadyTerminal(t *testing.T) {
	t.Parallel()

	startedAt := time.Date(2026, 4, 21, 9, 0, 0, 0, time.UTC)
	store := &fakeStore{
		bots: map[string]simulation.BotDetail{
			"baseline-roundtrip": makeBotDetail("baseline-roundtrip", "Baseline Roundtrip", "baseline", map[string]any{
				"trade_notional": 1000.0,
			}),
		},
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID:  "sim-exp-restore",
				Name:          "Restore terminal child",
				Status:        simulation.ExperimentStatusRunning,
				PlannedRuns:   2,
				ActiveRunID:   "sim-run-completed",
				CompletedRuns: 0,
				CreatedAt:     startedAt,
				UpdatedAt:     startedAt,
			},
			ExecutionProfileSnapshot: simulation.ExecutionProfile{
				InitialBalance: 10000,
			},
			Slots: []simulation.ExperimentRunSlot{
				{SlotIndex: 0, BotID: "baseline-roundtrip", BotName: "Baseline Roundtrip", BotVersion: "v1", ScenarioID: "baseline", ConfigSnapshot: map[string]any{"trade_notional": 1000.0}},
				{SlotIndex: 1, BotID: "baseline-roundtrip", BotName: "Baseline Roundtrip", BotVersion: "v1", ScenarioID: "range-chop", ConfigSnapshot: map[string]any{"trade_notional": 1000.0}},
			},
		},
		runs: []simulation.RunDetail{
			{
				RunSummary: simulation.RunSummary{
					RunID:        "sim-run-completed",
					ExperimentID: "sim-exp-restore",
					BotID:        "baseline-roundtrip",
					BotName:      "Baseline Roundtrip",
					BotVersion:   "v1",
					ScenarioID:   "baseline",
					SessionID:    "sim-run-completed",
					Status:       simulation.RunStatusCompleted,
					StartedAt:    startedAt,
					UpdatedAt:    startedAt,
				},
				MetricsSnapshot: &simulation.RunMetricsSummary{TotalPnL: 75, MaxDrawdown: 10},
			},
		},
	}
	engine := &fakeEngine{}
	runner := &fakeRunner{}
	service := simulation.NewService("paper-account-1", engine, store, runner, &fakeScenarioClient{})

	if err := service.Restore(context.Background()); err != nil {
		t.Fatalf("expected restore to succeed, got error: %v", err)
	}

	if store.experiment.CompletedRuns != 1 {
		t.Fatalf("expected restore to account for the completed child, got %+v", store.experiment)
	}
	if store.experiment.CurrentIndex != 1 {
		t.Fatalf("expected restore to resume at the next slot, got %+v", store.experiment)
	}
	if store.createRunCalls != 1 || store.experiment.ActiveRunID == "" {
		t.Fatalf("expected restore to start the next child run, got createRunCalls=%d experiment=%+v", store.createRunCalls, store.experiment)
	}
}

func TestGetExperimentSummaryAggregatesByLane(t *testing.T) {
	t.Parallel()

	startedAt := time.Date(2026, 4, 21, 9, 0, 0, 0, time.UTC)
	store := &fakeStore{
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID:  "sim-exp-summary",
				Name:          "Summary batch",
				Status:        simulation.ExperimentStatusCompleted,
				PlannedRuns:   4,
				CompletedRuns: 2,
				FailedRuns:    1,
				StoppedRuns:   1,
				CreatedAt:     startedAt,
				UpdatedAt:     startedAt,
			},
			Slots: []simulation.ExperimentRunSlot{
				{SlotIndex: 0, BotID: "baseline-roundtrip", BotVersion: "v1", ScenarioID: "baseline"},
				{SlotIndex: 1, BotID: "baseline-roundtrip", BotVersion: "v1", ScenarioID: "baseline"},
				{SlotIndex: 2, BotID: "buy-and-hold", BotVersion: "v1", ScenarioID: "range-chop"},
				{SlotIndex: 3, BotID: "buy-and-hold", BotVersion: "v1", ScenarioID: "range-chop"},
			},
		},
		runs: []simulation.RunDetail{
			{
				RunSummary: simulation.RunSummary{
					RunID:        "sim-run-1",
					ExperimentID: "sim-exp-summary",
					BotID:        "baseline-roundtrip",
					BotName:      "Baseline Roundtrip",
					BotVersion:   "v1",
					ScenarioID:   "baseline",
					SessionID:    "sim-run-1",
					Status:       simulation.RunStatusCompleted,
					StartedAt:    startedAt,
					UpdatedAt:    startedAt,
				},
				MetricsSnapshot: &simulation.RunMetricsSummary{TotalPnL: 100, MaxDrawdown: 10},
			},
			{
				RunSummary: simulation.RunSummary{
					RunID:        "sim-run-2",
					ExperimentID: "sim-exp-summary",
					BotID:        "baseline-roundtrip",
					BotName:      "Baseline Roundtrip",
					BotVersion:   "v1",
					ScenarioID:   "baseline",
					SessionID:    "sim-run-2",
					Status:       simulation.RunStatusCompleted,
					StartedAt:    startedAt.Add(time.Minute),
					UpdatedAt:    startedAt.Add(time.Minute),
				},
				MetricsSnapshot: &simulation.RunMetricsSummary{TotalPnL: 40, MaxDrawdown: 30},
			},
			{
				RunSummary: simulation.RunSummary{
					RunID:        "sim-run-3",
					ExperimentID: "sim-exp-summary",
					BotID:        "buy-and-hold",
					BotName:      "Buy And Hold",
					BotVersion:   "v1",
					ScenarioID:   "range-chop",
					SessionID:    "sim-run-3",
					Status:       simulation.RunStatusFailed,
					StartedAt:    startedAt,
					UpdatedAt:    startedAt,
				},
			},
			{
				RunSummary: simulation.RunSummary{
					RunID:        "sim-run-4",
					ExperimentID: "sim-exp-summary",
					BotID:        "buy-and-hold",
					BotName:      "Buy And Hold",
					BotVersion:   "v1",
					ScenarioID:   "range-chop",
					SessionID:    "sim-run-4",
					Status:       simulation.RunStatusStopped,
					StartedAt:    startedAt.Add(time.Minute),
					UpdatedAt:    startedAt.Add(time.Minute),
				},
			},
		},
	}
	service := simulation.NewService("paper-account-1", &fakeEngine{}, store, &fakeRunner{}, &fakeScenarioClient{})

	rows, err := service.GetExperimentSummary("sim-exp-summary")
	if err != nil {
		t.Fatalf("expected experiment summary to succeed, got error: %v", err)
	}

	if len(rows) != 2 {
		t.Fatalf("expected two aggregate rows, got %+v", rows)
	}

	if rows[0].BotID != "baseline-roundtrip" || rows[0].ScenarioID != "baseline" {
		t.Fatalf("expected baseline row first, got %+v", rows[0])
	}
	if rows[0].ScheduledRuns != 2 || rows[0].CompletedRuns != 2 || rows[0].FailedRuns != 0 || rows[0].StoppedRuns != 0 {
		t.Fatalf("unexpected baseline counters %+v", rows[0])
	}
	if rows[0].AvgTotalPnL != 70 || rows[0].BestTotalPnL != 100 || rows[0].WorstTotalPnL != 40 || rows[0].AvgMaxDrawdown != 20 {
		t.Fatalf("unexpected baseline aggregates %+v", rows[0])
	}

	if rows[1].BotID != "buy-and-hold" || rows[1].ScenarioID != "range-chop" {
		t.Fatalf("expected range row second, got %+v", rows[1])
	}
	if rows[1].ScheduledRuns != 2 || rows[1].CompletedRuns != 0 || rows[1].FailedRuns != 1 || rows[1].StoppedRuns != 1 {
		t.Fatalf("unexpected range counters %+v", rows[1])
	}
	if rows[1].AvgTotalPnL != 0 || rows[1].BestTotalPnL != 0 || rows[1].WorstTotalPnL != 0 || rows[1].AvgMaxDrawdown != 0 {
		t.Fatalf("expected zeroed aggregates without completed runs, got %+v", rows[1])
	}
}

type fakeEngine struct {
	currentSession papertrading.SimulationSession
	startCalls     int
	stopCalls      int
	lastProfile    papertrading.SessionExecutionProfile
}

func (f *fakeEngine) StartSession(sessionID string) (papertrading.SimulationSession, error) {
	return f.StartSessionWithProfile(sessionID, papertrading.SessionExecutionProfile{
		InitialBalance: 10000,
		Rules:          papertrading.SimulationRules{},
	})
}

func (f *fakeEngine) StartSessionWithProfile(sessionID string, profile papertrading.SessionExecutionProfile) (papertrading.SimulationSession, error) {
	f.startCalls++
	f.lastProfile = profile
	f.currentSession = papertrading.SimulationSession{
		ID:          sessionID,
		Status:      papertrading.SessionStatusRunning,
		StartedAt:   time.Now().UTC(),
		LastEventAt: time.Now().UTC(),
	}
	return f.currentSession, nil
}

func (f *fakeEngine) StopSession() (papertrading.SimulationSession, error) {
	f.stopCalls++
	now := time.Now().UTC()
	f.currentSession.Status = papertrading.SessionStatusStopped
	f.currentSession.StoppedAt = &now
	return f.currentSession, nil
}

func (f *fakeEngine) SessionSummary() papertrading.SimulationSession {
	return f.currentSession
}

func (f *fakeEngine) ReportBySession(_ string) (papertrading.SessionReport, error) {
	return papertrading.SessionReport{
		SessionID:       f.currentSession.ID,
		Status:          f.currentSession.Status,
		FilledOrders:    2,
		RejectedSignals: 0,
		FeesPaid:        1.5,
		SlippageCost:    0.5,
		RealizedPnL:     50,
		UnrealizedPnL:   25,
		TotalPnL:        75,
		MaxDrawdown:     10,
	}, nil
}

func (f *fakeEngine) DefaultRulesSummary() papertrading.RulesSummary {
	return papertrading.RulesSummary{
		PaperAccountID: "paper-account-1",
		InitialBalance: 10000,
		FeeRate:        0.001,
		SlippageRate:   0.002,
		RiskControls:   papertrading.RiskControls{},
	}
}

type fakeStore struct {
	bots                  map[string]simulation.BotDetail
	bot                   simulation.BotDetail
	runs                  []simulation.RunDetail
	run                   simulation.RunDetail
	leaderboard           []simulation.LeaderboardEntry
	experiment            simulation.ExperimentDetail
	createdRun            simulation.RunDetail
	createdRuns           []simulation.RunDetail
	createRunCalls        int
	updatedStatus         simulation.RunStatus
	completedAt           *time.Time
	metrics               *simulation.RunMetricsSummary
	lastRunFilter         simulation.RunFilter
	lastLeaderboardFilter simulation.LeaderboardFilter
	lastExperimentFilter  simulation.ExperimentFilter
	lastErrorMessage      string
	lastStoppedReason     string
}

func (f *fakeStore) ListBots() ([]simulation.BotSummary, error) {
	if len(f.bots) > 0 {
		bots := make([]simulation.BotSummary, 0, len(f.bots))
		for _, bot := range f.bots {
			bots = append(bots, bot.BotSummary)
		}
		return bots, nil
	}
	return []simulation.BotSummary{f.bot.BotSummary}, nil
}

func (f *fakeStore) GetBot(botID string) (simulation.BotDetail, bool, error) {
	if len(f.bots) > 0 {
		bot, found := f.bots[botID]
		return bot, found, nil
	}
	if f.bot.BotID != botID {
		return simulation.BotDetail{}, false, nil
	}
	return f.bot, true, nil
}

func (f *fakeStore) ListRuns(_ string, filter simulation.RunFilter) ([]simulation.RunSummary, error) {
	filter = simulation.NormalizeRunFilter(filter)
	f.lastRunFilter = filter

	runs := make([]simulation.RunSummary, 0)
	for _, run := range f.allRuns() {
		if filter.Status != "" && run.Status != filter.Status {
			continue
		}
		if filter.Query != "" && !strings.Contains(run.RunID, filter.Query) && !strings.Contains(run.SessionID, filter.Query) {
			continue
		}
		if filter.BotID != "" && run.BotID != filter.BotID {
			continue
		}
		if filter.BotVersion != "" && run.BotVersion != filter.BotVersion {
			continue
		}
		if filter.ScenarioID != "" && run.ScenarioID != filter.ScenarioID {
			continue
		}
		if filter.ExperimentID != "" && run.ExperimentID != filter.ExperimentID {
			continue
		}
		runs = append(runs, run.RunSummary)
	}
	return runs, nil
}

func (f *fakeStore) GetRun(_ string, runID string) (simulation.RunDetail, bool, error) {
	for _, run := range f.allRuns() {
		if run.RunID == runID {
			return run, true, nil
		}
	}
	return simulation.RunDetail{}, false, nil
}

func (f *fakeStore) allRuns() []simulation.RunDetail {
	if len(f.runs) > 0 {
		return f.runs
	}
	runs := make([]simulation.RunDetail, 0, 2)
	if f.run.RunID != "" {
		runs = append(runs, f.run)
	}
	if f.createdRun.RunID != "" && f.createdRun.RunID != f.run.RunID {
		runs = append(runs, f.createdRun)
	}
	return runs
}

func (f *fakeStore) FindActiveRun(_ string) (simulation.RunDetail, bool, error) {
	for _, run := range f.allRuns() {
		if !run.Status.IsTerminal() {
			return run, true, nil
		}
	}
	return simulation.RunDetail{}, false, nil
}

func (f *fakeStore) ListLeaderboard(_ string, filter simulation.LeaderboardFilter) ([]simulation.LeaderboardEntry, error) {
	f.lastLeaderboardFilter = filter
	return f.leaderboard, nil
}

func (f *fakeStore) CreateRun(_ string, run simulation.RunDetail) error {
	f.createRunCalls++
	f.createdRun = run
	f.createdRuns = append(f.createdRuns, run)
	if len(f.runs) > 0 {
		f.runs = append(f.runs, run)
	} else if f.run.RunID == "" {
		f.run = run
	}
	return nil
}

func (f *fakeStore) UpdateRunStatus(_ string, runID string, status simulation.RunStatus, errorMessage string, stoppedReason string, completedAt *time.Time, metrics *simulation.RunMetricsSummary) error {
	f.lastErrorMessage = strings.TrimSpace(errorMessage)
	f.lastStoppedReason = strings.TrimSpace(stoppedReason)
	f.updatedStatus = status
	f.completedAt = completedAt
	f.metrics = metrics
	if f.run.RunID == runID {
		f.run.Status = status
		f.run.CompletedAt = completedAt
		f.run.MetricsSnapshot = metrics
	}
	if f.createdRun.RunID == runID {
		f.createdRun.Status = status
		f.createdRun.CompletedAt = completedAt
		f.createdRun.MetricsSnapshot = metrics
	}
	for index := range f.createdRuns {
		if f.createdRuns[index].RunID == runID {
			f.createdRuns[index].Status = status
			f.createdRuns[index].CompletedAt = completedAt
			f.createdRuns[index].MetricsSnapshot = metrics
		}
	}
	for index := range f.runs {
		if f.runs[index].RunID == runID {
			f.runs[index].Status = status
			f.runs[index].CompletedAt = completedAt
			f.runs[index].MetricsSnapshot = metrics
		}
	}
	return nil
}

func (f *fakeStore) UpdateRunHeartbeat(_ string, runID string, heartbeatAt time.Time) error {
	if f.run.RunID == runID {
		f.run.LastHeartbeatAt = &heartbeatAt
	}
	if f.createdRun.RunID == runID {
		f.createdRun.LastHeartbeatAt = &heartbeatAt
	}
	for index := range f.createdRuns {
		if f.createdRuns[index].RunID == runID {
			f.createdRuns[index].LastHeartbeatAt = &heartbeatAt
		}
	}
	for index := range f.runs {
		if f.runs[index].RunID == runID {
			f.runs[index].LastHeartbeatAt = &heartbeatAt
		}
	}
	return nil
}

func (f *fakeStore) ListExperiments(_ string, filter simulation.ExperimentFilter) ([]simulation.ExperimentSummary, error) {
	f.lastExperimentFilter = filter
	if f.experiment.ExperimentID == "" {
		return nil, nil
	}
	return []simulation.ExperimentSummary{f.experiment.ExperimentSummary}, nil
}

func (f *fakeStore) ListQueuedExperiments(_ string) ([]simulation.ExperimentSummary, error) {
	if f.experiment.ExperimentID != "" && f.experiment.Status == simulation.ExperimentStatusQueued {
		return []simulation.ExperimentSummary{f.experiment.ExperimentSummary}, nil
	}
	return nil, nil
}

func (f *fakeStore) GetExperiment(_ string, experimentID string) (simulation.ExperimentDetail, bool, error) {
	if f.experiment.ExperimentID == experimentID {
		return f.experiment, true, nil
	}
	return simulation.ExperimentDetail{}, false, nil
}

func (f *fakeStore) FindActiveExperiment(_ string) (simulation.ExperimentDetail, bool, error) {
	if f.experiment.ExperimentID != "" && (f.experiment.Status == simulation.ExperimentStatusStarting || f.experiment.Status == simulation.ExperimentStatusRunning) {
		return f.experiment, true, nil
	}
	return simulation.ExperimentDetail{}, false, nil
}

func (f *fakeStore) CreateExperiment(_ string, experiment simulation.ExperimentDetail) error {
	f.experiment = experiment
	return nil
}

func (f *fakeStore) UpdateExperiment(_ string, experiment simulation.ExperimentDetail) error {
	f.experiment = experiment
	return nil
}

type fakeRunner struct {
	startRequest  simulation.RunnerStartRequest
	startRequests []simulation.RunnerStartRequest
	stopRunID     string
	stopRunIDs    []string
}

func (f *fakeRunner) StartRun(_ context.Context, request simulation.RunnerStartRequest) error {
	f.startRequest = request
	f.startRequests = append(f.startRequests, request)
	return nil
}

func (f *fakeRunner) StopRun(_ context.Context, runID string) error {
	f.stopRunID = runID
	f.stopRunIDs = append(f.stopRunIDs, runID)
	return nil
}

type fakeScenarioClient struct {
	scenarios map[string]simulation.ScenarioCatalogEntry
}

func (f *fakeScenarioClient) GetScenario(_ context.Context, scenarioID string) (simulation.ScenarioCatalogEntry, error) {
	if len(f.scenarios) > 0 {
		scenario, found := f.scenarios[scenarioID]
		if found {
			return scenario, nil
		}
		return simulation.ScenarioCatalogEntry{}, simulation.ErrInvalidScenarioID
	}
	return simulation.ScenarioCatalogEntry{
		ScenarioID: scenarioID,
		MicrostructureProfile: simulation.MarketMicrostructureProfile{
			SignalLatencyTicks:     1,
			SpreadBps:              5,
			MaxFillNotionalPerTick: 2500,
		},
	}, nil
}

func makeBotDetail(botID string, name string, defaultScenario string, defaultConfig map[string]any) simulation.BotDetail {
	return simulation.BotDetail{
		BotSummary: simulation.BotSummary{
			BotID:           botID,
			Name:            name,
			CurrentVersion:  "v1",
			DefaultScenario: defaultScenario,
		},
		Versions: []simulation.BotVersion{
			{
				BotID:         botID,
				Version:       "v1",
				DefaultConfig: defaultConfig,
			},
		},
	}
}

func makeScenario(scenarioID string, latencyTicks int, spreadBps float64, maxFillNotional float64) simulation.ScenarioCatalogEntry {
	return simulation.ScenarioCatalogEntry{
		ScenarioID: scenarioID,
		Name:       scenarioID,
		MicrostructureProfile: simulation.MarketMicrostructureProfile{
			SignalLatencyTicks:     latencyTicks,
			SpreadBps:              spreadBps,
			MaxFillNotionalPerTick: maxFillNotional,
		},
	}
}
