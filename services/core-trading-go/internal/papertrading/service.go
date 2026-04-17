package papertrading

import (
	"cmp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"crypto_simulator/core_trading/internal/marketdata"
)

type Engine struct {
	mu               sync.Mutex
	account          VirtualAccount
	initialBalance   float64
	orderCounter     uint64
	orders           []PaperOrder
	lastTradePrices  map[string]float64
	markPrices       map[string]marketdata.PriceTickV1
	realizedPnL      float64
	rules            SimulationRules
	store            StateStore
	currentSession   SimulationSession
	auditEvents      []AuditEvent
	feesPaid         float64
	slippageCost     float64
	filledOrders     int
	rejectedSignals  int
	symbolStats      map[string]sessionSymbolMetrics
	peakEquity       float64
	maxDrawdown      float64
	lastOrderAt      map[string]time.Time
	processedSignals map[string]struct{}
}

func NewEngine(accountID string, initialBalance float64) (*Engine, error) {
	return NewEngineWithStore(accountID, initialBalance, SimulationRules{}, nil)
}

func NewEngineWithRules(accountID string, initialBalance float64, rules SimulationRules) (*Engine, error) {
	return NewEngineWithStore(accountID, initialBalance, rules, nil)
}

func NewEngineWithStore(accountID string, initialBalance float64, rules SimulationRules, store StateStore) (*Engine, error) {
	if err := validateEngineBootstrap(accountID, initialBalance, rules); err != nil {
		return nil, err
	}

	engine := &Engine{
		account: VirtualAccount{
			ID:          accountID,
			CashBalance: initialBalance,
			Positions:   make(map[string]Position),
		},
		initialBalance:  initialBalance,
		lastTradePrices: make(map[string]float64),
		markPrices:      make(map[string]marketdata.PriceTickV1),
		rules:           rules,
		store:           store,
	}
	engine.bootstrapRuntimeState(time.Now().UTC())

	return engine, nil
}

func NewEngineFromPersistentState(state PersistentState, store StateStore) (*Engine, error) {
	if state.Account.Positions == nil {
		state.Account.Positions = make(map[string]Position)
	}

	if err := validateEngineBootstrap(state.Account.ID, state.InitialBalance, state.Rules); err != nil {
		return nil, err
	}

	engine := &Engine{
		account:         cloneAccount(state.Account),
		initialBalance:  state.InitialBalance,
		orderCounter:    deriveOrderCounter(state.Orders),
		orders:          cloneOrders(state.Orders),
		lastTradePrices: deriveLastTradePrices(state.Orders),
		markPrices:      cloneMarketPrices(state.MarketPrices),
		realizedPnL:     state.RealizedPnL,
		rules:           state.Rules,
		store:           store,
	}
	engine.restoreRuntimeState(state, time.Now().UTC())

	return engine, nil
}

func validateEngineBootstrap(accountID string, initialBalance float64, rules SimulationRules) error {
	if initialBalance < 0 {
		return ErrInvalidBalance
	}

	if strings.TrimSpace(accountID) == "" {
		return ErrInvalidSymbol
	}

	if rules.FeeRate < 0 {
		return ErrInvalidFeeRate
	}

	if rules.SlippageRate < 0 || rules.SlippageRate >= 1 {
		return ErrInvalidSlippageRate
	}

	if rules.RiskControls.MaxPositionQuantity < 0 {
		return ErrMaxPositionExceeded
	}

	if rules.RiskControls.MaxOrderNotional < 0 {
		return ErrMaxOrderNotionalExceeded
	}

	if rules.RiskControls.MaxDailyLoss < 0 {
		return ErrMaxDailyLossExceeded
	}

	if rules.RiskControls.MaxOpenNotional < 0 {
		return ErrMaxOpenNotionalExceeded
	}

	if rules.RiskControls.CooldownSeconds < 0 {
		return ErrCooldownActive
	}

	return nil
}

func (e *Engine) PlaceMarketOrder(request PlaceOrderRequest) (PaperOrder, error) {
	if err := validateOrderRequest(request); err != nil {
		return PaperOrder{}, err
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	order, err := e.placeMarketOrderLocked(request, map[string]any{
		"source": "paper-order-api",
	})
	if err != nil {
		e.appendAuditLocked("order_rejected", err.Error(), request.Symbol, time.Now().UTC(), map[string]any{
			"side":     request.Side,
			"quantity": request.Quantity,
			"price":    request.Price,
		})
		return PaperOrder{}, err
	}

	return order, nil
}

func (e *Engine) Snapshot() VirtualAccount {
	e.mu.Lock()
	defer e.mu.Unlock()

	return cloneAccount(e.account)
}

func (e *Engine) PortfolioSummary() PortfolioSummary {
	e.mu.Lock()
	defer e.mu.Unlock()

	return e.buildPortfolioSummary()
}

func (e *Engine) Orders() []PaperOrder {
	return e.ListOrders(OrderFilter{Limit: 50, Offset: 0})
}

func (e *Engine) ListOrders(filter OrderFilter) []PaperOrder {
	e.mu.Lock()
	defer e.mu.Unlock()

	return filterOrders(cloneOrders(e.orders), filter)
}

func (e *Engine) Rules() SimulationRules {
	e.mu.Lock()
	defer e.mu.Unlock()

	return e.rules
}

func (e *Engine) RulesSummary() RulesSummary {
	e.mu.Lock()
	defer e.mu.Unlock()

	return RulesSummary{
		PaperAccountID: e.account.ID,
		InitialBalance: e.initialBalance,
		FeeRate:        e.rules.FeeRate,
		SlippageRate:   e.rules.SlippageRate,
		RiskControls:   cloneRiskControls(e.rules.RiskControls),
	}
}

func (e *Engine) PositionsSummary() []PortfolioPositionSummary {
	e.mu.Lock()
	defer e.mu.Unlock()

	return clonePortfolioPositions(e.buildPortfolioSummary().Positions)
}

func (e *Engine) ApplyMarketPrice(tick marketdata.PriceTickV1) error {
	_, err := e.ApplyMarketPrices([]marketdata.PriceTickV1{tick})
	return err
}

func (e *Engine) ApplyMarketPrices(ticks []marketdata.PriceTickV1) (int, error) {
	for _, tick := range ticks {
		if err := validatePriceTick(tick); err != nil {
			return 0, err
		}
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	if e.currentSession.Status != SessionStatusRunning {
		e.appendAuditLocked("market_tick_rejected", ErrSessionStopped.Error(), "", time.Now().UTC(), nil)
		return 0, ErrSessionStopped
	}

	previousState := e.snapshotLockedState()
	for _, tick := range ticks {
		e.markPrices[tick.Symbol] = tick
		e.appendAuditLocked("market_tick_received", "market price applied", tick.Symbol, tick.Timestamp, map[string]any{
			"price":  tick.Price,
			"source": tick.Source,
		})
	}
	e.updateDrawdownLocked()

	if err := e.persistLocked(); err != nil {
		e.restoreLockedState(previousState)
		return 0, err
	}

	return len(ticks), nil
}

func validateOrderRequest(request PlaceOrderRequest) error {
	if strings.TrimSpace(request.Symbol) == "" {
		return ErrInvalidSymbol
	}

	if request.Side != OrderSideBuy && request.Side != OrderSideSell {
		return ErrInvalidOrderSide
	}

	if request.Quantity <= 0 {
		return ErrInvalidQuantity
	}

	if request.Price <= 0 {
		return ErrInvalidPrice
	}

	return nil
}

func validatePriceTick(tick marketdata.PriceTickV1) error {
	if strings.TrimSpace(tick.Symbol) == "" {
		return ErrInvalidSymbol
	}

	if tick.Price <= 0 {
		return ErrInvalidPrice
	}

	if tick.Timestamp.IsZero() {
		return ErrInvalidTimestamp
	}

	return nil
}

func (e *Engine) applyBuy(symbol string, quantity float64, price float64, fee float64) {
	position := e.account.Positions[symbol]
	totalQuantity := position.Quantity + quantity
	totalCost := (position.Quantity * position.AveragePrice) + (quantity * price) + fee

	e.account.Positions[symbol] = Position{
		Symbol:       symbol,
		Quantity:     totalQuantity,
		AveragePrice: totalCost / totalQuantity,
	}
}

func (e *Engine) applySell(symbol string, quantity float64, sellPrice float64, fee float64) (float64, error) {
	position, exists := e.account.Positions[symbol]
	if !exists || position.Quantity < quantity {
		return 0, ErrInsufficientAsset
	}

	realizedPnL := (sellPrice * quantity) - fee - (position.AveragePrice * quantity)
	remainingQuantity := position.Quantity - quantity
	if remainingQuantity == 0 {
		delete(e.account.Positions, symbol)
		return realizedPnL, nil
	}

	e.account.Positions[symbol] = Position{
		Symbol:       symbol,
		Quantity:     remainingQuantity,
		AveragePrice: position.AveragePrice,
	}

	return realizedPnL, nil
}

func cloneAccount(account VirtualAccount) VirtualAccount {
	positions := make(map[string]Position, len(account.Positions))
	for symbol, position := range account.Positions {
		positions[symbol] = position
	}

	return VirtualAccount{
		ID:          account.ID,
		CashBalance: account.CashBalance,
		Positions:   positions,
	}
}

func cloneOrders(orders []PaperOrder) []PaperOrder {
	return slices.Clone(orders)
}

func cloneLastTradePrices(input map[string]float64) map[string]float64 {
	output := make(map[string]float64, len(input))
	for symbol, price := range input {
		output[symbol] = price
	}
	return output
}

func (e *Engine) applySlippage(side OrderSide, requestedPrice float64) float64 {
	switch side {
	case OrderSideBuy:
		return requestedPrice * (1 + e.rules.SlippageRate)
	case OrderSideSell:
		return requestedPrice * (1 - e.rules.SlippageRate)
	default:
		return requestedPrice
	}
}

func (e *Engine) buildPortfolioSummary() PortfolioSummary {
	positions := make([]PortfolioPositionSummary, 0, len(e.account.Positions))
	unrealizedPnL := 0.0
	totalMarketValue := 0.0

	for symbol, position := range e.account.Positions {
		markTick, hasMarkPrice := e.markPrices[symbol]
		marketPrice := markTick.Price
		if !hasMarkPrice || marketPrice == 0 {
			marketPrice = e.lastTradePrices[symbol]
		}
		if marketPrice == 0 {
			marketPrice = position.AveragePrice
		}

		marketValue := position.Quantity * marketPrice
		positionUnrealizedPnL := (marketPrice - position.AveragePrice) * position.Quantity

		positions = append(positions, PortfolioPositionSummary{
			Symbol:        symbol,
			Quantity:      position.Quantity,
			AveragePrice:  position.AveragePrice,
			MarketPrice:   marketPrice,
			MarketValue:   marketValue,
			UnrealizedPnL: positionUnrealizedPnL,
		})

		totalMarketValue += marketValue
		unrealizedPnL += positionUnrealizedPnL
	}

	slices.SortFunc(positions, func(a PortfolioPositionSummary, b PortfolioPositionSummary) int {
		return cmp.Compare(a.Symbol, b.Symbol)
	})

	return PortfolioSummary{
		AccountID:     e.account.ID,
		CashBalance:   e.account.CashBalance,
		RealizedPnL:   e.realizedPnL,
		UnrealizedPnL: unrealizedPnL,
		TotalEquity:   e.account.CashBalance + totalMarketValue,
		Positions:     positions,
	}
}

func (e *Engine) persistLocked() error {
	if e.store == nil {
		return nil
	}

	return e.store.SaveState(e.buildPersistentStateLocked())
}

func cloneMarketPrices(input map[string]marketdata.PriceTickV1) map[string]marketdata.PriceTickV1 {
	output := make(map[string]marketdata.PriceTickV1, len(input))
	for symbol, tick := range input {
		output[symbol] = tick
	}
	return output
}

func clonePortfolioPositions(positions []PortfolioPositionSummary) []PortfolioPositionSummary {
	return slices.Clone(positions)
}

func filterOrders(orders []PaperOrder, filter OrderFilter) []PaperOrder {
	if filter.Limit <= 0 {
		filter.Limit = 50
	}

	filtered := make([]PaperOrder, 0, len(orders))
	for i := len(orders) - 1; i >= 0; i-- {
		order := orders[i]
		if filter.Symbol != "" && order.Symbol != filter.Symbol {
			continue
		}
		if filter.Side != "" && order.Side != filter.Side {
			continue
		}
		filtered = append(filtered, order)
	}

	if filter.Offset >= len(filtered) {
		return []PaperOrder{}
	}

	end := filter.Offset + filter.Limit
	if end > len(filtered) {
		end = len(filtered)
	}

	return slices.Clone(filtered[filter.Offset:end])
}

type engineStateSnapshot struct {
	account          VirtualAccount
	orderCounter     uint64
	orders           []PaperOrder
	lastTradePrices  map[string]float64
	markPrices       map[string]marketdata.PriceTickV1
	realizedPnL      float64
	currentSession   SimulationSession
	auditEvents      []AuditEvent
	feesPaid         float64
	slippageCost     float64
	filledOrders     int
	rejectedSignals  int
	symbolStats      map[string]sessionSymbolMetrics
	peakEquity       float64
	maxDrawdown      float64
	lastOrderAt      map[string]time.Time
	processedSignals map[string]struct{}
}

func (e *Engine) snapshotLockedState() engineStateSnapshot {
	return engineStateSnapshot{
		account:          cloneAccount(e.account),
		orderCounter:     e.orderCounter,
		orders:           cloneOrders(e.orders),
		lastTradePrices:  cloneLastTradePrices(e.lastTradePrices),
		markPrices:       cloneMarketPrices(e.markPrices),
		realizedPnL:      e.realizedPnL,
		currentSession:   e.currentSession,
		auditEvents:      cloneAuditEvents(e.auditEvents),
		feesPaid:         e.feesPaid,
		slippageCost:     e.slippageCost,
		filledOrders:     e.filledOrders,
		rejectedSignals:  e.rejectedSignals,
		symbolStats:      cloneSymbolStats(e.symbolStats),
		peakEquity:       e.peakEquity,
		maxDrawdown:      e.maxDrawdown,
		lastOrderAt:      cloneTimeMap(e.lastOrderAt),
		processedSignals: cloneSignalIndex(e.processedSignals),
	}
}

func (e *Engine) restoreLockedState(snapshot engineStateSnapshot) {
	e.account = snapshot.account
	e.orderCounter = snapshot.orderCounter
	e.orders = snapshot.orders
	e.lastTradePrices = snapshot.lastTradePrices
	e.markPrices = snapshot.markPrices
	e.realizedPnL = snapshot.realizedPnL
	e.currentSession = snapshot.currentSession
	e.auditEvents = snapshot.auditEvents
	e.feesPaid = snapshot.feesPaid
	e.slippageCost = snapshot.slippageCost
	e.filledOrders = snapshot.filledOrders
	e.rejectedSignals = snapshot.rejectedSignals
	e.symbolStats = snapshot.symbolStats
	e.peakEquity = snapshot.peakEquity
	e.maxDrawdown = snapshot.maxDrawdown
	e.lastOrderAt = snapshot.lastOrderAt
	e.processedSignals = snapshot.processedSignals
}

func deriveLastTradePrices(orders []PaperOrder) map[string]float64 {
	lastTradePrices := make(map[string]float64)
	for _, order := range orders {
		lastTradePrices[order.Symbol] = order.Price
	}
	return lastTradePrices
}

func deriveOrderCounter(orders []PaperOrder) uint64 {
	maxCounter := uint64(len(orders))
	for _, order := range orders {
		rawCounter, found := strings.CutPrefix(order.ID, "paper-order-")
		if !found {
			continue
		}

		parsedCounter, err := strconv.ParseUint(rawCounter, 10, 64)
		if err != nil {
			continue
		}
		if parsedCounter > maxCounter {
			maxCounter = parsedCounter
		}
	}

	return maxCounter
}
