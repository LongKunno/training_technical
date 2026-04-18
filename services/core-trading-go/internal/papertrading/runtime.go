package papertrading

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"crypto_simulator/core_trading/internal/marketdata"
)

type sessionSymbolMetrics struct {
	FilledOrders int
	FeesPaid     float64
}

func (e *Engine) bootstrapRuntimeState(now time.Time) {
	if now.IsZero() {
		now = time.Now().UTC()
	}

	e.currentSession = SimulationSession{
		ID:          newSessionID(now),
		Status:      SessionStatusRunning,
		StartedAt:   now,
		LastEventAt: now,
	}
	e.auditEvents = nil
	e.feesPaid = 0
	e.slippageCost = 0
	e.filledOrders = 0
	e.rejectedSignals = 0
	e.symbolStats = make(map[string]sessionSymbolMetrics)
	e.peakEquity = e.initialBalance
	e.maxDrawdown = 0
	e.timeline = nil
	e.lastOrderAt = make(map[string]time.Time)
	e.processedSignals = make(map[string]struct{})

	for _, order := range e.orders {
		e.feesPaid += order.Fee
		e.slippageCost += orderSlippageCost(order)
		e.filledOrders++
		e.lastOrderAt[order.Symbol] = order.ExecutedAt

		metrics := e.symbolStats[order.Symbol]
		metrics.FilledOrders++
		metrics.FeesPaid += order.Fee
		e.symbolStats[order.Symbol] = metrics
	}

	summary := e.buildPortfolioSummary()
	if summary.TotalEquity > e.peakEquity {
		e.peakEquity = summary.TotalEquity
	}

	e.appendAuditLocked("session_started", "simulation session started", "", now, nil)
	e.appendTimelinePointLocked(now, "session_started")
}

func (e *Engine) restoreRuntimeState(state PersistentState, now time.Time) {
	if state.Session.ID == "" {
		e.bootstrapRuntimeState(now)
		return
	}

	e.currentSession = state.Session
	e.auditEvents = cloneAuditEvents(state.AuditEvents)
	e.lastOrderAt = deriveLastOrderTimes(state.Orders)
	e.processedSignals = make(map[string]struct{}, len(state.ProcessedSignals))
	for _, signalID := range state.ProcessedSignals {
		e.processedSignals[signalID] = struct{}{}
	}

	report := state.Report
	if report.SessionID == "" {
		report = deriveReportFromOrders(state.Session, state.Orders)
	}

	e.feesPaid = report.FeesPaid
	e.slippageCost = report.SlippageCost
	e.filledOrders = report.FilledOrders
	e.rejectedSignals = report.RejectedSignals
	e.symbolStats = deriveSymbolStatsFromReport(report)
	e.peakEquity = state.PeakEquity
	if e.peakEquity <= 0 {
		summary := e.buildPortfolioSummary()
		e.peakEquity = summary.TotalEquity
		if e.peakEquity <= 0 {
			e.peakEquity = e.initialBalance
		}
	}
	e.maxDrawdown = report.MaxDrawdown
	e.timeline = cloneTimelinePoints(report.Timeline)
}

func (e *Engine) buildPersistentStateLocked() PersistentState {
	processedSignals := make([]string, 0, len(e.processedSignals))
	for signalID := range e.processedSignals {
		processedSignals = append(processedSignals, signalID)
	}
	slices.Sort(processedSignals)

	return PersistentState{
		Account:          cloneAccount(e.account),
		InitialBalance:   e.initialBalance,
		RealizedPnL:      e.realizedPnL,
		Rules:            e.rules,
		Orders:           cloneOrders(e.orders),
		MarketPrices:     cloneMarketPrices(e.markPrices),
		Session:          e.currentSession,
		AuditEvents:      cloneAuditEvents(e.auditEvents),
		Report:           e.buildSessionReportLocked(),
		PeakEquity:       e.peakEquity,
		ProcessedSignals: processedSignals,
	}
}

func (e *Engine) SessionSummary() SimulationSession {
	e.mu.Lock()
	defer e.mu.Unlock()

	return e.currentSession
}

func (e *Engine) SessionHistory(filter SessionHistoryFilter) ([]SessionHistoryEntry, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if filter.Limit <= 0 {
		filter.Limit = 20
	}
	if filter.Offset < 0 {
		filter.Offset = 0
	}

	if e.store == nil {
		return paginateSessionHistoryEntries(
			filterSessionHistoryEntries([]SessionHistoryEntry{e.buildSessionHistoryEntryLocked()}, filter),
			filter,
		), nil
	}

	entries, err := e.store.ListSessions(e.account.ID, filter)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return paginateSessionHistoryEntries(
			filterSessionHistoryEntries([]SessionHistoryEntry{e.buildSessionHistoryEntryLocked()}, filter),
			filter,
		), nil
	}

	return entries, nil
}

func filterSessionHistoryEntries(entries []SessionHistoryEntry, filter SessionHistoryFilter) []SessionHistoryEntry {
	filtered := make([]SessionHistoryEntry, 0, len(entries))
	query := strings.TrimSpace(strings.ToLower(filter.Query))
	for _, entry := range entries {
		if filter.Status != "" && entry.Status != filter.Status {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(entry.SessionID), query) {
			continue
		}
		filtered = append(filtered, entry)
	}

	return filtered
}

func paginateSessionHistoryEntries(entries []SessionHistoryEntry, filter SessionHistoryFilter) []SessionHistoryEntry {
	if filter.Offset >= len(entries) {
		return []SessionHistoryEntry{}
	}

	end := filter.Offset + filter.Limit
	if end > len(entries) {
		end = len(entries)
	}

	return slices.Clone(entries[filter.Offset:end])
}

func (e *Engine) StartSession(sessionID string) (SimulationSession, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	previousState := e.snapshotLockedState()
	now := time.Now().UTC()
	if strings.TrimSpace(sessionID) == "" {
		sessionID = newSessionID(now)
	}

	e.resetTradingStateLocked()
	e.currentSession = SimulationSession{
		ID:          sessionID,
		Status:      SessionStatusRunning,
		StartedAt:   now,
		LastEventAt: now,
	}
	e.appendAuditLocked("session_started", "simulation session started", "", now, map[string]any{
		"source": "manual-start",
	})
	e.appendTimelinePointLocked(now, "session_started")

	if err := e.persistLocked(); err != nil {
		e.restoreLockedState(previousState)
		return SimulationSession{}, err
	}

	return e.currentSession, nil
}

func (e *Engine) ResetSession() (SimulationSession, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	previousState := e.snapshotLockedState()
	now := time.Now().UTC()
	sessionID := e.currentSession.ID
	resetCount := e.currentSession.ResetCount + 1
	if sessionID == "" {
		sessionID = newSessionID(now)
	}

	e.resetTradingStateLocked()
	e.currentSession = SimulationSession{
		ID:          sessionID,
		Status:      SessionStatusRunning,
		StartedAt:   now,
		LastEventAt: now,
		ResetCount:  resetCount,
	}
	e.appendAuditLocked("session_reset", "simulation session reset", "", now, map[string]any{
		"reset_count": resetCount,
	})
	e.appendTimelinePointLocked(now, "session_reset")

	if err := e.persistLocked(); err != nil {
		e.restoreLockedState(previousState)
		return SimulationSession{}, err
	}

	return e.currentSession, nil
}

func (e *Engine) StopSession() (SimulationSession, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.currentSession.Status != SessionStatusRunning {
		return SimulationSession{}, ErrSessionStopped
	}

	previousState := e.snapshotLockedState()
	now := time.Now().UTC()
	e.currentSession.Status = SessionStatusStopped
	e.currentSession.StoppedAt = &now
	e.touchSessionLocked(now)
	e.appendAuditLocked("session_stopped", "simulation session stopped", "", now, nil)
	e.appendTimelinePointLocked(now, "session_stopped")

	if err := e.persistLocked(); err != nil {
		e.restoreLockedState(previousState)
		return SimulationSession{}, err
	}

	return e.currentSession, nil
}

func (e *Engine) AuditTrail(limit int, offset int) []AuditEvent {
	e.mu.Lock()
	defer e.mu.Unlock()

	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	if offset >= len(e.auditEvents) {
		return []AuditEvent{}
	}

	end := offset + limit
	if end > len(e.auditEvents) {
		end = len(e.auditEvents)
	}

	return cloneAuditEvents(e.auditEvents[offset:end])
}

func (e *Engine) CurrentReport() SessionReport {
	e.mu.Lock()
	defer e.mu.Unlock()

	return e.buildSessionReportLocked()
}

func (e *Engine) ReportBySession(sessionID string) (SessionReport, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if sessionID == "" || sessionID == e.currentSession.ID || e.store == nil {
		if sessionID != "" && sessionID != e.currentSession.ID && e.store == nil {
			return SessionReport{}, ErrSessionNotFound
		}
		return e.buildSessionReportLocked(), nil
	}

	report, found, err := e.store.LoadSessionReport(e.account.ID, sessionID)
	if err != nil {
		return SessionReport{}, err
	}
	if !found {
		return SessionReport{}, ErrSessionNotFound
	}

	return report, nil
}

func (e *Engine) TimelineBySession(sessionID string) ([]SessionTimelinePoint, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if sessionID == "" || sessionID == e.currentSession.ID || e.store == nil {
		if sessionID != "" && sessionID != e.currentSession.ID && e.store == nil {
			return nil, ErrSessionNotFound
		}
		return cloneTimelinePoints(e.timeline), nil
	}

	points, found, err := e.store.LoadSessionTimeline(e.account.ID, sessionID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrSessionNotFound
	}

	return points, nil
}

func (e *Engine) AuditTrailBySession(sessionID string, limit int, offset int) ([]AuditEvent, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if sessionID == "" || sessionID == e.currentSession.ID || e.store == nil {
		if sessionID != "" && sessionID != e.currentSession.ID && e.store == nil {
			return nil, ErrSessionNotFound
		}
		if limit <= 0 {
			limit = 100
		}
		if offset < 0 {
			offset = 0
		}
		if offset >= len(e.auditEvents) {
			return []AuditEvent{}, nil
		}

		end := offset + limit
		if end > len(e.auditEvents) {
			end = len(e.auditEvents)
		}
		return cloneAuditEvents(e.auditEvents[offset:end]), nil
	}

	events, found, err := e.store.LoadSessionAudit(e.account.ID, sessionID, limit, offset)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, ErrSessionNotFound
	}

	return events, nil
}

func (e *Engine) ProcessSignal(signal SignalV1) (SignalExecution, error) {
	if err := validateSignal(signal); err != nil {
		return SignalExecution{}, err
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	e.appendAuditLocked("signal_received", "signal received", signal.Symbol, signal.Timestamp, map[string]any{
		"strategy_id": signal.StrategyID,
		"signal_id":   signal.SignalID,
		"side":        signal.Side,
	})

	if _, exists := e.processedSignals[signal.SignalID]; exists {
		e.rejectSignalLocked(signal, ErrSignalAlreadyProcessed)
		return SignalExecution{}, ErrSignalAlreadyProcessed
	}

	quantity, priceHint, err := e.deriveSignalOrderLocked(signal)
	if err != nil {
		e.rejectSignalLocked(signal, err)
		return SignalExecution{}, err
	}

	order, err := e.placeMarketOrderLocked(PlaceOrderRequest{
		Symbol:   signal.Symbol,
		Side:     signal.Side,
		Quantity: quantity,
		Price:    priceHint,
	}, map[string]any{
		"source":      "signal",
		"strategy_id": signal.StrategyID,
		"signal_id":   signal.SignalID,
	})
	if err != nil {
		e.rejectSignalLocked(signal, err)
		return SignalExecution{}, err
	}

	e.processedSignals[signal.SignalID] = struct{}{}

	return SignalExecution{
		SignalID:      signal.SignalID,
		StrategyID:    signal.StrategyID,
		Status:        "accepted",
		Order:         &order,
		DerivedPrice:  priceHint,
		DerivedAmount: quantity,
	}, nil
}

func (e *Engine) placeMarketOrderLocked(request PlaceOrderRequest, extraDetails map[string]any) (PaperOrder, error) {
	executedAt := time.Now().UTC()
	executionPrice := e.applySlippage(request.Side, request.Price)
	if err := e.validateOrderGuardsLocked(request, executionPrice, executedAt); err != nil {
		return PaperOrder{}, err
	}

	previousState := e.snapshotLockedState()
	notional := request.Quantity * executionPrice
	fee := notional * e.rules.FeeRate
	switch request.Side {
	case OrderSideBuy:
		totalDebit := notional + fee
		if e.account.CashBalance < totalDebit {
			return PaperOrder{}, ErrInsufficientFunds
		}
		e.account.CashBalance -= totalDebit
		e.applyBuy(request.Symbol, request.Quantity, executionPrice, fee)
	case OrderSideSell:
		realizedPnL, err := e.applySell(request.Symbol, request.Quantity, executionPrice, fee)
		if err != nil {
			return PaperOrder{}, err
		}
		e.account.CashBalance += notional - fee
		e.realizedPnL += realizedPnL
	default:
		return PaperOrder{}, ErrInvalidOrderSide
	}

	e.orderCounter++
	order := PaperOrder{
		ID:             fmt.Sprintf("paper-order-%d", e.orderCounter),
		AccountID:      e.account.ID,
		Symbol:         request.Symbol,
		Side:           request.Side,
		Quantity:       request.Quantity,
		Price:          executionPrice,
		RequestedPrice: request.Price,
		Notional:       notional,
		Fee:            fee,
		FeeRate:        e.rules.FeeRate,
		SlippageRate:   e.rules.SlippageRate,
		Status:         "filled",
		ExecutedAt:     executedAt,
	}

	e.lastTradePrices[request.Symbol] = executionPrice
	e.orders = append(e.orders, order)
	e.noteFilledOrderLocked(order, extraDetails)
	e.updateDrawdownLocked()
	e.appendTimelinePointLocked(order.ExecutedAt, "order_filled")

	if err := e.persistLocked(); err != nil {
		e.restoreLockedState(previousState)
		return PaperOrder{}, err
	}

	return order, nil
}

func validateSignal(signal SignalV1) error {
	if strings.TrimSpace(signal.StrategyID) == "" {
		return ErrInvalidStrategyID
	}
	if strings.TrimSpace(signal.SignalID) == "" {
		return ErrInvalidSignalID
	}
	if strings.TrimSpace(signal.Symbol) == "" {
		return ErrInvalidSymbol
	}
	if signal.Side != OrderSideBuy && signal.Side != OrderSideSell {
		return ErrInvalidOrderSide
	}
	if signal.Timestamp.IsZero() {
		return ErrInvalidTimestamp
	}
	if signal.PriceHint < 0 {
		return ErrInvalidPrice
	}
	if signal.Quantity < 0 {
		return ErrInvalidQuantity
	}
	if signal.Notional < 0 {
		return ErrInvalidNotional
	}
	if signal.Quantity == 0 && signal.Notional == 0 {
		return ErrInvalidQuantity
	}
	if signal.Quantity > 0 && signal.Notional > 0 {
		return ErrInvalidNotional
	}

	return nil
}

func (e *Engine) deriveSignalOrderLocked(signal SignalV1) (float64, float64, error) {
	priceHint := signal.PriceHint
	if priceHint == 0 {
		priceHint = e.currentMarketPriceLocked(signal.Symbol)
	}
	if priceHint <= 0 {
		return 0, 0, ErrInvalidPrice
	}
	if signal.Quantity > 0 {
		return signal.Quantity, priceHint, nil
	}

	quantity := signal.Notional / priceHint
	if quantity <= 0 {
		return 0, 0, ErrInvalidQuantity
	}

	return quantity, priceHint, nil
}

func (e *Engine) rejectSignalLocked(signal SignalV1, err error) {
	e.rejectedSignals++
	e.appendAuditLocked("signal_rejected", err.Error(), signal.Symbol, time.Now().UTC(), map[string]any{
		"strategy_id": signal.StrategyID,
		"signal_id":   signal.SignalID,
		"side":        signal.Side,
	})
}

func (e *Engine) noteFilledOrderLocked(order PaperOrder, extraDetails map[string]any) {
	e.lastOrderAt[order.Symbol] = order.ExecutedAt
	e.feesPaid += order.Fee
	e.slippageCost += orderSlippageCost(order)
	e.filledOrders++

	metrics := e.symbolStats[order.Symbol]
	metrics.FilledOrders++
	metrics.FeesPaid += order.Fee
	e.symbolStats[order.Symbol] = metrics

	details := map[string]any{
		"side":            order.Side,
		"quantity":        order.Quantity,
		"price":           order.Price,
		"requested_price": order.RequestedPrice,
		"fee":             order.Fee,
	}
	for key, value := range extraDetails {
		details[key] = value
	}

	e.appendAuditLocked("order_filled", "paper order filled", order.Symbol, order.ExecutedAt, details)
}

func (e *Engine) validateOrderGuardsLocked(request PlaceOrderRequest, executionPrice float64, now time.Time) error {
	if e.currentSession.Status != SessionStatusRunning {
		return ErrSessionStopped
	}
	if !isSymbolAllowed(request.Symbol, e.rules.RiskControls.AllowedSymbols) {
		return ErrSymbolBlocked
	}
	if e.rules.RiskControls.MaxDailyLoss > 0 {
		summary := e.buildPortfolioSummary()
		totalPnL := summary.RealizedPnL + summary.UnrealizedPnL
		if totalPnL <= -e.rules.RiskControls.MaxDailyLoss {
			return ErrMaxDailyLossExceeded
		}
	}

	orderNotional := request.Quantity * executionPrice
	if e.rules.RiskControls.MaxOrderNotional > 0 && orderNotional > e.rules.RiskControls.MaxOrderNotional {
		return ErrMaxOrderNotionalExceeded
	}
	if e.rules.RiskControls.CooldownSeconds > 0 {
		lastOrderAt, exists := e.lastOrderAt[request.Symbol]
		if exists && now.Sub(lastOrderAt) < time.Duration(e.rules.RiskControls.CooldownSeconds)*time.Second {
			return ErrCooldownActive
		}
	}
	if request.Side == OrderSideBuy && e.rules.RiskControls.MaxPositionQuantity > 0 {
		currentPosition := e.account.Positions[request.Symbol]
		if currentPosition.Quantity+request.Quantity > e.rules.RiskControls.MaxPositionQuantity {
			return ErrMaxPositionExceeded
		}
	}
	if request.Side == OrderSideBuy && e.rules.RiskControls.MaxOpenNotional > 0 {
		if e.currentOpenNotionalLocked()+orderNotional > e.rules.RiskControls.MaxOpenNotional {
			return ErrMaxOpenNotionalExceeded
		}
	}

	return nil
}

func (e *Engine) currentOpenNotionalLocked() float64 {
	total := 0.0
	for symbol, position := range e.account.Positions {
		total += position.Quantity * e.currentMarketPriceLocked(symbol)
	}

	return total
}

func (e *Engine) currentMarketPriceLocked(symbol string) float64 {
	if tick, exists := e.markPrices[symbol]; exists && tick.Price > 0 {
		return tick.Price
	}
	if price := e.lastTradePrices[symbol]; price > 0 {
		return price
	}
	if position, exists := e.account.Positions[symbol]; exists && position.AveragePrice > 0 {
		return position.AveragePrice
	}

	return 0
}

func (e *Engine) updateDrawdownLocked() {
	totalEquity := e.buildPortfolioSummary().TotalEquity
	if totalEquity > e.peakEquity {
		e.peakEquity = totalEquity
	}

	drawdown := e.peakEquity - totalEquity
	if drawdown > e.maxDrawdown {
		e.maxDrawdown = drawdown
	}
}

func (e *Engine) buildSessionHistoryEntryLocked() SessionHistoryEntry {
	report := e.buildSessionReportLocked()
	return SessionHistoryEntry{
		SessionID:       e.currentSession.ID,
		Status:          e.currentSession.Status,
		StartedAt:       e.currentSession.StartedAt,
		StoppedAt:       e.currentSession.StoppedAt,
		LastEventAt:     e.currentSession.LastEventAt,
		ResetCount:      e.currentSession.ResetCount,
		FilledOrders:    report.FilledOrders,
		RejectedSignals: report.RejectedSignals,
		RealizedPnL:     report.RealizedPnL,
		TotalPnL:        report.TotalPnL,
		MaxDrawdown:     report.MaxDrawdown,
	}
}

func (e *Engine) appendTimelinePointLocked(timestamp time.Time, eventType string) {
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}

	summary := e.buildPortfolioSummary()
	point := SessionTimelinePoint{
		Timestamp:     timestamp,
		Equity:        summary.TotalEquity,
		CashBalance:   summary.CashBalance,
		UnrealizedPnL: summary.UnrealizedPnL,
		Drawdown:      e.peakEquity - summary.TotalEquity,
		EventType:     eventType,
	}
	e.timeline = append(e.timeline, point)
	for _, subscriber := range e.subscribers {
		select {
		case subscriber <- point:
		default:
		}
	}
}

func (e *Engine) buildSessionReportLocked() SessionReport {
	summary := e.buildPortfolioSummary()
	symbols := make([]SymbolReport, 0, len(e.symbolStats))
	for symbol, metrics := range e.symbolStats {
		symbols = append(symbols, SymbolReport{
			Symbol:       symbol,
			FilledOrders: metrics.FilledOrders,
			FeesPaid:     metrics.FeesPaid,
		})
	}
	slices.SortFunc(symbols, func(a SymbolReport, b SymbolReport) int {
		return strings.Compare(a.Symbol, b.Symbol)
	})

	return SessionReport{
		SessionID:       e.currentSession.ID,
		Status:          e.currentSession.Status,
		StartedAt:       e.currentSession.StartedAt,
		StoppedAt:       e.currentSession.StoppedAt,
		ResetCount:      e.currentSession.ResetCount,
		FilledOrders:    e.filledOrders,
		RejectedSignals: e.rejectedSignals,
		FeesPaid:        e.feesPaid,
		SlippageCost:    e.slippageCost,
		RealizedPnL:     summary.RealizedPnL,
		UnrealizedPnL:   summary.UnrealizedPnL,
		TotalPnL:        summary.RealizedPnL + summary.UnrealizedPnL,
		MaxDrawdown:     e.maxDrawdown,
		Symbols:         symbols,
		Timeline:        cloneTimelinePoints(e.timeline),
	}
}

func (e *Engine) resetTradingStateLocked() {
	e.account = VirtualAccount{
		ID:          e.account.ID,
		CashBalance: e.initialBalance,
		Positions:   make(map[string]Position),
	}
	e.orderCounter = 0
	e.orders = nil
	e.lastTradePrices = make(map[string]float64)
	e.markPrices = make(map[string]marketdata.PriceTickV1)
	e.realizedPnL = 0
	e.auditEvents = nil
	e.feesPaid = 0
	e.slippageCost = 0
	e.filledOrders = 0
	e.rejectedSignals = 0
	e.symbolStats = make(map[string]sessionSymbolMetrics)
	e.peakEquity = e.initialBalance
	e.maxDrawdown = 0
	e.timeline = nil
	e.lastOrderAt = make(map[string]time.Time)
	e.processedSignals = make(map[string]struct{})
}

func (e *Engine) appendAuditLocked(eventType string, message string, symbol string, timestamp time.Time, details map[string]any) {
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}

	event := AuditEvent{
		ID:        fmt.Sprintf("%s-%d", e.currentSession.ID, len(e.auditEvents)+1),
		SessionID: e.currentSession.ID,
		Type:      eventType,
		Message:   message,
		Symbol:    symbol,
		Timestamp: timestamp,
		Details:   cloneDetails(details),
	}
	e.auditEvents = append(e.auditEvents, event)
	e.touchSessionLocked(timestamp)
}

func (e *Engine) touchSessionLocked(timestamp time.Time) {
	if timestamp.IsZero() {
		timestamp = time.Now().UTC()
	}
	if e.currentSession.LastEventAt.IsZero() || timestamp.After(e.currentSession.LastEventAt) {
		e.currentSession.LastEventAt = timestamp
	}
}

func newSessionID(now time.Time) string {
	return fmt.Sprintf("paper-session-%d", now.UnixNano())
}

func isSymbolAllowed(symbol string, allowedSymbols []string) bool {
	if len(allowedSymbols) == 0 {
		return true
	}

	for _, allowedSymbol := range allowedSymbols {
		if allowedSymbol == symbol {
			return true
		}
	}

	return false
}

func orderSlippageCost(order PaperOrder) float64 {
	return abs(order.Price-order.RequestedPrice) * order.Quantity
}

func abs(value float64) float64 {
	if value < 0 {
		return -value
	}

	return value
}

func cloneRiskControls(input RiskControls) RiskControls {
	return RiskControls{
		AllowedSymbols:      slices.Clone(input.AllowedSymbols),
		MaxPositionQuantity: input.MaxPositionQuantity,
		MaxOrderNotional:    input.MaxOrderNotional,
		MaxDailyLoss:        input.MaxDailyLoss,
		CooldownSeconds:     input.CooldownSeconds,
		MaxOpenNotional:     input.MaxOpenNotional,
	}
}

func cloneAuditEvents(input []AuditEvent) []AuditEvent {
	output := make([]AuditEvent, 0, len(input))
	for _, event := range input {
		output = append(output, AuditEvent{
			ID:        event.ID,
			SessionID: event.SessionID,
			Type:      event.Type,
			Message:   event.Message,
			Symbol:    event.Symbol,
			Timestamp: event.Timestamp,
			Details:   cloneDetails(event.Details),
		})
	}

	return output
}

func cloneDetails(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}

	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}

	return output
}

func cloneSymbolStats(input map[string]sessionSymbolMetrics) map[string]sessionSymbolMetrics {
	output := make(map[string]sessionSymbolMetrics, len(input))
	for symbol, metrics := range input {
		output[symbol] = metrics
	}

	return output
}

func cloneTimeMap(input map[string]time.Time) map[string]time.Time {
	output := make(map[string]time.Time, len(input))
	for key, value := range input {
		output[key] = value
	}

	return output
}

func cloneSignalIndex(input map[string]struct{}) map[string]struct{} {
	output := make(map[string]struct{}, len(input))
	for signalID := range input {
		output[signalID] = struct{}{}
	}

	return output
}

func deriveLastOrderTimes(orders []PaperOrder) map[string]time.Time {
	output := make(map[string]time.Time, len(orders))
	for _, order := range orders {
		current := output[order.Symbol]
		if current.IsZero() || order.ExecutedAt.After(current) {
			output[order.Symbol] = order.ExecutedAt
		}
	}

	return output
}

func deriveReportFromOrders(session SimulationSession, orders []PaperOrder) SessionReport {
	report := SessionReport{
		SessionID:  session.ID,
		Status:     session.Status,
		StartedAt:  session.StartedAt,
		StoppedAt:  session.StoppedAt,
		ResetCount: session.ResetCount,
	}
	stats := make(map[string]SymbolReport)
	for _, order := range orders {
		report.FilledOrders++
		report.FeesPaid += order.Fee
		report.SlippageCost += orderSlippageCost(order)
		symbol := stats[order.Symbol]
		symbol.Symbol = order.Symbol
		symbol.FilledOrders++
		symbol.FeesPaid += order.Fee
		stats[order.Symbol] = symbol
	}

	for _, symbol := range stats {
		report.Symbols = append(report.Symbols, symbol)
	}
	slices.SortFunc(report.Symbols, func(a SymbolReport, b SymbolReport) int {
		return strings.Compare(a.Symbol, b.Symbol)
	})

	return report
}

func deriveSymbolStatsFromReport(report SessionReport) map[string]sessionSymbolMetrics {
	output := make(map[string]sessionSymbolMetrics, len(report.Symbols))
	for _, symbol := range report.Symbols {
		output[symbol.Symbol] = sessionSymbolMetrics{
			FilledOrders: symbol.FilledOrders,
			FeesPaid:     symbol.FeesPaid,
		}
	}

	return output
}
