package simulation

import (
	"context"
	"strings"
	"time"

	"crypto_simulator/core_trading/internal/papertrading"
)

type RunStatus string

const (
	RunStatusStarting  RunStatus = "starting"
	RunStatusRunning   RunStatus = "running"
	RunStatusCompleted RunStatus = "completed"
	RunStatusStopped   RunStatus = "stopped"
	RunStatusFailed    RunStatus = "failed"
)

func (status RunStatus) IsTerminal() bool {
	switch status {
	case RunStatusCompleted, RunStatusStopped, RunStatusFailed:
		return true
	default:
		return false
	}
}

func IsValidRunStatus(status RunStatus) bool {
	switch status {
	case RunStatusStarting, RunStatusRunning, RunStatusCompleted, RunStatusStopped, RunStatusFailed:
		return true
	default:
		return false
	}
}

type BotSummary struct {
	BotID           string    `json:"bot_id"`
	Name            string    `json:"name"`
	Description     string    `json:"description"`
	Runtime         string    `json:"runtime"`
	CurrentVersion  string    `json:"current_version"`
	DefaultScenario string    `json:"default_scenario"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type BotVersion struct {
	BotID         string         `json:"bot_id"`
	Version       string         `json:"version"`
	Title         string         `json:"title"`
	Description   string         `json:"description"`
	Entrypoint    string         `json:"entrypoint"`
	ConfigSchema  map[string]any `json:"config_schema"`
	DefaultConfig map[string]any `json:"default_config"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

type BotDetail struct {
	BotSummary
	Versions []BotVersion `json:"versions"`
}

type ExecutionProfile struct {
	InitialBalance float64                   `json:"initial_balance"`
	FeeRate        float64                   `json:"fee_rate"`
	SlippageRate   float64                   `json:"slippage_rate"`
	RiskControls   papertrading.RiskControls `json:"risk_controls"`
}

type ExecutionProfileInput struct {
	InitialBalance *float64                   `json:"initial_balance,omitempty"`
	FeeRate        *float64                   `json:"fee_rate,omitempty"`
	SlippageRate   *float64                   `json:"slippage_rate,omitempty"`
	RiskControls   *papertrading.RiskControls `json:"risk_controls,omitempty"`
}

type MarketMicrostructureProfile struct {
	SignalLatencyTicks     int     `json:"signal_latency_ticks"`
	SpreadBps              float64 `json:"spread_bps"`
	MaxFillNotionalPerTick float64 `json:"max_fill_notional_per_tick"`
}

type RunMetricsSummary struct {
	FilledOrders    int     `json:"filled_orders"`
	RejectedSignals int     `json:"rejected_signals"`
	FeesPaid        float64 `json:"fees_paid"`
	SlippageCost    float64 `json:"slippage_cost"`
	RealizedPnL     float64 `json:"realized_pnl"`
	UnrealizedPnL   float64 `json:"unrealized_pnl"`
	TotalPnL        float64 `json:"total_pnl"`
	MaxDrawdown     float64 `json:"max_drawdown"`
}

type RunSummary struct {
	RunID           string     `json:"run_id"`
	ExperimentID    string     `json:"experiment_id,omitempty"`
	BotID           string     `json:"bot_id"`
	BotName         string     `json:"bot_name"`
	BotVersion      string     `json:"bot_version"`
	ScenarioID      string     `json:"scenario_id"`
	SessionID       string     `json:"session_id"`
	Status          RunStatus  `json:"status"`
	ErrorMessage    string     `json:"error_message,omitempty"`
	LastHeartbeatAt *time.Time `json:"last_heartbeat_at,omitempty"`
	StartedAt       time.Time  `json:"started_at"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type RunDetail struct {
	RunSummary
	ConfigSnapshot           map[string]any              `json:"config_snapshot"`
	ExecutionProfileSnapshot ExecutionProfile            `json:"execution_profile_snapshot"`
	MarketProfileSnapshot    MarketMicrostructureProfile `json:"market_profile_snapshot"`
	MetricsSnapshot          *RunMetricsSummary          `json:"metrics_snapshot,omitempty"`
	StoppedReason            string                      `json:"stopped_reason,omitempty"`
}

type RunFilter struct {
	Query        string
	Status       RunStatus
	BotID        string
	BotVersion   string
	ScenarioID   string
	ExperimentID string
	Limit        int
	Offset       int
}

type LeaderboardFilter struct {
	BotID      string
	BotVersion string
	ScenarioID string
	Limit      int
	Offset     int
}

type CreateRunRequest struct {
	BotID            string                 `json:"bot_id"`
	BotVersion       string                 `json:"bot_version,omitempty"`
	ScenarioID       string                 `json:"scenario_id,omitempty"`
	BotConfig        map[string]any         `json:"bot_config,omitempty"`
	Config           map[string]any         `json:"config,omitempty"`
	ExecutionProfile *ExecutionProfileInput `json:"execution_profile,omitempty"`
}

type ExperimentStatus string

const (
	ExperimentStatusQueued    ExperimentStatus = "queued"
	ExperimentStatusStarting  ExperimentStatus = "starting"
	ExperimentStatusRunning   ExperimentStatus = "running"
	ExperimentStatusCompleted ExperimentStatus = "completed"
	ExperimentStatusStopped   ExperimentStatus = "stopped"
	ExperimentStatusFailed    ExperimentStatus = "failed"
)

func (status ExperimentStatus) IsTerminal() bool {
	switch status {
	case ExperimentStatusCompleted, ExperimentStatusStopped, ExperimentStatusFailed:
		return true
	default:
		return false
	}
}

func IsValidExperimentStatus(status ExperimentStatus) bool {
	switch status {
	case ExperimentStatusQueued, ExperimentStatusStarting, ExperimentStatusRunning, ExperimentStatusCompleted, ExperimentStatusStopped, ExperimentStatusFailed:
		return true
	default:
		return false
	}
}

type ExperimentBotRequest struct {
	BotID      string         `json:"bot_id"`
	BotVersion string         `json:"bot_version,omitempty"`
	BotConfig  map[string]any `json:"bot_config,omitempty"`
	Config     map[string]any `json:"config,omitempty"`
}

type CreateExperimentRequest struct {
	Name             string                 `json:"name"`
	Bots             []ExperimentBotRequest `json:"bots"`
	Scenarios        []string               `json:"scenarios"`
	Repetitions      int                    `json:"repetitions"`
	ExecutionProfile *ExecutionProfileInput `json:"execution_profile,omitempty"`
}

type ExperimentRunSlot struct {
	SlotIndex      int            `json:"slot_index"`
	Repetition     int            `json:"repetition"`
	BotID          string         `json:"bot_id"`
	BotName        string         `json:"bot_name"`
	BotVersion     string         `json:"bot_version"`
	ScenarioID     string         `json:"scenario_id"`
	ConfigSnapshot map[string]any `json:"config_snapshot"`
}

type ExperimentSummary struct {
	ExperimentID  string           `json:"experiment_id"`
	Name          string           `json:"name"`
	Status        ExperimentStatus `json:"status"`
	PlannedRuns   int              `json:"planned_runs"`
	CompletedRuns int              `json:"completed_runs"`
	FailedRuns    int              `json:"failed_runs"`
	StoppedRuns   int              `json:"stopped_runs"`
	ActiveRunID   string           `json:"active_run_id,omitempty"`
	QueuePosition int              `json:"queue_position,omitempty"`
	ErrorMessage  string           `json:"error_message,omitempty"`
	CreatedAt     time.Time        `json:"created_at"`
	StartedAt     *time.Time       `json:"started_at,omitempty"`
	CompletedAt   *time.Time       `json:"completed_at,omitempty"`
	UpdatedAt     time.Time        `json:"updated_at"`
}

type ExperimentDetail struct {
	ExperimentSummary
	ExecutionProfileSnapshot ExecutionProfile    `json:"execution_profile_snapshot"`
	Slots                    []ExperimentRunSlot `json:"slots"`
	CurrentIndex             int                 `json:"current_index"`
	StopRequested            bool                `json:"stop_requested"`
	Runs                     []RunSummary        `json:"runs,omitempty"`
}

type ExperimentFilter struct {
	Query  string
	Status ExperimentStatus
	Limit  int
	Offset int
}

type ExperimentSummaryRow struct {
	BotID          string  `json:"bot_id"`
	BotVersion     string  `json:"bot_version"`
	ScenarioID     string  `json:"scenario_id"`
	ScheduledRuns  int     `json:"scheduled_runs"`
	CompletedRuns  int     `json:"completed_runs"`
	FailedRuns     int     `json:"failed_runs"`
	StoppedRuns    int     `json:"stopped_runs"`
	AvgTotalPnL    float64 `json:"avg_total_pnl"`
	BestTotalPnL   float64 `json:"best_total_pnl"`
	WorstTotalPnL  float64 `json:"worst_total_pnl"`
	AvgMaxDrawdown float64 `json:"avg_max_drawdown"`
}

type RunStatusUpdate struct {
	Status       RunStatus `json:"status"`
	ErrorMessage string    `json:"error_message,omitempty"`
}

type RunHeartbeatRequest struct {
	HeartbeatAt *time.Time `json:"heartbeat_at,omitempty"`
}

type RunnerStartRequest struct {
	RunID         string         `json:"run_id"`
	BotID         string         `json:"bot_id"`
	BotVersion    string         `json:"bot_version"`
	ScenarioID    string         `json:"scenario_id"`
	SessionID     string         `json:"session_id"`
	Config        map[string]any `json:"config,omitempty"`
	StartedAt     time.Time      `json:"started_at"`
	CallbackToken string         `json:"callback_token,omitempty"`
}

type LeaderboardEntry struct {
	RunSummary
	MetricsSnapshot RunMetricsSummary `json:"metrics_snapshot"`
}

type Store interface {
	ListBots() ([]BotSummary, error)
	GetBot(botID string) (BotDetail, bool, error)
	ListRuns(accountID string, filter RunFilter) ([]RunSummary, error)
	GetRun(accountID string, runID string) (RunDetail, bool, error)
	FindActiveRun(accountID string) (RunDetail, bool, error)
	ListLeaderboard(accountID string, filter LeaderboardFilter) ([]LeaderboardEntry, error)
	CreateRun(accountID string, run RunDetail) error
	UpdateRunStatus(accountID string, runID string, status RunStatus, errorMessage string, stoppedReason string, completedAt *time.Time, metrics *RunMetricsSummary) error
	UpdateRunHeartbeat(accountID string, runID string, heartbeatAt time.Time) error
	ListExperiments(accountID string, filter ExperimentFilter) ([]ExperimentSummary, error)
	ListQueuedExperiments(accountID string) ([]ExperimentSummary, error)
	GetExperiment(accountID string, experimentID string) (ExperimentDetail, bool, error)
	FindActiveExperiment(accountID string) (ExperimentDetail, bool, error)
	CreateExperiment(accountID string, experiment ExperimentDetail) error
	UpdateExperiment(accountID string, experiment ExperimentDetail) error
}

type RunnerClient interface {
	StartRun(ctx context.Context, request RunnerStartRequest) error
	StopRun(ctx context.Context, runID string) error
}

type PaperEngine interface {
	StartSession(sessionID string) (papertrading.SimulationSession, error)
	StartSessionWithProfile(sessionID string, profile papertrading.SessionExecutionProfile) (papertrading.SimulationSession, error)
	StopSession() (papertrading.SimulationSession, error)
	SessionSummary() papertrading.SimulationSession
	ReportBySession(sessionID string) (papertrading.SessionReport, error)
	DefaultRulesSummary() papertrading.RulesSummary
}

type ScenarioCatalogClient interface {
	GetScenario(ctx context.Context, scenarioID string) (ScenarioCatalogEntry, error)
}

type ScenarioCatalogEntry struct {
	ScenarioID            string                      `json:"scenario_id"`
	Name                  string                      `json:"name"`
	Description           string                      `json:"description"`
	Symbols               []string                    `json:"symbols"`
	TickCount             int                         `json:"tick_count"`
	StartedAt             time.Time                   `json:"started_at"`
	EndedAt               time.Time                   `json:"ended_at"`
	Tags                  []string                    `json:"tags"`
	MicrostructureProfile MarketMicrostructureProfile `json:"microstructure_profile"`
}

func NormalizeRunFilter(filter RunFilter) RunFilter {
	if filter.Limit <= 0 {
		filter.Limit = 20
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}
	filter.Query = strings.TrimSpace(filter.Query)
	filter.BotID = strings.TrimSpace(filter.BotID)
	filter.BotVersion = strings.TrimSpace(filter.BotVersion)
	filter.ScenarioID = strings.TrimSpace(filter.ScenarioID)
	filter.ExperimentID = strings.TrimSpace(filter.ExperimentID)
	return filter
}

func NormalizeLeaderboardFilter(filter LeaderboardFilter) LeaderboardFilter {
	if filter.Limit <= 0 {
		filter.Limit = 20
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}
	filter.BotID = strings.TrimSpace(filter.BotID)
	filter.BotVersion = strings.TrimSpace(filter.BotVersion)
	filter.ScenarioID = strings.TrimSpace(filter.ScenarioID)
	return filter
}

func NormalizeExperimentFilter(filter ExperimentFilter) ExperimentFilter {
	if filter.Limit <= 0 {
		filter.Limit = 20
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}
	filter.Query = strings.TrimSpace(filter.Query)
	return filter
}
