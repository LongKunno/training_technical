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
	ID             string    `json:"id"`
	AccountID      string    `json:"account_id"`
	Symbol         string    `json:"symbol"`
	Side           OrderSide `json:"side"`
	Quantity       float64   `json:"quantity"`
	Price          float64   `json:"price"`
	RequestedPrice float64   `json:"requested_price"`
	Notional       float64   `json:"notional"`
	Fee            float64   `json:"fee"`
	FeeRate        float64   `json:"fee_rate"`
	SlippageRate   float64   `json:"slippage_rate"`
	Status         string    `json:"status"`
	ExecutedAt     time.Time `json:"executed_at"`
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

type RulesSummary struct {
	PaperAccountID string       `json:"paper_account_id"`
	InitialBalance float64      `json:"initial_balance"`
	FeeRate        float64      `json:"fee_rate"`
	SlippageRate   float64      `json:"slippage_rate"`
	RiskControls   RiskControls `json:"risk_controls"`
}

type OrderFilter struct {
	Symbol string
	Side   OrderSide
	Limit  int
	Offset int
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

type SignalV1 struct {
	StrategyID string    `json:"strategy_id"`
	SignalID   string    `json:"signal_id"`
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
	Status        string      `json:"status"`
	Order         *PaperOrder `json:"order,omitempty"`
	DerivedPrice  float64     `json:"derived_price,omitempty"`
	DerivedAmount float64     `json:"derived_amount,omitempty"`
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
	SessionID       string         `json:"session_id"`
	Status          SessionStatus  `json:"status"`
	StartedAt       time.Time      `json:"started_at"`
	StoppedAt       *time.Time     `json:"stopped_at,omitempty"`
	ResetCount      int            `json:"reset_count"`
	FilledOrders    int            `json:"filled_orders"`
	RejectedSignals int            `json:"rejected_signals"`
	FeesPaid        float64        `json:"fees_paid"`
	SlippageCost    float64        `json:"slippage_cost"`
	RealizedPnL     float64        `json:"realized_pnl"`
	UnrealizedPnL   float64        `json:"unrealized_pnl"`
	TotalPnL        float64        `json:"total_pnl"`
	MaxDrawdown     float64        `json:"max_drawdown"`
	Symbols         []SymbolReport `json:"symbols"`
}

type PersistentState struct {
	Account          VirtualAccount                    `json:"account"`
	InitialBalance   float64                           `json:"initial_balance"`
	RealizedPnL      float64                           `json:"realized_pnl"`
	Rules            SimulationRules                   `json:"rules"`
	Orders           []PaperOrder                      `json:"orders"`
	MarketPrices     map[string]marketdata.PriceTickV1 `json:"market_prices"`
	Session          SimulationSession                 `json:"session"`
	AuditEvents      []AuditEvent                      `json:"audit_events"`
	Report           SessionReport                     `json:"report"`
	PeakEquity       float64                           `json:"peak_equity"`
	ProcessedSignals []string                          `json:"processed_signals"`
}

type StateStore interface {
	SaveState(state PersistentState) error
	LoadState(accountID string) (PersistentState, bool, error)
}
