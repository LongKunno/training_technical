package papertrading

import (
	"time"

	"crypto_simulator/core_trading/internal/marketdata"
)

type OrderSide string

const (
	OrderSideBuy  OrderSide = "buy"
	OrderSideSell OrderSide = "sell"
)

type VirtualAccount struct {
	ID          string              `json:"id"`
	CashBalance float64             `json:"cash_balance"`
	Positions   map[string]Position `json:"positions"`
}

type Position struct {
	Symbol       string  `json:"symbol"`
	Quantity     float64 `json:"quantity"`
	AveragePrice float64 `json:"average_price"`
}

type PaperOrder struct {
	ID                string    `json:"id"`
	SessionID         string    `json:"session_id"`
	AccountID         string    `json:"account_id"`
	Symbol            string    `json:"symbol"`
	Side              OrderSide `json:"side"`
	Quantity          float64   `json:"quantity"`
	RequestedQuantity float64   `json:"requested_quantity,omitempty"`
	Price             float64   `json:"price"`
	RequestedPrice    float64   `json:"requested_price"`
	Notional          float64   `json:"notional"`
	RequestedNotional float64   `json:"requested_notional,omitempty"`
	Fee               float64   `json:"fee"`
	FeeRate           float64   `json:"fee_rate"`
	SlippageRate      float64   `json:"slippage_rate"`
	FillCount         int       `json:"fill_count,omitempty"`
	RemainingQuantity float64   `json:"remaining_quantity,omitempty"`
	Status            string    `json:"status"`
	TerminalReason    string    `json:"terminal_reason,omitempty"`
	ExecutedAt        time.Time `json:"executed_at"`
}

type PlaceOrderRequest struct {
	Symbol   string    `json:"symbol"`
	Side     OrderSide `json:"side"`
	Quantity float64   `json:"quantity"`
	Price    float64   `json:"price"`
}

type PortfolioPositionSummary struct {
	Symbol        string  `json:"symbol"`
	Quantity      float64 `json:"quantity"`
	AveragePrice  float64 `json:"average_price"`
	MarketPrice   float64 `json:"market_price"`
	MarketValue   float64 `json:"market_value"`
	UnrealizedPnL float64 `json:"unrealized_pnl"`
}

type PortfolioSummary struct {
	AccountID     string                     `json:"account_id"`
	CashBalance   float64                    `json:"cash_balance"`
	RealizedPnL   float64                    `json:"realized_pnl"`
	UnrealizedPnL float64                    `json:"unrealized_pnl"`
	TotalEquity   float64                    `json:"total_equity"`
	Positions     []PortfolioPositionSummary `json:"positions"`
}

type SessionStatus string

const (
	SessionStatusRunning SessionStatus = "running"
	SessionStatusStopped SessionStatus = "stopped"
)

type RiskControls struct {
	AllowedSymbols      []string `json:"allowed_symbols"`
	MaxPositionQuantity float64  `json:"max_position_quantity"`
	MaxOrderNotional    float64  `json:"max_order_notional"`
	MaxDailyLoss        float64  `json:"max_daily_loss"`
	CooldownSeconds     int      `json:"cooldown_seconds"`
	MaxOpenNotional     float64  `json:"max_open_notional"`
}

type SimulationRules struct {
	FeeRate      float64      `json:"fee_rate"`
	SlippageRate float64      `json:"slippage_rate"`
	RiskControls RiskControls `json:"risk_controls"`
}

type MarketExecutionProfile struct {
	SignalLatencyTicks     int                   `json:"signal_latency_ticks"`
	SpreadBps              float64               `json:"spread_bps"`
	MaxFillNotionalPerTick float64               `json:"max_fill_notional_per_tick"`
	LiquidityCurve         []LiquidityCurvePoint `json:"liquidity_curve,omitempty"`
	QueuePriority          float64               `json:"queue_priority,omitempty"`
	MarketImpactBpsPer10k  float64               `json:"market_impact_bps_per_10k,omitempty"`
	CancelAfterTicks       int                   `json:"cancel_after_ticks,omitempty"`
}

type LiquidityCurvePoint struct {
	MaxNotional float64 `json:"max_notional"`
	FillRatio   float64 `json:"fill_ratio"`
}

type SessionExecutionProfile struct {
	InitialBalance float64                `json:"initial_balance"`
	Rules          SimulationRules        `json:"rules"`
	MarketProfile  MarketExecutionProfile `json:"market_profile"`
}

type RulesSummary struct {
	PaperAccountID string       `json:"paper_account_id"`
	InitialBalance float64      `json:"initial_balance"`
	FeeRate        float64      `json:"fee_rate"`
	SlippageRate   float64      `json:"slippage_rate"`
	RiskControls   RiskControls `json:"risk_controls"`
}

type OrderFilter struct {
	SessionID string
	Symbol    string
	Side      OrderSide
	Limit     int
	Offset    int
}

type MarketPriceSnapshot struct {
	Price     float64   `json:"price"`
	Source    string    `json:"source"`
	Timestamp time.Time `json:"timestamp"`
}

type SimulationSession struct {
	ID          string        `json:"id"`
	Status      SessionStatus `json:"status"`
	StartedAt   time.Time     `json:"started_at"`
	StoppedAt   *time.Time    `json:"stopped_at,omitempty"`
	ResetCount  int           `json:"reset_count"`
	LastEventAt time.Time     `json:"last_event_at"`
}

type SessionHistoryEntry struct {
	SessionID       string        `json:"session_id"`
	Status          SessionStatus `json:"status"`
	StartedAt       time.Time     `json:"started_at"`
	StoppedAt       *time.Time    `json:"stopped_at,omitempty"`
	LastEventAt     time.Time     `json:"last_event_at"`
	ResetCount      int           `json:"reset_count"`
	FilledOrders    int           `json:"filled_orders"`
	RejectedSignals int           `json:"rejected_signals"`
	RealizedPnL     float64       `json:"realized_pnl"`
	TotalPnL        float64       `json:"total_pnl"`
	MaxDrawdown     float64       `json:"max_drawdown"`
}

type SessionHistoryFilter struct {
	Query  string
	Status SessionStatus
	Limit  int
	Offset int
}

type SessionTimelinePoint struct {
	Timestamp     time.Time `json:"timestamp"`
	Equity        float64   `json:"equity"`
	CashBalance   float64   `json:"cash_balance"`
	UnrealizedPnL float64   `json:"unrealized_pnl"`
	Drawdown      float64   `json:"drawdown"`
	EventType     string    `json:"event_type"`
}

type SignalV1 struct {
	StrategyID string    `json:"strategy_id"`
	SignalID   string    `json:"signal_id"`
	RunID      string    `json:"run_id,omitempty"`
	BotID      string    `json:"bot_id,omitempty"`
	BotVersion string    `json:"bot_version,omitempty"`
	Symbol     string    `json:"symbol"`
	Side       OrderSide `json:"side"`
	Quantity   float64   `json:"quantity,omitempty"`
	Notional   float64   `json:"notional,omitempty"`
	PriceHint  float64   `json:"price_hint,omitempty"`
	Timestamp  time.Time `json:"timestamp"`
}

type SignalExecution struct {
	SignalID      string      `json:"signal_id"`
	StrategyID    string      `json:"strategy_id"`
	RunID         string      `json:"run_id,omitempty"`
	BotID         string      `json:"bot_id,omitempty"`
	BotVersion    string      `json:"bot_version,omitempty"`
	Status        string      `json:"status"`
	Order         *PaperOrder `json:"order,omitempty"`
	DerivedPrice  float64     `json:"derived_price,omitempty"`
	DerivedAmount float64     `json:"derived_amount,omitempty"`
}

type PendingExecution struct {
	OrderID               string         `json:"order_id"`
	SignalID              string         `json:"signal_id"`
	StrategyID            string         `json:"strategy_id"`
	RunID                 string         `json:"run_id,omitempty"`
	BotID                 string         `json:"bot_id,omitempty"`
	BotVersion            string         `json:"bot_version,omitempty"`
	Symbol                string         `json:"symbol"`
	Side                  OrderSide      `json:"side"`
	RequestedQuantity     float64        `json:"requested_quantity"`
	RequestedNotional     float64        `json:"requested_notional"`
	RequestedPrice        float64        `json:"requested_price"`
	RemainingQuantity     float64        `json:"remaining_quantity"`
	RemainingLatencyTicks int            `json:"remaining_latency_ticks"`
	ElapsedExecutionTicks int            `json:"elapsed_execution_ticks,omitempty"`
	CreatedAt             time.Time      `json:"created_at"`
	Details               map[string]any `json:"details,omitempty"`
}

type AuditEvent struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	Type      string         `json:"type"`
	Message   string         `json:"message"`
	Symbol    string         `json:"symbol,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
	Details   map[string]any `json:"details,omitempty"`
}

type SymbolReport struct {
	Symbol       string  `json:"symbol"`
	FilledOrders int     `json:"filled_orders"`
	FeesPaid     float64 `json:"fees_paid"`
}

type SessionReport struct {
	SessionID          string                 `json:"session_id"`
	Status             SessionStatus          `json:"status"`
	StartedAt          time.Time              `json:"started_at"`
	StoppedAt          *time.Time             `json:"stopped_at,omitempty"`
	ResetCount         int                    `json:"reset_count"`
	FilledOrders       int                    `json:"filled_orders"`
	RejectedSignals    int                    `json:"rejected_signals"`
	FeesPaid           float64                `json:"fees_paid"`
	SlippageCost       float64                `json:"slippage_cost"`
	FillRatio          float64                `json:"fill_ratio"`
	AverageSlippageBps float64                `json:"average_slippage_bps"`
	StoppedOrders      int                    `json:"stopped_orders"`
	CancelRate         float64                `json:"cancel_rate"`
	RealizedPnL        float64                `json:"realized_pnl"`
	UnrealizedPnL      float64                `json:"unrealized_pnl"`
	TotalPnL           float64                `json:"total_pnl"`
	MaxDrawdown        float64                `json:"max_drawdown"`
	Symbols            []SymbolReport         `json:"symbols"`
	Timeline           []SessionTimelinePoint `json:"timeline,omitempty"`
}

type PersistentState struct {
	Account           VirtualAccount                    `json:"account"`
	InitialBalance    float64                           `json:"initial_balance"`
	RealizedPnL       float64                           `json:"realized_pnl"`
	Rules             SimulationRules                   `json:"rules"`
	MarketProfile     MarketExecutionProfile            `json:"market_profile"`
	Orders            []PaperOrder                      `json:"orders"`
	PendingExecutions []PendingExecution                `json:"pending_executions"`
	MarketPrices      map[string]marketdata.PriceTickV1 `json:"market_prices"`
	Session           SimulationSession                 `json:"session"`
	AuditEvents       []AuditEvent                      `json:"audit_events"`
	Report            SessionReport                     `json:"report"`
	PeakEquity        float64                           `json:"peak_equity"`
	ProcessedSignals  []string                          `json:"processed_signals"`
}

type StateStore interface {
	SaveState(state PersistentState) error
	LoadState(accountID string) (PersistentState, bool, error)
	ListSessions(accountID string, filter SessionHistoryFilter) ([]SessionHistoryEntry, error)
	LoadSessionReport(accountID string, sessionID string) (SessionReport, bool, error)
	LoadSessionOrders(accountID string, sessionID string, filter OrderFilter) ([]PaperOrder, bool, error)
	LoadSessionAudit(accountID string, sessionID string, limit int, offset int) ([]AuditEvent, bool, error)
	LoadSessionTimeline(accountID string, sessionID string) ([]SessionTimelinePoint, bool, error)
}

type TimelineSubscription <-chan SessionTimelinePoint
