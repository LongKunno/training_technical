package papertrading

import (
	"errors"
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
	e.pendingExecutions = nil
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
	for index := range e.orders {
		if e.orders[index].SessionID == "" {
			e.orders[index].SessionID = e.currentSession.ID
		}
	}
	e.auditEvents = cloneAuditEvents(state.AuditEvents)
	e.lastOrderAt = deriveLastOrderTimes(state.Orders)
	e.currentMarketProfile = cloneMarketExecutionProfile(state.MarketProfile)
	e.pendingExecutions = clonePendingExecutions(state.PendingExecutions)
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

func (e *Engine) StartSessionWithProfile(sessionID string, profile SessionExecutionProfile) (SimulationSession, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	return e.startSessionLocked(sessionID, profile, map[string]any{
		"source": "simulation-run",
	})
}

func (e *Engine) buildPersistentStateLocked() PersistentState {
	processedSignals := make([]string, 0, len(e.processedSignals))
	for signalID := range e.processedSignals {
		processedSignals = append(processedSignals, signalID)
	}
	slices.Sort(processedSignals)

	return PersistentState{
		Account:           cloneAccount(e.account),
		InitialBalance:    e.initialBalance,
		RealizedPnL:       e.realizedPnL,
		Rules:             e.rules,
		MarketProfile:     cloneMarketExecutionProfile(e.currentMarketProfile),
		Orders:            cloneOrders(e.orders),
		PendingExecutions: clonePendingExecutions(e.pendingExecutions),
		MarketPrices:      cloneMarketPrices(e.markPrices),
		Session:           e.currentSession,
		AuditEvents:       cloneAuditEvents(e.auditEvents),
		Report:            e.buildSessionReportLocked(),
		PeakEquity:        e.peakEquity,
		ProcessedSignals:  processedSignals,
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

	return e.startSessionLocked(sessionID, SessionExecutionProfile{
		InitialBalance: e.defaultBalance,
		Rules:          cloneSimulationRules(e.defaultRules),
		MarketProfile:  MarketExecutionProfile{},
	}, map[string]any{
		"source": "manual-start",
	})
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

func (e *Engine) startSessionLocked(sessionID string, profile SessionExecutionProfile, details map[string]any) (SimulationSession, error) {
	previousState := e.snapshotLockedState()
	now := time.Now().UTC()
	if strings.TrimSpace(sessionID) == "" {
		sessionID = newSessionID(now)
	}

	if err := validateEngineBootstrap(e.account.ID, profile.InitialBalance, profile.Rules); err != nil {
		return SimulationSession{}, err
	}
	if err := validateMarketExecutionProfile(profile.MarketProfile); err != nil {
		return SimulationSession{}, err
	}

	e.initialBalance = profile.InitialBalance
	e.rules = cloneSimulationRules(profile.Rules)
	e.currentMarketProfile = cloneMarketExecutionProfile(profile.MarketProfile)
	e.resetTradingStateLocked()
	e.currentSession = SimulationSession{
		ID:          sessionID,
		Status:      SessionStatusRunning,
		StartedAt:   now,
		LastEventAt: now,
	}
	e.appendAuditLocked("session_started", "simulation session started", "", now, details)
	e.appendTimelinePointLocked(now, "session_started")

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
	e.finalizePendingExecutionsForSessionStopLocked(now)
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

	previousState := e.snapshotLockedState()
	details := map[string]any{
		"source":      "signal",
		"strategy_id": signal.StrategyID,
		"signal_id":   signal.SignalID,
		"run_id":      signal.RunID,
		"bot_id":      signal.BotID,
		"bot_version": signal.BotVersion,
	}
	e.appendAuditLocked("signal_received", "signal received", signal.Symbol, signal.Timestamp, map[string]any{
		"strategy_id": signal.StrategyID,
		"signal_id":   signal.SignalID,
		"side":        signal.Side,
		"run_id":      signal.RunID,
		"bot_id":      signal.BotID,
		"bot_version": signal.BotVersion,
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

	reservedOrderID := fmt.Sprintf("paper-order-%d", e.orderCounter+1)
	pending := PendingExecution{
		OrderID:               reservedOrderID,
		SignalID:              signal.SignalID,
		StrategyID:            signal.StrategyID,
		RunID:                 signal.RunID,
		BotID:                 signal.BotID,
		BotVersion:            signal.BotVersion,
		Symbol:                signal.Symbol,
		Side:                  signal.Side,
		RequestedQuantity:     quantity,
		RequestedNotional:     signal.Notional,
		RequestedPrice:        priceHint,
		RemainingQuantity:     quantity,
		RemainingLatencyTicks: e.currentMarketProfile.SignalLatencyTicks,
		CreatedAt:             signal.Timestamp,
		Details:               cloneDetails(details),
	}
	if pending.RequestedNotional <= 0 {
		pending.RequestedNotional = quantity * priceHint
	}

	var order *PaperOrder
	if pending.RemainingLatencyTicks == 0 {
		marketPrice := e.currentMarketPriceLocked(signal.Symbol)
		if marketPrice <= 0 {
			marketPrice = priceHint
		}
		order, err = e.processPendingExecutionAttemptLocked(&pending, marketPrice, signal.Timestamp)
		if err != nil {
			e.restoreLockedState(previousState)
			e.rejectSignalLocked(signal, err)
			return SignalExecution{}, err
		}
		if pending.RemainingQuantity > 0 {
			e.pendingExecutions = append(e.pendingExecutions, pending)
		}
	} else {
		e.pendingExecutions = append(e.pendingExecutions, pending)
		e.appendAuditLocked("signal_queued", "signal queued for execution", signal.Symbol, signal.Timestamp, map[string]any{
			"signal_id":               signal.SignalID,
			"strategy_id":             signal.StrategyID,
			"side":                    signal.Side,
			"requested_quantity":      quantity,
			"requested_price":         priceHint,
			"remaining_latency_ticks": pending.RemainingLatencyTicks,
			"run_id":                  signal.RunID,
			"bot_id":                  signal.BotID,
			"bot_version":             signal.BotVersion,
		})
	}

	e.orderCounter++
	e.processedSignals[signal.SignalID] = struct{}{}
	if err := e.persistLocked(); err != nil {
		e.restoreLockedState(previousState)
		return SignalExecution{}, err
	}

	return SignalExecution{
		SignalID:      signal.SignalID,
		StrategyID:    signal.StrategyID,
		RunID:         signal.RunID,
		BotID:         signal.BotID,
		BotVersion:    signal.BotVersion,
		Status:        "accepted",
		Order:         order,
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
		ID:                fmt.Sprintf("paper-order-%d", e.orderCounter),
		SessionID:         e.currentSession.ID,
		AccountID:         e.account.ID,
		Symbol:            request.Symbol,
		Side:              request.Side,
		Quantity:          request.Quantity,
		RequestedQuantity: request.Quantity,
		Price:             executionPrice,
		RequestedPrice:    request.Price,
		Notional:          notional,
		RequestedNotional: request.Quantity * request.Price,
		Fee:               fee,
		FeeRate:           e.rules.FeeRate,
		SlippageRate:      e.rules.SlippageRate,
		FillCount:         1,
		RemainingQuantity: 0,
		Status:            "filled",
		ExecutedAt:        executedAt,
	}

	e.lastTradePrices[request.Symbol] = executionPrice
	e.orders = append(e.orders, order)
	e.noteFilledOrderLocked(&e.orders[len(e.orders)-1], request.Quantity, fee, executionPrice, true, "order_filled", "paper order filled", extraDetails)
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

func validateMarketExecutionProfile(profile MarketExecutionProfile) error {
	if profile.SignalLatencyTicks < 0 {
		return ErrInvalidMarketProfile
	}
	if profile.SpreadBps < 0 {
		return ErrInvalidMarketProfile
	}
	if profile.MaxFillNotionalPerTick < 0 {
		return ErrInvalidMarketProfile
	}
	previousMaxNotional := 0.0
	for _, point := range profile.LiquidityCurve {
		if point.MaxNotional <= 0 {
			return ErrInvalidMarketProfile
		}
		if point.MaxNotional < previousMaxNotional {
			return ErrInvalidMarketProfile
		}
		if point.FillRatio <= 0 || point.FillRatio > 1 {
			return ErrInvalidMarketProfile
		}
		previousMaxNotional = point.MaxNotional
	}
	if profile.QueuePriority < 0 || profile.QueuePriority > 1 {
		return ErrInvalidMarketProfile
	}
	if profile.MarketImpactBpsPer10k < 0 {
		return ErrInvalidMarketProfile
	}
	if profile.CancelAfterTicks < 0 {
		return ErrInvalidMarketProfile
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
	details := map[string]any{
		"strategy_id": signal.StrategyID,
		"signal_id":   signal.SignalID,
		"side":        signal.Side,
		"run_id":      signal.RunID,
		"bot_id":      signal.BotID,
		"bot_version": signal.BotVersion,
		"reason":      err.Error(),
	}
	if riskControl := riskRejectReason(err); riskControl != "" {
		details["risk_control"] = riskControl
	}
	e.appendAuditLocked("signal_rejected", err.Error(), signal.Symbol, time.Now().UTC(), details)
}

func (e *Engine) noteFilledOrderLocked(order *PaperOrder, fillQuantity float64, fillFee float64, fillPrice float64, firstFill bool, eventType string, message string, extraDetails map[string]any) {
	e.lastOrderAt[order.Symbol] = order.ExecutedAt
	e.feesPaid += fillFee
	e.slippageCost += abs(fillPrice-order.RequestedPrice) * fillQuantity
	if firstFill {
		e.filledOrders++
	}

	metrics := e.symbolStats[order.Symbol]
	if firstFill {
		metrics.FilledOrders++
	}
	metrics.FeesPaid += fillFee
	e.symbolStats[order.Symbol] = metrics

	details := map[string]any{
		"order_id":            order.ID,
		"side":                order.Side,
		"quantity":            fillQuantity,
		"cumulative_quantity": order.Quantity,
		"remaining_quantity":  order.RemainingQuantity,
		"price":               fillPrice,
		"average_fill_price":  order.Price,
		"requested_price":     order.RequestedPrice,
		"fee":                 fillFee,
		"fill_count":          order.FillCount,
	}
	for key, value := range extraDetails {
		details[key] = value
	}

	e.appendAuditLocked(eventType, message, order.Symbol, order.ExecutedAt, details)
}

func (e *Engine) processPendingExecutionSliceLocked(execution *PendingExecution, marketPrice float64, timestamp time.Time) (*PaperOrder, error) {
	baseExecutionPrice := e.applyQuotedExecutionPrice(execution.Side, marketPrice)
	fillQuantity := e.maxFillQuantityForTick(execution.RemainingQuantity, baseExecutionPrice)
	if fillQuantity <= 0 {
		return nil, ErrInvalidQuantity
	}
	executionPrice := e.applyMarketImpact(execution.Side, baseExecutionPrice, fillQuantity*baseExecutionPrice)

	request := PlaceOrderRequest{
		Symbol:   execution.Symbol,
		Side:     execution.Side,
		Quantity: fillQuantity,
		Price:    marketPrice,
	}
	if err := e.validateOrderGuardsLocked(request, executionPrice, timestamp); err != nil {
		if index := e.findOrderIndexByIDLocked(execution.OrderID); index >= 0 {
			e.finalizeOrderLocked(&e.orders[index], "stopped", err.Error(), timestamp, "order_fill_stopped", "paper order stopped before full fill", execution.Details)
			return &e.orders[index], nil
		}
		return nil, err
	}

	index, firstFill := e.ensurePendingOrderLocked(*execution, timestamp)
	order := &e.orders[index]
	fillNotional := fillQuantity * executionPrice
	fillFee := fillNotional * e.rules.FeeRate

	switch execution.Side {
	case OrderSideBuy:
		totalDebit := fillNotional + fillFee
		e.account.CashBalance -= totalDebit
		e.applyBuy(execution.Symbol, fillQuantity, executionPrice, fillFee)
	case OrderSideSell:
		realizedPnL, err := e.applySell(execution.Symbol, fillQuantity, executionPrice, fillFee)
		if err != nil {
			if firstFill {
				e.orders = append(e.orders[:index], e.orders[index+1:]...)
				return nil, err
			}
			e.finalizeOrderLocked(order, "stopped", err.Error(), timestamp, "order_fill_stopped", "paper order stopped before full fill", execution.Details)
			return order, nil
		}
		e.account.CashBalance += fillNotional - fillFee
		e.realizedPnL += realizedPnL
	default:
		return nil, ErrInvalidOrderSide
	}

	order.Quantity += fillQuantity
	order.Notional += fillNotional
	order.Fee += fillFee
	order.FillCount++
	order.Price = order.Notional / order.Quantity
	order.ExecutedAt = timestamp
	e.lastTradePrices[execution.Symbol] = executionPrice

	execution.RemainingQuantity -= fillQuantity
	if execution.RemainingQuantity < 1e-9 {
		execution.RemainingQuantity = 0
	}
	order.RemainingQuantity = execution.RemainingQuantity

	eventType := "order_partial_fill"
	message := "paper order partially filled"
	if execution.RemainingQuantity == 0 {
		order.Status = "filled"
		order.TerminalReason = ""
		eventType = "order_filled"
		message = "paper order filled"
	} else {
		order.Status = "partially_filled"
	}

	e.noteFilledOrderLocked(order, fillQuantity, fillFee, executionPrice, firstFill, eventType, message, execution.Details)
	e.updateDrawdownLocked()
	e.appendTimelinePointLocked(timestamp, eventType)
	return order, nil
}

func (e *Engine) processPendingExecutionAttemptLocked(execution *PendingExecution, marketPrice float64, timestamp time.Time) (*PaperOrder, error) {
	execution.ElapsedExecutionTicks++
	order, err := e.processPendingExecutionSliceLocked(execution, marketPrice, timestamp)
	if err != nil {
		return nil, err
	}
	if execution.RemainingQuantity > 0 && e.shouldCancelAfterTicks(*execution) {
		e.finalizeOrderLocked(order, "stopped", "cancel_after_ticks", timestamp, "order_fill_stopped", "paper order stopped before full fill", execution.Details)
		execution.RemainingQuantity = 0
	}
	return order, nil
}

func (e *Engine) ensurePendingOrderLocked(execution PendingExecution, timestamp time.Time) (int, bool) {
	if index := e.findOrderIndexByIDLocked(execution.OrderID); index >= 0 {
		return index, false
	}

	e.orders = append(e.orders, PaperOrder{
		ID:                execution.OrderID,
		SessionID:         e.currentSession.ID,
		AccountID:         e.account.ID,
		Symbol:            execution.Symbol,
		Side:              execution.Side,
		Quantity:          0,
		RequestedQuantity: execution.RequestedQuantity,
		Price:             0,
		RequestedPrice:    execution.RequestedPrice,
		Notional:          0,
		RequestedNotional: execution.RequestedNotional,
		Fee:               0,
		FeeRate:           e.rules.FeeRate,
		SlippageRate:      e.rules.SlippageRate,
		FillCount:         0,
		RemainingQuantity: execution.RequestedQuantity,
		Status:            "pending",
		ExecutedAt:        timestamp,
	})
	return len(e.orders) - 1, true
}

func (e *Engine) findOrderIndexByIDLocked(orderID string) int {
	for index := range e.orders {
		if e.orders[index].ID == orderID {
			return index
		}
	}
	return -1
}

func (e *Engine) finalizeOrderLocked(order *PaperOrder, status string, reason string, timestamp time.Time, eventType string, message string, extraDetails map[string]any) {
	order.Status = status
	order.TerminalReason = strings.TrimSpace(reason)
	order.ExecutedAt = timestamp

	details := map[string]any{
		"order_id":            order.ID,
		"side":                order.Side,
		"cumulative_quantity": order.Quantity,
		"remaining_quantity":  order.RemainingQuantity,
		"requested_price":     order.RequestedPrice,
		"terminal_reason":     order.TerminalReason,
	}
	for key, value := range extraDetails {
		details[key] = value
	}

	e.appendAuditLocked(eventType, message, order.Symbol, timestamp, details)
	e.appendTimelinePointLocked(timestamp, eventType)
}

func (e *Engine) finalizePendingExecutionsForSessionStopLocked(timestamp time.Time) {
	if len(e.pendingExecutions) == 0 {
		return
	}

	for _, execution := range e.pendingExecutions {
		if index := e.findOrderIndexByIDLocked(execution.OrderID); index >= 0 {
			e.finalizeOrderLocked(&e.orders[index], "stopped", "session_stopped", timestamp, "order_fill_stopped", "paper order stopped before full fill", execution.Details)
			continue
		}
		e.rejectSignalLocked(SignalV1{
			StrategyID: execution.StrategyID,
			SignalID:   execution.SignalID,
			RunID:      execution.RunID,
			BotID:      execution.BotID,
			BotVersion: execution.BotVersion,
			Symbol:     execution.Symbol,
			Side:       execution.Side,
			Quantity:   execution.RequestedQuantity,
			Notional:   execution.RequestedNotional,
			PriceHint:  execution.RequestedPrice,
			Timestamp:  execution.CreatedAt,
		}, ErrSessionStopped)
	}
	e.pendingExecutions = nil
}

func (e *Engine) applyQuotedExecutionPrice(side OrderSide, marketPrice float64) float64 {
	spreadMultiplier := e.currentMarketProfile.SpreadBps / 20000
	switch side {
	case OrderSideBuy:
		return e.applySlippage(side, marketPrice*(1+spreadMultiplier))
	case OrderSideSell:
		return e.applySlippage(side, marketPrice*(1-spreadMultiplier))
	default:
		return e.applySlippage(side, marketPrice)
	}
}

func (e *Engine) maxFillQuantityForTick(remainingQuantity float64, executionPrice float64) float64 {
	if remainingQuantity <= 0 {
		return 0
	}
	if executionPrice <= 0 {
		return 0
	}
	remainingNotional := remainingQuantity * executionPrice
	fillNotional := remainingNotional
	if e.currentMarketProfile.MaxFillNotionalPerTick > 0 && e.currentMarketProfile.MaxFillNotionalPerTick < fillNotional {
		fillNotional = e.currentMarketProfile.MaxFillNotionalPerTick
	}

	// Formula: min(remaining notional, per-tick cap) * liquidity ratio(remaining notional) * queue priority.
	fillNotional *= e.liquidityFillRatio(remainingNotional)
	fillNotional *= e.effectiveQueuePriority()
	if fillNotional <= 0 {
		return 0
	}
	if fillNotional >= remainingNotional {
		return remainingQuantity
	}
	return fillNotional / executionPrice
}

func (e *Engine) liquidityFillRatio(remainingNotional float64) float64 {
	if len(e.currentMarketProfile.LiquidityCurve) == 0 {
		return 1
	}
	for _, point := range e.currentMarketProfile.LiquidityCurve {
		if remainingNotional <= point.MaxNotional {
			return point.FillRatio
		}
	}
	return e.currentMarketProfile.LiquidityCurve[len(e.currentMarketProfile.LiquidityCurve)-1].FillRatio
}

func (e *Engine) effectiveQueuePriority() float64 {
	if e.currentMarketProfile.QueuePriority <= 0 {
		return 1
	}
	return e.currentMarketProfile.QueuePriority
}

func (e *Engine) applyMarketImpact(side OrderSide, executionPrice float64, fillNotional float64) float64 {
	if e.currentMarketProfile.MarketImpactBpsPer10k <= 0 || fillNotional <= 0 {
		return executionPrice
	}
	impactMultiplier := (e.currentMarketProfile.MarketImpactBpsPer10k * (fillNotional / 10000)) / 10000
	switch side {
	case OrderSideBuy:
		return executionPrice * (1 + impactMultiplier)
	case OrderSideSell:
		return executionPrice * (1 - impactMultiplier)
	default:
		return executionPrice
	}
}

func (e *Engine) shouldCancelAfterTicks(execution PendingExecution) bool {
	return e.currentMarketProfile.CancelAfterTicks > 0 && execution.ElapsedExecutionTicks >= e.currentMarketProfile.CancelAfterTicks
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
	if request.Side == OrderSideBuy {
		totalDebit := orderNotional + (orderNotional * e.rules.FeeRate)
		if e.account.CashBalance < totalDebit {
			return ErrInsufficientFunds
		}
	}
	if request.Side == OrderSideSell {
		position, exists := e.account.Positions[request.Symbol]
		if !exists || position.Quantity < request.Quantity {
			return ErrInsufficientAsset
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
	executionQuality := deriveExecutionQualityMetrics(e.orders)
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
		SessionID:          e.currentSession.ID,
		Status:             e.currentSession.Status,
		StartedAt:          e.currentSession.StartedAt,
		StoppedAt:          e.currentSession.StoppedAt,
		ResetCount:         e.currentSession.ResetCount,
		FilledOrders:       e.filledOrders,
		RejectedSignals:    e.rejectedSignals,
		FeesPaid:           e.feesPaid,
		SlippageCost:       e.slippageCost,
		FillRatio:          executionQuality.FillRatio,
		AverageSlippageBps: executionQuality.AverageSlippageBps,
		StoppedOrders:      executionQuality.StoppedOrders,
		CancelRate:         executionQuality.CancelRate,
		RealizedPnL:        summary.RealizedPnL,
		UnrealizedPnL:      summary.UnrealizedPnL,
		TotalPnL:           summary.RealizedPnL + summary.UnrealizedPnL,
		MaxDrawdown:        e.maxDrawdown,
		Symbols:            symbols,
		Timeline:           cloneTimelinePoints(e.timeline),
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
	e.pendingExecutions = nil
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

func riskRejectReason(err error) string {
	switch {
	case errors.Is(err, ErrSymbolBlocked):
		return "symbol_blocked"
	case errors.Is(err, ErrMaxPositionExceeded):
		return "max_position_quantity"
	case errors.Is(err, ErrMaxOrderNotionalExceeded):
		return "max_order_notional"
	case errors.Is(err, ErrMaxDailyLossExceeded):
		return "max_daily_loss"
	case errors.Is(err, ErrCooldownActive):
		return "cooldown"
	case errors.Is(err, ErrMaxOpenNotionalExceeded):
		return "max_open_notional"
	default:
		return ""
	}
}

func orderSlippageCost(order PaperOrder) float64 {
	return abs(order.Price-order.RequestedPrice) * order.Quantity
}

type executionQualityMetrics struct {
	FillRatio          float64
	AverageSlippageBps float64
	StoppedOrders      int
	CancelRate         float64
}

func deriveExecutionQualityMetrics(orders []PaperOrder) executionQualityMetrics {
	var requestedQuantity float64
	var filledQuantity float64
	var filledNotional float64
	var slippageCost float64
	var attemptedOrders int
	var stoppedOrders int

	for _, order := range orders {
		requested := order.RequestedQuantity
		if requested <= 0 {
			requested = order.Quantity + order.RemainingQuantity
		}
		if requested <= 0 && order.Quantity > 0 {
			requested = order.Quantity
		}
		if requested > 0 {
			requestedQuantity += requested
			attemptedOrders++
		}

		if order.Quantity > 0 {
			filledQuantity += order.Quantity
			notional := order.Notional
			if notional <= 0 {
				notional = order.Price * order.Quantity
			}
			filledNotional += notional
			slippageCost += orderSlippageCost(order)
		}

		if order.Status == "stopped" {
			stoppedOrders++
		}
	}

	metrics := executionQualityMetrics{
		StoppedOrders: stoppedOrders,
	}
	if requestedQuantity > 0 {
		metrics.FillRatio = filledQuantity / requestedQuantity
	}
	if filledNotional > 0 {
		metrics.AverageSlippageBps = (slippageCost / filledNotional) * 10000
	}
	if attemptedOrders > 0 {
		metrics.CancelRate = float64(stoppedOrders) / float64(attemptedOrders)
	}
	return metrics
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

func cloneSimulationRules(input SimulationRules) SimulationRules {
	return SimulationRules{
		FeeRate:      input.FeeRate,
		SlippageRate: input.SlippageRate,
		RiskControls: cloneRiskControls(input.RiskControls),
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
	executionQuality := deriveExecutionQualityMetrics(orders)
	report := SessionReport{
		SessionID:          session.ID,
		Status:             session.Status,
		StartedAt:          session.StartedAt,
		StoppedAt:          session.StoppedAt,
		ResetCount:         session.ResetCount,
		FillRatio:          executionQuality.FillRatio,
		AverageSlippageBps: executionQuality.AverageSlippageBps,
		StoppedOrders:      executionQuality.StoppedOrders,
		CancelRate:         executionQuality.CancelRate,
	}
	stats := make(map[string]SymbolReport)
	for _, order := range orders {
		if order.Quantity <= 0 {
			continue
		}
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
