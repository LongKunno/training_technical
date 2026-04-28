package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"crypto_simulator/core_trading/internal/handlers"
	"crypto_simulator/core_trading/internal/papertrading"
	"crypto_simulator/core_trading/internal/simulation"
)

func TestSimulationRunsHandlerParsesExpandedFilters(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		runs: []simulation.RunSummary{
			{
				RunID:      "sim-run-1",
				BotID:      "buy-and-hold",
				BotName:    "Buy And Hold",
				BotVersion: "v1",
				ScenarioID: "trend-up",
				SessionID:  "sim-run-1",
				Status:     simulation.RunStatusRunning,
				StartedAt:  time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
				UpdatedAt:  time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
			},
		},
	}

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/sim/runs?status=running&q=sim-run&bot_id=buy-and-hold&bot_version=v1&scenario_id=trend-up&experiment_id=sim-exp-1&limit=10&offset=5",
		nil,
	)
	recorder := httptest.NewRecorder()

	handlers.NewSimulationRunsHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if service.lastRunFilter.Status != simulation.RunStatusRunning {
		t.Fatalf("expected running filter, got %+v", service.lastRunFilter)
	}
	if service.lastRunFilter.Query != "sim-run" || service.lastRunFilter.BotID != "buy-and-hold" {
		t.Fatalf("expected query and bot filters, got %+v", service.lastRunFilter)
	}
	if service.lastRunFilter.BotVersion != "v1" || service.lastRunFilter.ScenarioID != "trend-up" {
		t.Fatalf("expected bot version and scenario filters, got %+v", service.lastRunFilter)
	}
	if service.lastRunFilter.ExperimentID != "sim-exp-1" {
		t.Fatalf("expected experiment filter to be parsed, got %+v", service.lastRunFilter)
	}
	if service.lastRunFilter.Limit != 10 || service.lastRunFilter.Offset != 5 {
		t.Fatalf("expected pagination to be parsed, got %+v", service.lastRunFilter)
	}

	var payload struct {
		Runs []simulation.RunSummary `json:"runs"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode runs payload: %v", err)
	}
	if len(payload.Runs) != 1 || payload.Runs[0].RunID != "sim-run-1" {
		t.Fatalf("unexpected runs payload %+v", payload.Runs)
	}
}

func TestSimulationRunsHandlerRejectsInvalidStatus(t *testing.T) {
	t.Parallel()

	req := httptest.NewRequest(http.MethodGet, "/api/sim/runs?status=paused", nil)
	recorder := httptest.NewRecorder()

	handlers.NewSimulationRunsHandler(&fakeSimulationService{}).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Code)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode error payload: %v", err)
	}
	if payload.Error.Code != "invalid_run_status" {
		t.Fatalf("expected invalid_run_status, got %+v", payload.Error)
	}
}

func TestSimulationRunsHandlerDecodesExecutionProfileCreateRequest(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:      "sim-run-99",
				BotID:      "moving-average-cross",
				BotName:    "Moving Average Cross",
				BotVersion: "v1",
				ScenarioID: "range-chop",
				SessionID:  "sim-run-99",
				Status:     simulation.RunStatusRunning,
				StartedAt:  time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
				UpdatedAt:  time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
			},
		},
	}

	body := bytes.NewBufferString(`{
		"bot_id":"moving-average-cross",
		"bot_version":"v1",
		"scenario_id":"range-chop",
		"config":{"trade_notional":750,"fast_window":2,"slow_window":4},
		"execution_profile":{
			"initial_balance":15000,
			"fee_rate":0.0015,
			"slippage_rate":0.0025,
			"risk_controls":{
				"allowed_symbols":["BTCUSDT","ETHUSDT"],
				"max_position_quantity":5,
				"max_order_notional":5000,
				"max_daily_loss":2500,
				"cooldown_seconds":0,
				"max_open_notional":7000
			}
		}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/sim/runs", body)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationRunsHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}
	if service.createRunRequest.BotID != "moving-average-cross" || service.createRunRequest.BotVersion != "v1" {
		t.Fatalf("expected bot identity to be decoded, got %+v", service.createRunRequest)
	}
	if service.createRunRequest.Config["trade_notional"] != float64(750) {
		t.Fatalf("expected legacy config alias to be decoded, got %+v", service.createRunRequest.Config)
	}
	if service.createRunRequest.ExecutionProfile == nil || service.createRunRequest.ExecutionProfile.InitialBalance == nil {
		t.Fatalf("expected execution profile input to be decoded, got %+v", service.createRunRequest.ExecutionProfile)
	}
	if *service.createRunRequest.ExecutionProfile.InitialBalance != 15000 {
		t.Fatalf("expected overridden initial balance, got %+v", service.createRunRequest.ExecutionProfile)
	}
	if service.createRunRequest.ExecutionProfile.RiskControls == nil || len(service.createRunRequest.ExecutionProfile.RiskControls.AllowedSymbols) != 2 {
		t.Fatalf("expected risk controls to be decoded, got %+v", service.createRunRequest.ExecutionProfile)
	}
}

func TestSimulationRunDetailHandlerReturnsContractSnapshots(t *testing.T) {
	t.Parallel()

	completedAt := time.Date(2026, 4, 25, 9, 30, 0, 0, time.UTC)
	service := &fakeSimulationService{
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:       "sim-run-detail",
				BotID:       "moving-average-cross",
				BotName:     "Moving Average Cross",
				BotVersion:  "v1",
				ScenarioID:  "range-chop",
				SessionID:   "paper-session-detail",
				Status:      simulation.RunStatusCompleted,
				StartedAt:   completedAt.Add(-30 * time.Minute),
				CompletedAt: &completedAt,
				UpdatedAt:   completedAt,
			},
			ConfigSnapshot: map[string]any{
				"fast_window":    float64(2),
				"slow_window":    float64(4),
				"trade_notional": float64(750),
			},
			ExecutionProfileSnapshot: simulation.ExecutionProfile{
				InitialBalance: 15000,
				FeeRate:        0.0015,
				SlippageRate:   0.0025,
				RiskControls: papertrading.RiskControls{
					AllowedSymbols:   []string{"BTCUSDT", "ETHUSDT"},
					MaxOrderNotional: 5000,
					MaxOpenNotional:  7000,
				},
			},
			MarketProfileSnapshot: simulation.MarketMicrostructureProfile{
				SignalLatencyTicks:     1,
				SpreadBps:              5,
				MaxFillNotionalPerTick: 1000,
				LiquidityCurve: []simulation.LiquidityCurvePoint{
					{MaxNotional: 1000, FillRatio: 0.5},
				},
				QueuePriority:         0.75,
				MarketImpactBpsPer10k: 2.5,
				CancelAfterTicks:      3,
			},
			MetricsSnapshot: &simulation.RunMetricsSummary{
				FilledOrders: 2,
				TotalPnL:     123.45,
				MaxDrawdown:  12,
			},
			StoppedReason: "completed",
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sim/runs/sim-run-detail", nil)
	req.SetPathValue("runID", "sim-run-detail")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationRunDetailHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Run simulation.RunDetail `json:"run"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode run detail payload: %v", err)
	}
	if payload.Run.RunID != "sim-run-detail" || payload.Run.SessionID != "paper-session-detail" {
		t.Fatalf("unexpected run identity in payload %+v", payload.Run.RunSummary)
	}
	if payload.Run.ConfigSnapshot["trade_notional"] != float64(750) {
		t.Fatalf("expected config snapshot to survive response, got %+v", payload.Run.ConfigSnapshot)
	}
	if payload.Run.ExecutionProfileSnapshot.InitialBalance != 15000 || len(payload.Run.ExecutionProfileSnapshot.RiskControls.AllowedSymbols) != 2 {
		t.Fatalf("expected execution profile snapshot, got %+v", payload.Run.ExecutionProfileSnapshot)
	}
	if payload.Run.MarketProfileSnapshot.CancelAfterTicks != 3 || len(payload.Run.MarketProfileSnapshot.LiquidityCurve) != 1 {
		t.Fatalf("expected market profile snapshot, got %+v", payload.Run.MarketProfileSnapshot)
	}
	if payload.Run.MetricsSnapshot == nil || payload.Run.MetricsSnapshot.TotalPnL != 123.45 {
		t.Fatalf("expected metrics snapshot, got %+v", payload.Run.MetricsSnapshot)
	}
	if payload.Run.StoppedReason != "completed" {
		t.Fatalf("expected stopped reason completed, got %q", payload.Run.StoppedReason)
	}
}

func TestSimulationLeaderboardHandlerParsesFilters(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		leaderboard: []simulation.LeaderboardEntry{
			{
				RunSummary: simulation.RunSummary{
					RunID:      "sim-run-7",
					BotID:      "buy-and-hold",
					BotName:    "Buy And Hold",
					BotVersion: "v1",
					ScenarioID: "trend-up",
					SessionID:  "sim-run-7",
					Status:     simulation.RunStatusCompleted,
					StartedAt:  time.Date(2026, 4, 21, 9, 0, 0, 0, time.UTC),
					UpdatedAt:  time.Date(2026, 4, 21, 9, 30, 0, 0, time.UTC),
				},
				MetricsSnapshot: simulation.RunMetricsSummary{
					TotalPnL:    320,
					MaxDrawdown: 45,
				},
			},
		},
	}

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/sim/leaderboard?bot_id=buy-and-hold&bot_version=v1&scenario_id=trend-up&limit=5&offset=2",
		nil,
	)
	recorder := httptest.NewRecorder()

	handlers.NewSimulationLeaderboardHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if service.lastLeaderboardFilter.BotID != "buy-and-hold" || service.lastLeaderboardFilter.BotVersion != "v1" || service.lastLeaderboardFilter.ScenarioID != "trend-up" {
		t.Fatalf("expected leaderboard filters, got %+v", service.lastLeaderboardFilter)
	}
	if service.lastLeaderboardFilter.Limit != 5 || service.lastLeaderboardFilter.Offset != 2 {
		t.Fatalf("expected leaderboard pagination, got %+v", service.lastLeaderboardFilter)
	}

	var payload struct {
		Rows []simulation.LeaderboardEntry `json:"rows"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode leaderboard payload: %v", err)
	}
	if len(payload.Rows) != 1 || payload.Rows[0].MetricsSnapshot.TotalPnL != 320 {
		t.Fatalf("unexpected leaderboard payload %+v", payload.Rows)
	}
}

func TestSimulationExperimentsHandlerParsesExpandedFilters(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID: "sim-exp-1",
				Name:         "Baseline matrix",
				Status:       simulation.ExperimentStatusRunning,
				PlannedRuns:  4,
				CreatedAt:    time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
				UpdatedAt:    time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
			},
		},
	}

	req := httptest.NewRequest(
		http.MethodGet,
		"/api/sim/experiments?status=running&q=baseline&limit=5&offset=2",
		nil,
	)
	recorder := httptest.NewRecorder()

	handlers.NewSimulationExperimentsHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if service.lastExperimentFilter.Status != simulation.ExperimentStatusRunning {
		t.Fatalf("expected running experiment filter, got %+v", service.lastExperimentFilter)
	}
	if service.lastExperimentFilter.Query != "baseline" {
		t.Fatalf("expected query to be parsed, got %+v", service.lastExperimentFilter)
	}
	if service.lastExperimentFilter.Limit != 5 || service.lastExperimentFilter.Offset != 2 {
		t.Fatalf("expected experiment pagination, got %+v", service.lastExperimentFilter)
	}

	var payload struct {
		Experiments []simulation.ExperimentSummary `json:"experiments"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode experiments payload: %v", err)
	}
	if len(payload.Experiments) != 1 || payload.Experiments[0].ExperimentID != "sim-exp-1" {
		t.Fatalf("unexpected experiments payload %+v", payload.Experiments)
	}
}

func TestSimulationExperimentsHandlerDecodesCreateRequest(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID: "sim-exp-created",
				Name:         "Matrix batch",
				Status:       simulation.ExperimentStatusRunning,
				PlannedRuns:  4,
				CreatedAt:    time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
				UpdatedAt:    time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
			},
		},
	}

	body := bytes.NewBufferString(`{
		"name":"Matrix batch",
		"bots":[
			{"bot_id":"buy-and-hold","bot_version":"v1","config":{"trade_notional":750}},
			{"bot_id":"moving-average-cross","bot_version":"v1","bot_config":{"trade_notional":500,"fast_window":2,"slow_window":4}}
		],
		"scenarios":["trend-up","range-chop"],
		"repetitions":2,
		"execution_profile":{
			"initial_balance":15000,
			"fee_rate":0.0015,
			"slippage_rate":0.0025,
			"risk_controls":{
				"allowed_symbols":["BTCUSDT","ETHUSDT"],
				"max_position_quantity":5,
				"max_order_notional":5000,
				"max_daily_loss":2500,
				"cooldown_seconds":0,
				"max_open_notional":7000
			}
		}
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/sim/experiments", body)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationExperimentsHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}
	if service.createExperimentRequest.Name != "Matrix batch" || service.createExperimentRequest.Repetitions != 2 {
		t.Fatalf("expected experiment request to decode, got %+v", service.createExperimentRequest)
	}
	if len(service.createExperimentRequest.Bots) != 2 || len(service.createExperimentRequest.Scenarios) != 2 {
		t.Fatalf("expected bot/scenario matrix to decode, got %+v", service.createExperimentRequest)
	}
	if got := service.createExperimentRequest.Bots[0].Config["trade_notional"]; got != float64(750) {
		t.Fatalf("expected legacy config alias on first bot, got %+v", service.createExperimentRequest.Bots[0])
	}
	if got := service.createExperimentRequest.Bots[1].BotConfig["slow_window"]; got != float64(4) {
		t.Fatalf("expected bot_config on second bot, got %+v", service.createExperimentRequest.Bots[1])
	}
	if service.createExperimentRequest.ExecutionProfile == nil || service.createExperimentRequest.ExecutionProfile.InitialBalance == nil {
		t.Fatalf("expected execution profile to decode, got %+v", service.createExperimentRequest.ExecutionProfile)
	}
	if *service.createExperimentRequest.ExecutionProfile.InitialBalance != 15000 {
		t.Fatalf("expected overridden initial balance, got %+v", service.createExperimentRequest.ExecutionProfile)
	}
}

func TestSimulationExperimentsHandlerReturnsSimulationBusy(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		createExperimentErr: simulation.ErrSimulationBusy,
	}

	body := bytes.NewBufferString(`{"name":"busy","bots":[{"bot_id":"buy-and-hold"}],"scenarios":["trend-up"],"repetitions":1}`)
	req := httptest.NewRequest(http.MethodPost, "/api/sim/experiments", body)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationExperimentsHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, recorder.Code)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode busy error payload: %v", err)
	}
	if payload.Error.Code != "simulation_busy" {
		t.Fatalf("expected simulation_busy error code, got %+v", payload.Error)
	}
}

func TestSimulationExperimentSummaryHandlerReturnsRows(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		summaryRows: []simulation.ExperimentSummaryRow{
			{
				BotID:          "buy-and-hold",
				BotVersion:     "v1",
				ScenarioID:     "trend-up",
				ScheduledRuns:  2,
				CompletedRuns:  2,
				FailedRuns:     0,
				StoppedRuns:    0,
				AvgTotalPnL:    150,
				BestTotalPnL:   200,
				WorstTotalPnL:  100,
				StdDevTotalPnL: 70.71,
				CI95TotalPnL:   98,
				AvgMaxDrawdown: 12,
				AvgFillRatio:   0.95,
				AvgSlippageBps: 3.5,
				AvgCancelRate:  0.05,
				FailureRate:    0,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sim/experiments/sim-exp-1/summary", nil)
	req.SetPathValue("experimentID", "sim-exp-1")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationExperimentSummaryHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if service.lastSummaryExperimentID != "sim-exp-1" {
		t.Fatalf("expected summary handler to forward experiment id, got %q", service.lastSummaryExperimentID)
	}

	var payload struct {
		Rows []simulation.ExperimentSummaryRow `json:"rows"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode summary payload: %v", err)
	}
	if len(payload.Rows) != 1 || payload.Rows[0].AvgTotalPnL != 150 || payload.Rows[0].AvgFillRatio != 0.95 || payload.Rows[0].CI95TotalPnL != 98 {
		t.Fatalf("unexpected summary payload %+v", payload.Rows)
	}
}

func TestSimulationExperimentDetailHandlerReturnsContractShape(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 4, 25, 10, 0, 0, 0, time.UTC)
	service := &fakeSimulationService{
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID:  "sim-exp-detail",
				Name:          "Matrix detail",
				Status:        simulation.ExperimentStatusRunning,
				PlannedRuns:   2,
				CompletedRuns: 1,
				ActiveRunID:   "sim-run-active",
				QueuePosition: 1,
				CreatedAt:     now.Add(-time.Hour),
				StartedAt:     &now,
				UpdatedAt:     now,
			},
			ExecutionProfileSnapshot: simulation.ExecutionProfile{
				InitialBalance: 15000,
				FeeRate:        0.0015,
				SlippageRate:   0.0025,
			},
			Slots: []simulation.ExperimentRunSlot{
				{
					SlotIndex:      0,
					Repetition:     1,
					BotID:          "buy-and-hold",
					BotName:        "Buy And Hold",
					BotVersion:     "v1",
					ScenarioID:     "trend-up",
					ConfigSnapshot: map[string]any{"trade_notional": float64(500)},
				},
				{
					SlotIndex:      1,
					Repetition:     1,
					BotID:          "moving-average-cross",
					BotName:        "Moving Average Cross",
					BotVersion:     "v1",
					ScenarioID:     "range-chop",
					ConfigSnapshot: map[string]any{"fast_window": float64(2), "slow_window": float64(4)},
				},
			},
			CurrentIndex:  1,
			StopRequested: false,
			Runs: []simulation.RunSummary{
				{
					RunID:        "sim-run-completed",
					ExperimentID: "sim-exp-detail",
					BotID:        "buy-and-hold",
					BotName:      "Buy And Hold",
					BotVersion:   "v1",
					ScenarioID:   "trend-up",
					SessionID:    "paper-session-completed",
					Status:       simulation.RunStatusCompleted,
					StartedAt:    now.Add(-30 * time.Minute),
					UpdatedAt:    now.Add(-10 * time.Minute),
				},
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sim/experiments/sim-exp-detail", nil)
	req.SetPathValue("experimentID", "sim-exp-detail")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationExperimentDetailHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Experiment simulation.ExperimentDetail `json:"experiment"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode experiment detail payload: %v", err)
	}
	if payload.Experiment.ExperimentID != "sim-exp-detail" || payload.Experiment.QueuePosition != 1 {
		t.Fatalf("unexpected experiment summary payload %+v", payload.Experiment.ExperimentSummary)
	}
	if payload.Experiment.ExecutionProfileSnapshot.InitialBalance != 15000 {
		t.Fatalf("expected execution profile snapshot, got %+v", payload.Experiment.ExecutionProfileSnapshot)
	}
	if len(payload.Experiment.Slots) != 2 || payload.Experiment.Slots[1].ScenarioID != "range-chop" {
		t.Fatalf("expected slot matrix in payload, got %+v", payload.Experiment.Slots)
	}
	if payload.Experiment.CurrentIndex != 1 || payload.Experiment.StopRequested {
		t.Fatalf("expected coordinator state in payload, got current_index=%d stop_requested=%v", payload.Experiment.CurrentIndex, payload.Experiment.StopRequested)
	}
	if len(payload.Experiment.Runs) != 1 || payload.Experiment.Runs[0].ExperimentID != "sim-exp-detail" {
		t.Fatalf("expected child run list in payload, got %+v", payload.Experiment.Runs)
	}
}

func TestSimulationExperimentStopHandlerUsesPathID(t *testing.T) {
	t.Parallel()

	service := &fakeSimulationService{
		experiment: simulation.ExperimentDetail{
			ExperimentSummary: simulation.ExperimentSummary{
				ExperimentID: "sim-exp-stop",
				Name:         "Stop batch",
				Status:       simulation.ExperimentStatusStopped,
				PlannedRuns:  2,
				StoppedRuns:  1,
				CreatedAt:    time.Date(2026, 4, 21, 10, 0, 0, 0, time.UTC),
				UpdatedAt:    time.Date(2026, 4, 21, 10, 5, 0, 0, time.UTC),
			},
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sim/experiments/sim-exp-stop/stop", bytes.NewBufferString(`{}`))
	req.SetPathValue("experimentID", "sim-exp-stop")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationExperimentStopHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if service.stopExperimentID != "sim-exp-stop" {
		t.Fatalf("expected stop handler to forward experiment id, got %q", service.stopExperimentID)
	}
}

func TestSimulationRunHeartbeatHandlerDecodesRequestAndPathID(t *testing.T) {
	t.Parallel()

	heartbeatAt := time.Date(2026, 4, 21, 11, 30, 0, 0, time.UTC)
	service := &fakeSimulationService{
		run: simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:           "sim-run-heartbeat",
				BotID:           "baseline-roundtrip",
				BotName:         "Baseline Roundtrip",
				BotVersion:      "v1",
				ScenarioID:      "baseline",
				SessionID:       "sim-run-heartbeat",
				Status:          simulation.RunStatusRunning,
				LastHeartbeatAt: &heartbeatAt,
				StartedAt:       heartbeatAt.Add(-time.Minute),
				UpdatedAt:       heartbeatAt,
			},
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/sim/runs/sim-run-heartbeat/heartbeat", bytes.NewBufferString(`{"heartbeat_at":"2026-04-21T11:30:00Z"}`))
	req.SetPathValue("runID", "sim-run-heartbeat")
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	handlers.NewSimulationRunHeartbeatHandler(service).ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
	if service.lastHeartbeatRunID != "sim-run-heartbeat" {
		t.Fatalf("expected heartbeat handler to forward run id, got %q", service.lastHeartbeatRunID)
	}
	if !service.lastHeartbeatAt.Equal(heartbeatAt) {
		t.Fatalf("expected heartbeat handler to forward timestamp, got %v", service.lastHeartbeatAt)
	}
}

type fakeSimulationService struct {
	lastRunFilter           simulation.RunFilter
	lastLeaderboardFilter   simulation.LeaderboardFilter
	lastExperimentFilter    simulation.ExperimentFilter
	lastSummaryExperimentID string
	lastHeartbeatRunID      string
	lastHeartbeatAt         time.Time
	stopExperimentID        string
	createRunRequest        simulation.CreateRunRequest
	createExperimentRequest simulation.CreateExperimentRequest
	runs                    []simulation.RunSummary
	leaderboard             []simulation.LeaderboardEntry
	summaryRows             []simulation.ExperimentSummaryRow
	run                     simulation.RunDetail
	experiment              simulation.ExperimentDetail
	createExperimentErr     error
	stopExperimentErr       error
	summaryErr              error
}

func (f *fakeSimulationService) ListBots() ([]simulation.BotSummary, error) {
	return nil, nil
}

func (f *fakeSimulationService) GetBot(string) (simulation.BotDetail, error) {
	return simulation.BotDetail{}, nil
}

func (f *fakeSimulationService) ListRuns(filter simulation.RunFilter) ([]simulation.RunSummary, error) {
	f.lastRunFilter = filter
	return f.runs, nil
}

func (f *fakeSimulationService) ListLeaderboard(filter simulation.LeaderboardFilter) ([]simulation.LeaderboardEntry, error) {
	f.lastLeaderboardFilter = filter
	return f.leaderboard, nil
}

func (f *fakeSimulationService) GetRun(string) (simulation.RunDetail, error) {
	return f.run, nil
}

func (f *fakeSimulationService) CreateRun(_ context.Context, request simulation.CreateRunRequest) (simulation.RunDetail, error) {
	f.createRunRequest = request
	if f.run.RunID == "" {
		f.run = simulation.RunDetail{
			RunSummary: simulation.RunSummary{
				RunID:      "sim-run-created",
				Status:     simulation.RunStatusStarting,
				StartedAt:  time.Now().UTC(),
				UpdatedAt:  time.Now().UTC(),
				SessionID:  "sim-run-created",
				BotID:      request.BotID,
				BotVersion: request.BotVersion,
				ScenarioID: request.ScenarioID,
			},
			ConfigSnapshot: map[string]any{},
			ExecutionProfileSnapshot: simulation.ExecutionProfile{
				InitialBalance: 10000,
				RiskControls:   papertrading.RiskControls{},
			},
		}
	}
	return f.run, nil
}

func (f *fakeSimulationService) StopRun(context.Context, string) (simulation.RunDetail, error) {
	return f.run, nil
}

func (f *fakeSimulationService) UpdateRunStatus(context.Context, string, simulation.RunStatusUpdate) (simulation.RunDetail, error) {
	return f.run, nil
}

func (f *fakeSimulationService) HeartbeatRun(_ context.Context, runID string, heartbeatAt time.Time) (simulation.RunDetail, error) {
	f.lastHeartbeatRunID = runID
	f.lastHeartbeatAt = heartbeatAt
	return f.run, nil
}

func (f *fakeSimulationService) ListExperiments(filter simulation.ExperimentFilter) ([]simulation.ExperimentSummary, error) {
	f.lastExperimentFilter = filter
	if f.experiment.ExperimentID == "" {
		return nil, nil
	}
	return []simulation.ExperimentSummary{f.experiment.ExperimentSummary}, nil
}

func (f *fakeSimulationService) GetExperiment(string) (simulation.ExperimentDetail, error) {
	return f.experiment, nil
}

func (f *fakeSimulationService) CreateExperiment(_ context.Context, request simulation.CreateExperimentRequest) (simulation.ExperimentDetail, error) {
	f.createExperimentRequest = request
	if f.createExperimentErr != nil {
		return simulation.ExperimentDetail{}, f.createExperimentErr
	}
	return f.experiment, nil
}

func (f *fakeSimulationService) StopExperiment(_ context.Context, experimentID string) (simulation.ExperimentDetail, error) {
	f.stopExperimentID = experimentID
	if f.stopExperimentErr != nil {
		return simulation.ExperimentDetail{}, f.stopExperimentErr
	}
	return f.experiment, nil
}

func (f *fakeSimulationService) GetExperimentSummary(experimentID string) ([]simulation.ExperimentSummaryRow, error) {
	f.lastSummaryExperimentID = experimentID
	if f.summaryErr != nil {
		return nil, f.summaryErr
	}
	return f.summaryRows, nil
}
