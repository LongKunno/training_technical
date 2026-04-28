package papertrading_test

import (
	"errors"
	"math"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"crypto_simulator/core_trading/internal/marketdata"
	"crypto_simulator/core_trading/internal/papertrading"
)

func TestPlaceMarketOrderBuySuccess(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	order, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 2,
		Price:    100,
	})
	if err != nil {
		t.Fatalf("expected order to succeed, got error: %v", err)
	}

	account := engine.Snapshot()
	position := account.Positions["BTCUSDT"]

	if order.Status != "filled" {
		t.Fatalf("expected filled order, got %q", order.Status)
	}

	if account.CashBalance != 800 {
		t.Fatalf("expected balance 800, got %v", account.CashBalance)
	}

	if position.Quantity != 2 {
		t.Fatalf("expected quantity 2, got %v", position.Quantity)
	}

	if position.AveragePrice != 100 {
		t.Fatalf("expected average price 100, got %v", position.AveragePrice)
	}
}

func TestPlaceMarketOrderRejectsInsufficientFunds(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 50)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	})
	if !errors.Is(err, papertrading.ErrInsufficientFunds) {
		t.Fatalf("expected insufficient funds error, got %v", err)
	}
}

func TestApplyMarketPriceUpdatesPortfolioValuation(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	})
	if err != nil {
		t.Fatalf("failed to place order: %v", err)
	}

	err = engine.ApplyMarketPrice(marketdata.PriceTickV1{
		Symbol:    "BTCUSDT",
		Price:     150,
		Source:    "mock-replay",
		Timestamp: time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("failed to apply market price: %v", err)
	}

	summary := engine.PortfolioSummary()

	if summary.UnrealizedPnL != 50 {
		t.Fatalf("expected unrealized pnl 50, got %v", summary.UnrealizedPnL)
	}

	if summary.TotalEquity != 1050 {
		t.Fatalf("expected total equity 1050, got %v", summary.TotalEquity)
	}
}

func TestPlaceMarketOrderSellUpdatesRealizedAndUnrealizedPnL(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 2,
		Price:    100,
	})
	if err != nil {
		t.Fatalf("failed to place buy order: %v", err)
	}

	_, err = engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideSell,
		Quantity: 1,
		Price:    130,
	})
	if err != nil {
		t.Fatalf("failed to place sell order: %v", err)
	}

	summary := engine.PortfolioSummary()

	if summary.RealizedPnL != 30 {
		t.Fatalf("expected realized pnl 30, got %v", summary.RealizedPnL)
	}

	if summary.UnrealizedPnL != 30 {
		t.Fatalf("expected unrealized pnl 30, got %v", summary.UnrealizedPnL)
	}

	if summary.TotalEquity != 1060 {
		t.Fatalf("expected total equity 1060, got %v", summary.TotalEquity)
	}
}

func TestProcessSignalUsesNotionalToDeriveQuantity(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	execution, err := engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "mean-reversion",
		SignalID:   "signal-1",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   100,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("failed to process signal: %v", err)
	}

	if execution.Status != "accepted" {
		t.Fatalf("expected accepted signal, got %q", execution.Status)
	}
	if execution.DerivedAmount != 1 {
		t.Fatalf("expected derived amount 1, got %v", execution.DerivedAmount)
	}
}

func TestProcessSignalRiskRejectAuditIncludesStructuredReason(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngineWithRules("paper-account-1", 1000, papertrading.SimulationRules{
		RiskControls: papertrading.RiskControls{
			MaxOrderNotional: 50,
		},
	})
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "mean-reversion",
		SignalID:   "signal-1",
		RunID:      "sim-run-1",
		BotID:      "buy-and-hold",
		BotVersion: "v1",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   100,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
	})
	if !errors.Is(err, papertrading.ErrMaxOrderNotionalExceeded) {
		t.Fatalf("expected max order notional error, got %v", err)
	}

	events := engine.AuditTrail(10, 0)
	if len(events) < 2 {
		t.Fatalf("expected session start and signal reject events, got %+v", events)
	}
	rejected := events[len(events)-1]
	if rejected.Type != "signal_rejected" || rejected.Message != papertrading.ErrMaxOrderNotionalExceeded.Error() {
		t.Fatalf("expected signal_rejected max notional audit, got %+v", rejected)
	}
	if rejected.Details["signal_id"] != "signal-1" || rejected.Details["run_id"] != "sim-run-1" {
		t.Fatalf("expected signal/run ids in audit details, got %+v", rejected.Details)
	}
	if rejected.Details["reason"] != papertrading.ErrMaxOrderNotionalExceeded.Error() {
		t.Fatalf("expected structured reason, got %+v", rejected.Details)
	}
	if rejected.Details["risk_control"] != "max_order_notional" {
		t.Fatalf("expected risk control code, got %+v", rejected.Details)
	}
}

func TestProcessSignalRejectsDuplicateSignalWithoutCreatingSecondOrder(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	signal := papertrading.SignalV1{
		StrategyID: "mean-reversion",
		SignalID:   "signal-1",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   100,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
	}

	if _, err := engine.ProcessSignal(signal); err != nil {
		t.Fatalf("expected first signal to succeed, got error: %v", err)
	}
	if _, err := engine.ProcessSignal(signal); !errors.Is(err, papertrading.ErrSignalAlreadyProcessed) {
		t.Fatalf("expected duplicate signal error, got %v", err)
	}

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 1 {
		t.Fatalf("expected duplicate signal not to create a second order, got %d", len(orders))
	}
	account := engine.Snapshot()
	if position := account.Positions["BTCUSDT"]; position.Quantity != 1 {
		t.Fatalf("expected position quantity to stay 1, got %+v", position)
	}
	report := engine.CurrentReport()
	if report.FilledOrders != 1 || report.RejectedSignals != 1 {
		t.Fatalf("expected one filled order and one rejected duplicate, got %+v", report)
	}
	events := engine.AuditTrail(20, 0)
	lastEvent := events[len(events)-1]
	if lastEvent.Type != "signal_rejected" || lastEvent.Details["reason"] != papertrading.ErrSignalAlreadyProcessed.Error() {
		t.Fatalf("expected duplicate rejection audit, got %+v", lastEvent)
	}
}

func TestStopSessionBlocksNewOrders(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	if _, err := engine.StopSession(); err != nil {
		t.Fatalf("failed to stop session: %v", err)
	}

	_, err = engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	})
	if !errors.Is(err, papertrading.ErrSessionStopped) {
		t.Fatalf("expected session stopped error, got %v", err)
	}
}

func TestManualSessionLifecycleResetsTradingState(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}
	initialSession := engine.SessionSummary()
	if initialSession.ID == "" || initialSession.Status != papertrading.SessionStatusRunning {
		t.Fatalf("expected bootstrapped running session, got %+v", initialSession)
	}

	if _, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	}); err != nil {
		t.Fatalf("failed to place initial order: %v", err)
	}

	stoppedSession, err := engine.StopSession()
	if err != nil {
		t.Fatalf("failed to stop session: %v", err)
	}
	if stoppedSession.ID != initialSession.ID || stoppedSession.Status != papertrading.SessionStatusStopped || stoppedSession.StoppedAt == nil {
		t.Fatalf("expected stopped initial session with stopped_at, got %+v", stoppedSession)
	}
	if _, err := engine.StopSession(); !errors.Is(err, papertrading.ErrSessionStopped) {
		t.Fatalf("expected second stop to be rejected, got %v", err)
	}

	startedSession, err := engine.StartSession("manual-session-2")
	if err != nil {
		t.Fatalf("failed to start replacement session: %v", err)
	}
	if startedSession.ID != "manual-session-2" || startedSession.Status != papertrading.SessionStatusRunning {
		t.Fatalf("expected replacement session to run, got %+v", startedSession)
	}
	if startedSession.StoppedAt != nil || startedSession.ResetCount != 0 {
		t.Fatalf("expected replacement session metadata to reset, got %+v", startedSession)
	}
	account := engine.Snapshot()
	if account.CashBalance != 1000 || len(account.Positions) != 0 {
		t.Fatalf("expected start session to reset account state, got %+v", account)
	}
	if orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0}); len(orders) != 0 {
		t.Fatalf("expected start session to clear orders, got %+v", orders)
	}

	if _, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "ETHUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 2,
		Price:    50,
	}); err != nil {
		t.Fatalf("failed to place replacement-session order: %v", err)
	}
	resetSession, err := engine.ResetSession()
	if err != nil {
		t.Fatalf("failed to reset session: %v", err)
	}
	if resetSession.ID != "manual-session-2" || resetSession.Status != papertrading.SessionStatusRunning || resetSession.ResetCount != 1 {
		t.Fatalf("expected reset to keep session id and increment count, got %+v", resetSession)
	}
	account = engine.Snapshot()
	if account.CashBalance != 1000 || len(account.Positions) != 0 {
		t.Fatalf("expected reset session to clear account state, got %+v", account)
	}
	report := engine.CurrentReport()
	if report.FilledOrders != 0 || len(report.Timeline) != 1 || report.Timeline[0].EventType != "session_reset" {
		t.Fatalf("expected reset report to contain only reset event, got %+v", report)
	}
}

func TestPlaceMarketOrderRejectsBlockedSymbol(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngineWithRules("paper-account-1", 1000, papertrading.SimulationRules{
		RiskControls: papertrading.RiskControls{
			AllowedSymbols: []string{"ETHUSDT"},
		},
	})
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	})
	if !errors.Is(err, papertrading.ErrSymbolBlocked) {
		t.Fatalf("expected symbol blocked error, got %v", err)
	}

	events := engine.AuditTrail(10, 0)
	if len(events) < 2 {
		t.Fatalf("expected session start and order reject events, got %+v", events)
	}
	rejected := events[len(events)-1]
	if rejected.Type != "order_rejected" || rejected.Message != papertrading.ErrSymbolBlocked.Error() {
		t.Fatalf("expected order_rejected symbol blocked audit, got %+v", rejected)
	}
	if rejected.Details["reason"] != papertrading.ErrSymbolBlocked.Error() {
		t.Fatalf("expected structured reason, got %+v", rejected.Details)
	}
	if rejected.Details["risk_control"] != "symbol_blocked" {
		t.Fatalf("expected risk control code, got %+v", rejected.Details)
	}
}

func TestCurrentReportIncludesSessionMetrics(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	if _, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	}); err != nil {
		t.Fatalf("failed to place order: %v", err)
	}

	if err := engine.ApplyMarketPrice(marketdata.PriceTickV1{
		Symbol:    "BTCUSDT",
		Price:     150,
		Source:    "mock-replay",
		Timestamp: time.Date(2026, 4, 17, 0, 5, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("failed to apply market price: %v", err)
	}

	report := engine.CurrentReport()
	if report.FilledOrders != 1 {
		t.Fatalf("expected 1 filled order, got %d", report.FilledOrders)
	}
	if report.UnrealizedPnL != 50 {
		t.Fatalf("expected unrealized pnl 50, got %v", report.UnrealizedPnL)
	}
	if report.MaxDrawdown != 0 {
		t.Fatalf("expected max drawdown 0, got %v", report.MaxDrawdown)
	}
}

func TestReportAndTimelineUseMarkPriceWithoutMutatingFilledOrderPrice(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	order, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	})
	if err != nil {
		t.Fatalf("failed to place order: %v", err)
	}

	markTimestamp := time.Date(2026, 4, 17, 0, 5, 0, 0, time.UTC)
	if err := engine.ApplyMarketPrice(marketdata.PriceTickV1{
		Symbol:    "BTCUSDT",
		Price:     150,
		Source:    "mock-replay",
		Timestamp: markTimestamp,
	}); err != nil {
		t.Fatalf("failed to apply market price: %v", err)
	}

	report := engine.CurrentReport()
	if len(report.Timeline) < 3 {
		t.Fatalf("expected session/order/market timeline points, got %d", len(report.Timeline))
	}
	orderFillPoint := report.Timeline[len(report.Timeline)-2]
	marketTickPoint := report.Timeline[len(report.Timeline)-1]
	if orderFillPoint.EventType != "order_filled" || marketTickPoint.EventType != "market_tick" {
		t.Fatalf("expected order_filled then market_tick, got %+v", report.Timeline)
	}
	assertFloatAlmostEqual(t, orderFillPoint.Equity, 1000)
	assertFloatAlmostEqual(t, marketTickPoint.Equity, 1050)
	assertFloatAlmostEqual(t, report.UnrealizedPnL, 50)

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 1 {
		t.Fatalf("expected one order, got %d", len(orders))
	}
	assertFloatAlmostEqual(t, orders[0].Price, order.Price)
	assertFloatAlmostEqual(t, orders[0].Price, 100)
	assertFloatAlmostEqual(t, report.Timeline[len(report.Timeline)-1].UnrealizedPnL, 50)
	if !report.Timeline[len(report.Timeline)-1].Timestamp.Equal(markTimestamp) {
		t.Fatalf("expected market tick timestamp %v, got %v", markTimestamp, report.Timeline[len(report.Timeline)-1].Timestamp)
	}
}

func TestListOrdersSupportsFilteringAndPagination(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	orders := []papertrading.PlaceOrderRequest{
		{Symbol: "BTCUSDT", Side: papertrading.OrderSideBuy, Quantity: 1, Price: 100},
		{Symbol: "ETHUSDT", Side: papertrading.OrderSideBuy, Quantity: 1, Price: 50},
		{Symbol: "BTCUSDT", Side: papertrading.OrderSideSell, Quantity: 1, Price: 120},
	}

	for _, order := range orders {
		if _, err := engine.PlaceMarketOrder(order); err != nil {
			t.Fatalf("failed to place order %+v: %v", order, err)
		}
	}

	filtered := engine.ListOrders(papertrading.OrderFilter{
		Symbol: "BTCUSDT",
		Side:   papertrading.OrderSideSell,
		Limit:  10,
		Offset: 0,
	})

	if len(filtered) != 1 {
		t.Fatalf("expected 1 filtered order, got %d", len(filtered))
	}

	if filtered[0].Side != papertrading.OrderSideSell {
		t.Fatalf("expected sell order, got %q", filtered[0].Side)
	}
}

func TestPlaceMarketOrderAppliesFeeAndSlippageRules(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngineWithRules("paper-account-1", 1000, papertrading.SimulationRules{
		FeeRate:      0.01,
		SlippageRate: 0.02,
	})
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	buyOrder, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	})
	if err != nil {
		t.Fatalf("failed to place buy order: %v", err)
	}

	sellOrder, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideSell,
		Quantity: 1,
		Price:    110,
	})
	if err != nil {
		t.Fatalf("failed to place sell order: %v", err)
	}

	summary := engine.PortfolioSummary()
	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 50, Offset: 0})

	assertFloatAlmostEqual(t, buyOrder.Price, 102)
	assertFloatAlmostEqual(t, buyOrder.Fee, 1.02)
	assertFloatAlmostEqual(t, sellOrder.Price, 107.8)
	assertFloatAlmostEqual(t, sellOrder.Fee, 1.078)
	assertFloatAlmostEqual(t, summary.RealizedPnL, 3.702)
	assertFloatAlmostEqual(t, summary.TotalEquity, 1003.702)

	if len(orders) != 2 {
		t.Fatalf("expected 2 stored orders, got %d", len(orders))
	}
}

func TestNewEngineRejectsInvalidRules(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name  string
		rules papertrading.SimulationRules
		want  error
	}{
		{
			name: "negative fee rate",
			rules: papertrading.SimulationRules{
				FeeRate: -0.01,
			},
			want: papertrading.ErrInvalidFeeRate,
		},
		{
			name: "negative slippage rate",
			rules: papertrading.SimulationRules{
				SlippageRate: -0.01,
			},
			want: papertrading.ErrInvalidSlippageRate,
		},
		{
			name: "slippage rate must stay below one",
			rules: papertrading.SimulationRules{
				SlippageRate: 1,
			},
			want: papertrading.ErrInvalidSlippageRate,
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, err := papertrading.NewEngineWithRules("paper-account-1", 1000, tc.rules)
			if !errors.Is(err, tc.want) {
				t.Fatalf("expected error %v, got %v", tc.want, err)
			}
		})
	}
}

func TestPlaceMarketOrderIsMutexSafeUnderConcurrency(t *testing.T) {
	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	var successCount int32
	var insufficientFundsCount int32

	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()

			_, placeErr := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
				Symbol:   "BTCUSDT",
				Side:     papertrading.OrderSideBuy,
				Quantity: 1,
				Price:    100,
			})

			if placeErr == nil {
				atomic.AddInt32(&successCount, 1)
				return
			}

			if errors.Is(placeErr, papertrading.ErrInsufficientFunds) {
				atomic.AddInt32(&insufficientFundsCount, 1)
				return
			}

			t.Errorf("unexpected error from concurrent order placement: %v", placeErr)
		}()
	}

	wg.Wait()

	if successCount != 10 {
		t.Fatalf("expected 10 successful orders, got %d", successCount)
	}

	if insufficientFundsCount != 10 {
		t.Fatalf("expected 10 insufficient fund errors, got %d", insufficientFundsCount)
	}
}

func TestNewEngineFromPersistentStateRestoresState(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngineFromPersistentState(papertrading.PersistentState{
		Account: papertrading.VirtualAccount{
			ID:          "paper-account-1",
			CashBalance: 910,
			Positions: map[string]papertrading.Position{
				"BTCUSDT": {
					Symbol:       "BTCUSDT",
					Quantity:     1,
					AveragePrice: 100,
				},
			},
		},
		InitialBalance: 1000,
		RealizedPnL:    12,
		Rules: papertrading.SimulationRules{
			FeeRate:      0.001,
			SlippageRate: 0.002,
		},
		Orders: []papertrading.PaperOrder{
			{
				ID:             "paper-order-3",
				AccountID:      "paper-account-1",
				Symbol:         "BTCUSDT",
				Side:           papertrading.OrderSideBuy,
				Quantity:       1,
				Price:          100,
				RequestedPrice: 100,
				Notional:       100,
				Status:         "filled",
				ExecutedAt:     time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			},
		},
		MarketPrices: map[string]marketdata.PriceTickV1{
			"BTCUSDT": {
				Symbol:    "BTCUSDT",
				Price:     125,
				Source:    "mock-replay",
				Timestamp: time.Date(2026, 4, 17, 1, 0, 0, 0, time.UTC),
			},
		},
	}, papertrading.SessionExecutionProfile{
		InitialBalance: 1000,
		Rules: papertrading.SimulationRules{
			FeeRate:      0.001,
			SlippageRate: 0.002,
		},
	}, nil)
	if err != nil {
		t.Fatalf("failed to restore engine: %v", err)
	}

	summary := engine.PortfolioSummary()

	if summary.RealizedPnL != 12 {
		t.Fatalf("expected realized pnl 12, got %v", summary.RealizedPnL)
	}

	if summary.UnrealizedPnL != 25 {
		t.Fatalf("expected unrealized pnl 25, got %v", summary.UnrealizedPnL)
	}

	order, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideSell,
		Quantity: 1,
		Price:    130,
	})
	if err != nil {
		t.Fatalf("failed to place follow-up order: %v", err)
	}

	if order.ID != "paper-order-4" {
		t.Fatalf("expected next order id paper-order-4, got %q", order.ID)
	}
}

func TestNewEngineFromPersistentStateRestoresProcessedSignalsForRunningSession(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngineFromPersistentState(papertrading.PersistentState{
		Account: papertrading.VirtualAccount{
			ID:          "paper-account-1",
			CashBalance: 900,
			Positions: map[string]papertrading.Position{
				"BTCUSDT": {
					Symbol:       "BTCUSDT",
					Quantity:     1,
					AveragePrice: 100,
				},
			},
		},
		InitialBalance: 1000,
		Rules:          papertrading.SimulationRules{},
		Orders: []papertrading.PaperOrder{
			{
				ID:             "paper-order-1",
				AccountID:      "paper-account-1",
				Symbol:         "BTCUSDT",
				Side:           papertrading.OrderSideBuy,
				Quantity:       1,
				Price:          100,
				RequestedPrice: 100,
				Notional:       100,
				Status:         "filled",
				ExecutedAt:     time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			},
		},
		Session: papertrading.SimulationSession{
			ID:          "running-session-1",
			Status:      papertrading.SessionStatusRunning,
			StartedAt:   time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			LastEventAt: time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
		},
		ProcessedSignals: []string{"sig-1"},
	}, papertrading.SessionExecutionProfile{
		InitialBalance: 1000,
		Rules:          papertrading.SimulationRules{},
	}, nil)
	if err != nil {
		t.Fatalf("failed to restore engine: %v", err)
	}

	_, err = engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "mean-reversion",
		SignalID:   "sig-1",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   100,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 1, 0, 0, time.UTC),
	})
	if !errors.Is(err, papertrading.ErrSignalAlreadyProcessed) {
		t.Fatalf("expected duplicate signal to be rejected after restore, got %v", err)
	}
	if orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0}); len(orders) != 1 {
		t.Fatalf("expected restored duplicate not to create a new order, got %+v", orders)
	}

	execution, err := engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "mean-reversion",
		SignalID:   "sig-2",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   100,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 2, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("expected new signal after restore to succeed, got %v", err)
	}
	if execution.Order == nil || execution.Order.ID != "paper-order-2" {
		t.Fatalf("expected next restored order id paper-order-2, got %+v", execution.Order)
	}
	report := engine.CurrentReport()
	if report.FilledOrders != 2 || report.RejectedSignals != 1 {
		t.Fatalf("expected restored runtime metrics to include duplicate reject and new fill, got %+v", report)
	}
}

func TestNewEngineFromPersistentStateRestoresPendingExecutionAndOrderCounter(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngineFromPersistentState(papertrading.PersistentState{
		Account: papertrading.VirtualAccount{
			ID:          "paper-account-1",
			CashBalance: 1000,
			Positions:   map[string]papertrading.Position{},
		},
		InitialBalance: 1000,
		Rules:          papertrading.SimulationRules{},
		PendingExecutions: []papertrading.PendingExecution{
			{
				OrderID:               "paper-order-1",
				SignalID:              "sig-pending",
				StrategyID:            "latency-bot",
				Symbol:                "BTCUSDT",
				Side:                  papertrading.OrderSideBuy,
				RequestedQuantity:     1,
				RequestedNotional:     100,
				RequestedPrice:        100,
				RemainingQuantity:     1,
				RemainingLatencyTicks: 0,
				CreatedAt:             time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			},
		},
		Session: papertrading.SimulationSession{
			ID:          "running-session-1",
			Status:      papertrading.SessionStatusRunning,
			StartedAt:   time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			LastEventAt: time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
		},
		ProcessedSignals: []string{"sig-pending"},
	}, papertrading.SessionExecutionProfile{
		InitialBalance: 1000,
		Rules:          papertrading.SimulationRules{},
	}, nil)
	if err != nil {
		t.Fatalf("failed to restore engine: %v", err)
	}

	if _, err := engine.ApplyMarketPrices([]marketdata.PriceTickV1{
		{
			Symbol:    "BTCUSDT",
			Price:     100,
			Source:    "mock-replay",
			Timestamp: time.Date(2026, 4, 17, 0, 1, 0, 0, time.UTC),
		},
	}); err != nil {
		t.Fatalf("expected restored pending execution to fill, got %v", err)
	}

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 1 || orders[0].ID != "paper-order-1" || orders[0].Status != "filled" {
		t.Fatalf("expected restored pending execution to create filled paper-order-1, got %+v", orders)
	}

	execution, err := engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "latency-bot",
		SignalID:   "sig-2",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   100,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 2, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("expected new signal after pending restore to succeed, got %v", err)
	}
	if execution.Order == nil || execution.Order.ID != "paper-order-2" {
		t.Fatalf("expected next order id to account for restored pending execution, got %+v", execution.Order)
	}

	orders = engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 2 {
		t.Fatalf("expected restored pending fill and new order to remain separate, got %+v", orders)
	}
}

func TestPlaceMarketOrderRollsBackWhenPersistenceFails(t *testing.T) {
	t.Parallel()

	store := &failingStore{saveErr: errors.New("persist failed")}
	engine, err := papertrading.NewEngineWithStore("paper-account-1", 1000, papertrading.SimulationRules{}, store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	})
	if err == nil {
		t.Fatal("expected persistence error, got nil")
	}

	account := engine.Snapshot()
	if account.CashBalance != 1000 {
		t.Fatalf("expected rollback to preserve balance 1000, got %v", account.CashBalance)
	}
	if len(engine.ListOrders(papertrading.OrderFilter{Limit: 50, Offset: 0})) != 0 {
		t.Fatal("expected rollback to keep orders empty")
	}
	if len(account.Positions) != 0 {
		t.Fatalf("expected rollback to keep positions empty, got %+v", account.Positions)
	}
}

func TestProcessSignalRollsBackWhenPersistenceFails(t *testing.T) {
	t.Parallel()

	store := &failingStore{saveErr: errors.New("persist failed")}
	engine, err := papertrading.NewEngineWithStore("paper-account-1", 1000, papertrading.SimulationRules{}, store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	signal := papertrading.SignalV1{
		StrategyID: "mean-reversion",
		SignalID:   "signal-1",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   100,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
	}

	if _, err := engine.ProcessSignal(signal); err == nil {
		t.Fatal("expected persistence error, got nil")
	}

	account := engine.Snapshot()
	if account.CashBalance != 1000 {
		t.Fatalf("expected rollback to preserve balance 1000, got %v", account.CashBalance)
	}
	if len(account.Positions) != 0 {
		t.Fatalf("expected rollback to keep positions empty, got %+v", account.Positions)
	}
	if len(engine.ListOrders(papertrading.OrderFilter{Limit: 50, Offset: 0})) != 0 {
		t.Fatal("expected rollback to keep orders empty")
	}
	report := engine.CurrentReport()
	if report.FilledOrders != 0 || report.TotalPnL != 0 {
		t.Fatalf("expected rollback to keep report metrics clean, got %+v", report)
	}

	store.saveErr = nil
	if _, err := engine.ProcessSignal(signal); err != nil {
		t.Fatalf("expected retry after store recovery to succeed, got error: %v", err)
	}

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 50, Offset: 0})
	if len(orders) != 1 || orders[0].ID != "paper-order-1" {
		t.Fatalf("expected retry to create first order exactly once, got %+v", orders)
	}
	account = engine.Snapshot()
	if position := account.Positions["BTCUSDT"]; position.Quantity != 1 {
		t.Fatalf("expected retry to create one BTCUSDT position, got %+v", position)
	}
}

func TestApplyMarketPricesRollsBackWhenPersistenceFails(t *testing.T) {
	t.Parallel()

	store := &failingStore{saveErr: errors.New("persist failed")}
	engine, err := papertrading.NewEngineWithStore("paper-account-1", 1000, papertrading.SimulationRules{}, store)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	if _, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	}); err == nil {
		t.Fatal("expected first save attempt to fail")
	}

	store.saveErr = nil
	if _, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	}); err != nil {
		t.Fatalf("failed to place order after store recovery: %v", err)
	}

	store.saveErr = errors.New("persist failed")
	_, err = engine.ApplyMarketPrices([]marketdata.PriceTickV1{
		{
			Symbol:    "BTCUSDT",
			Price:     150,
			Source:    "mock-replay",
			Timestamp: time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
		},
	})
	if err == nil {
		t.Fatal("expected market price persistence error, got nil")
	}

	summary := engine.PortfolioSummary()
	if summary.UnrealizedPnL != 0 {
		t.Fatalf("expected mark price rollback to keep unrealized pnl 0, got %v", summary.UnrealizedPnL)
	}
}

func TestNewEngineFromPersistentStateRestoresSessionRuntime(t *testing.T) {
	t.Parallel()

	stoppedAt := time.Date(2026, 4, 17, 0, 10, 0, 0, time.UTC)
	engine, err := papertrading.NewEngineFromPersistentState(papertrading.PersistentState{
		Account: papertrading.VirtualAccount{
			ID:          "paper-account-1",
			CashBalance: 900,
			Positions: map[string]papertrading.Position{
				"BTCUSDT": {
					Symbol:       "BTCUSDT",
					Quantity:     1,
					AveragePrice: 100,
				},
			},
		},
		InitialBalance: 1000,
		RealizedPnL:    20,
		Rules:          papertrading.SimulationRules{},
		Orders: []papertrading.PaperOrder{
			{
				ID:             "paper-order-1",
				AccountID:      "paper-account-1",
				Symbol:         "BTCUSDT",
				Side:           papertrading.OrderSideBuy,
				Quantity:       1,
				Price:          100,
				RequestedPrice: 100,
				Notional:       100,
				Fee:            0.2,
				Status:         "filled",
				ExecutedAt:     time.Date(2026, 4, 17, 0, 1, 0, 0, time.UTC),
			},
		},
		MarketPrices: map[string]marketdata.PriceTickV1{
			"BTCUSDT": {
				Symbol:    "BTCUSDT",
				Price:     125,
				Source:    "mock-replay",
				Timestamp: time.Date(2026, 4, 17, 0, 5, 0, 0, time.UTC),
			},
		},
		Session: papertrading.SimulationSession{
			ID:          "session-1",
			Status:      papertrading.SessionStatusStopped,
			StartedAt:   time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			StoppedAt:   &stoppedAt,
			ResetCount:  2,
			LastEventAt: stoppedAt,
		},
		AuditEvents: []papertrading.AuditEvent{
			{
				ID:        "session-1-1",
				SessionID: "session-1",
				Type:      "session_started",
				Message:   "simulation session started",
				Timestamp: time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			},
			{
				ID:        "session-1-2",
				SessionID: "session-1",
				Type:      "signal_rejected",
				Message:   "cooldown active",
				Symbol:    "BTCUSDT",
				Timestamp: time.Date(2026, 4, 17, 0, 6, 0, 0, time.UTC),
				Details: map[string]any{
					"signal_id": "sig-2",
				},
			},
		},
		Report: papertrading.SessionReport{
			SessionID:       "session-1",
			Status:          papertrading.SessionStatusStopped,
			StartedAt:       time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
			StoppedAt:       &stoppedAt,
			ResetCount:      2,
			FilledOrders:    1,
			RejectedSignals: 1,
			FeesPaid:        0.2,
			SlippageCost:    0,
			MaxDrawdown:     15,
			Symbols: []papertrading.SymbolReport{
				{
					Symbol:       "BTCUSDT",
					FilledOrders: 1,
					FeesPaid:     0.2,
				},
			},
			Timeline: []papertrading.SessionTimelinePoint{
				{
					Timestamp:     time.Date(2026, 4, 17, 0, 0, 0, 0, time.UTC),
					Equity:        1000,
					CashBalance:   1000,
					UnrealizedPnL: 0,
					Drawdown:      0,
					EventType:     "session_started",
				},
			},
		},
		PeakEquity:       1015,
		ProcessedSignals: []string{"sig-1"},
	}, papertrading.SessionExecutionProfile{
		InitialBalance: 1000,
		Rules:          papertrading.SimulationRules{},
	}, nil)
	if err != nil {
		t.Fatalf("failed to restore engine: %v", err)
	}

	session := engine.SessionSummary()
	if session.ID != "session-1" {
		t.Fatalf("expected session-1, got %q", session.ID)
	}
	if session.Status != papertrading.SessionStatusStopped {
		t.Fatalf("expected stopped session, got %q", session.Status)
	}

	report := engine.CurrentReport()
	if report.RejectedSignals != 1 {
		t.Fatalf("expected rejected signals 1, got %d", report.RejectedSignals)
	}
	if report.MaxDrawdown != 15 {
		t.Fatalf("expected max drawdown 15, got %v", report.MaxDrawdown)
	}
	if len(report.Timeline) != 1 {
		t.Fatalf("expected restored timeline length 1, got %d", len(report.Timeline))
	}

	events := engine.AuditTrail(10, 0)
	if len(events) != 2 {
		t.Fatalf("expected 2 audit events, got %d", len(events))
	}

	_, err = engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "mean-reversion",
		SignalID:   "sig-1",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Quantity:   1,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 17, 0, 20, 0, 0, time.UTC),
	})
	if !errors.Is(err, papertrading.ErrSignalAlreadyProcessed) {
		t.Fatalf("expected signal already processed, got %v", err)
	}
}

func TestTimelineTracksOrderAndMarketEvents(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 1000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	if _, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
		Symbol:   "BTCUSDT",
		Side:     papertrading.OrderSideBuy,
		Quantity: 1,
		Price:    100,
	}); err != nil {
		t.Fatalf("failed to place order: %v", err)
	}

	if err := engine.ApplyMarketPrice(marketdata.PriceTickV1{
		Symbol:    "BTCUSDT",
		Price:     150,
		Source:    "mock-replay",
		Timestamp: time.Date(2026, 4, 17, 0, 5, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("failed to apply market price: %v", err)
	}

	timeline, err := engine.TimelineBySession(engine.SessionSummary().ID)
	if err != nil {
		t.Fatalf("failed to load timeline: %v", err)
	}
	if len(timeline) < 3 {
		t.Fatalf("expected at least 3 timeline points, got %d", len(timeline))
	}
	if timeline[len(timeline)-1].EventType != "market_tick" {
		t.Fatalf("expected last timeline event market_tick, got %q", timeline[len(timeline)-1].EventType)
	}
	if timeline[len(timeline)-1].Equity != 1050 {
		t.Fatalf("expected final equity 1050, got %v", timeline[len(timeline)-1].Equity)
	}
}

func TestSignalExecutionAppliesLiquidityQueueImpactAndCancelTimeout(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 10000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.StartSessionWithProfile("realism-v2-session", papertrading.SessionExecutionProfile{
		InitialBalance: 10000,
		Rules:          papertrading.SimulationRules{},
		MarketProfile: papertrading.MarketExecutionProfile{
			MaxFillNotionalPerTick: 1000,
			LiquidityCurve: []papertrading.LiquidityCurvePoint{
				{MaxNotional: 2000, FillRatio: 0.5},
			},
			QueuePriority:         0.5,
			MarketImpactBpsPer10k: 10,
			CancelAfterTicks:      1,
		},
	})
	if err != nil {
		t.Fatalf("failed to start profiled session: %v", err)
	}

	execution, err := engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "impact-bot",
		SignalID:   "sig-impact-1",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   4000,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 24, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("expected signal to be accepted, got error: %v", err)
	}
	if execution.Order == nil {
		t.Fatal("expected immediate partial order")
	}

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 1 {
		t.Fatalf("expected one order, got %d", len(orders))
	}

	order := orders[0]
	if order.Status != "stopped" {
		t.Fatalf("expected order to be stopped after cancel timeout, got %q", order.Status)
	}
	if order.TerminalReason != "cancel_after_ticks" {
		t.Fatalf("expected cancel_after_ticks reason, got %q", order.TerminalReason)
	}
	assertFloatAlmostEqual(t, order.Quantity, 2.5)
	assertFloatAlmostEqual(t, order.RemainingQuantity, 37.5)
	if order.Price <= 100 {
		t.Fatalf("expected market impact to worsen buy price, got %v", order.Price)
	}
	if order.FillCount != 1 {
		t.Fatalf("expected one partial fill before cancel, got %d", order.FillCount)
	}
}

func TestQueuePriorityReducesPerTickFillQuantity(t *testing.T) {
	t.Parallel()

	fullPriorityOrder := processProfiledBuySignal(t, "full-priority", papertrading.MarketExecutionProfile{
		MaxFillNotionalPerTick: 1000,
		QueuePriority:          1,
		CancelAfterTicks:       1,
	}, 4000)
	lowPriorityOrder := processProfiledBuySignal(t, "low-priority", papertrading.MarketExecutionProfile{
		MaxFillNotionalPerTick: 1000,
		QueuePriority:          0.25,
		CancelAfterTicks:       1,
	}, 4000)

	if fullPriorityOrder.Status != "stopped" || lowPriorityOrder.Status != "stopped" {
		t.Fatalf("expected both orders to stop after one tick, got full=%q low=%q", fullPriorityOrder.Status, lowPriorityOrder.Status)
	}
	assertFloatAlmostEqual(t, fullPriorityOrder.Quantity, 10)
	assertFloatAlmostEqual(t, lowPriorityOrder.Quantity, 2.5)
	assertFloatAlmostEqual(t, fullPriorityOrder.RemainingQuantity, 30)
	assertFloatAlmostEqual(t, lowPriorityOrder.RemainingQuantity, 37.5)
}

func TestPartialFillFormulaAppliesCapLiquidityCurveAndQueuePriority(t *testing.T) {
	t.Parallel()

	liquidityCurve := []papertrading.LiquidityCurvePoint{
		{MaxNotional: 2000, FillRatio: 0.8},
		{MaxNotional: 6000, FillRatio: 0.4},
	}

	tests := []struct {
		name              string
		sessionID         string
		notional          float64
		maxFillPerTick    float64
		queuePriority     float64
		wantQuantity      float64
		wantRemaining     float64
		wantRequestedQty  float64
		wantRequestedNotl float64
	}{
		{
			name:              "uncapped first liquidity tier",
			sessionID:         "formula-uncapped-first-tier",
			notional:          1500,
			maxFillPerTick:    0,
			queuePriority:     1,
			wantQuantity:      12,
			wantRemaining:     3,
			wantRequestedQty:  15,
			wantRequestedNotl: 1500,
		},
		{
			name:              "cap applies before first tier liquidity and queue",
			sessionID:         "formula-capped-first-tier",
			notional:          1500,
			maxFillPerTick:    1000,
			queuePriority:     0.5,
			wantQuantity:      4,
			wantRemaining:     11,
			wantRequestedQty:  15,
			wantRequestedNotl: 1500,
		},
		{
			name:              "larger remaining notional selects second tier",
			sessionID:         "formula-capped-second-tier",
			notional:          4000,
			maxFillPerTick:    1000,
			queuePriority:     0.5,
			wantQuantity:      2,
			wantRemaining:     38,
			wantRequestedQty:  40,
			wantRequestedNotl: 4000,
		},
		{
			name:              "notional above curve uses final tier",
			sessionID:         "formula-final-tier",
			notional:          8000,
			maxFillPerTick:    1000,
			queuePriority:     0.25,
			wantQuantity:      1,
			wantRemaining:     79,
			wantRequestedQty:  80,
			wantRequestedNotl: 8000,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			order := processProfiledBuySignal(t, tc.sessionID, papertrading.MarketExecutionProfile{
				MaxFillNotionalPerTick: tc.maxFillPerTick,
				LiquidityCurve:         liquidityCurve,
				QueuePriority:          tc.queuePriority,
				CancelAfterTicks:       1,
			}, tc.notional)

			if order.Status != "stopped" {
				t.Fatalf("expected order to stop after one partial-fill tick, got %q", order.Status)
			}
			if order.TerminalReason != "cancel_after_ticks" {
				t.Fatalf("expected cancel_after_ticks reason, got %q", order.TerminalReason)
			}
			if order.FillCount != 1 {
				t.Fatalf("expected exactly one fill slice, got %d", order.FillCount)
			}
			assertFloatAlmostEqual(t, order.Price, 100)
			assertFloatAlmostEqual(t, order.Quantity, tc.wantQuantity)
			assertFloatAlmostEqual(t, order.RemainingQuantity, tc.wantRemaining)
			assertFloatAlmostEqual(t, order.RequestedQuantity, tc.wantRequestedQty)
			assertFloatAlmostEqual(t, order.RequestedNotional, tc.wantRequestedNotl)
		})
	}
}

func TestSessionReportIncludesExecutionQualityMetrics(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 10000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.StartSessionWithProfile("execution-quality-session", papertrading.SessionExecutionProfile{
		InitialBalance: 10000,
		Rules:          papertrading.SimulationRules{},
		MarketProfile: papertrading.MarketExecutionProfile{
			MaxFillNotionalPerTick: 1000,
			LiquidityCurve: []papertrading.LiquidityCurvePoint{
				{MaxNotional: 2000, FillRatio: 0.5},
			},
			QueuePriority:    0.5,
			CancelAfterTicks: 1,
		},
	})
	if err != nil {
		t.Fatalf("failed to start profiled session: %v", err)
	}

	if _, err := engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "quality-bot",
		SignalID:   "quality-signal",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   4000,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 24, 0, 4, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("expected signal to be accepted, got error: %v", err)
	}

	report := engine.CurrentReport()
	assertFloatAlmostEqual(t, report.FillRatio, 0.0625)
	assertFloatAlmostEqual(t, report.AverageSlippageBps, 0)
	if report.StoppedOrders != 1 {
		t.Fatalf("expected one stopped order, got %d", report.StoppedOrders)
	}
	assertFloatAlmostEqual(t, report.CancelRate, 1)
}

func TestMarketImpactScalesWithOrderNotional(t *testing.T) {
	t.Parallel()

	smallOrder := processProfiledBuySignal(t, "small-impact", papertrading.MarketExecutionProfile{
		MarketImpactBpsPer10k: 10,
	}, 1000)
	largeOrder := processProfiledBuySignal(t, "large-impact", papertrading.MarketExecutionProfile{
		MarketImpactBpsPer10k: 10,
	}, 8000)

	if smallOrder.Status != "filled" || largeOrder.Status != "filled" {
		t.Fatalf("expected both orders to fill, got small=%q large=%q", smallOrder.Status, largeOrder.Status)
	}
	if smallOrder.Price <= 100 {
		t.Fatalf("expected small buy order to have positive impact, got %v", smallOrder.Price)
	}
	if largeOrder.Price <= smallOrder.Price {
		t.Fatalf("expected larger notional to have larger market impact, small=%v large=%v", smallOrder.Price, largeOrder.Price)
	}
}

func TestPendingExecutionSplitFillsAcrossMultipleMarketTicks(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 10000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.StartSessionWithProfile("split-fill-session", papertrading.SessionExecutionProfile{
		InitialBalance: 10000,
		Rules:          papertrading.SimulationRules{},
		MarketProfile: papertrading.MarketExecutionProfile{
			MaxFillNotionalPerTick: 1000,
		},
	})
	if err != nil {
		t.Fatalf("failed to start profiled session: %v", err)
	}

	execution, err := engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "split-bot",
		SignalID:   "split-signal",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   2500,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 24, 0, 3, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("expected signal to be accepted, got error: %v", err)
	}
	if execution.Order == nil || execution.Order.Status != "partially_filled" {
		t.Fatalf("expected first tick to create partial order, got %+v", execution.Order)
	}

	_, err = engine.ApplyMarketPrices([]marketdata.PriceTickV1{
		{
			Symbol:    "BTCUSDT",
			Price:     100,
			Source:    "mock",
			Timestamp: time.Date(2026, 4, 24, 0, 3, 1, 0, time.UTC),
		},
		{
			Symbol:    "BTCUSDT",
			Price:     100,
			Source:    "mock",
			Timestamp: time.Date(2026, 4, 24, 0, 3, 2, 0, time.UTC),
		},
	})
	if err != nil {
		t.Fatalf("expected pending fills to process, got error: %v", err)
	}

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 1 {
		t.Fatalf("expected one order, got %d", len(orders))
	}
	order := orders[0]
	if order.Status != "filled" {
		t.Fatalf("expected order to finish after three split fills, got %q", order.Status)
	}
	assertFloatAlmostEqual(t, order.Quantity, 25)
	assertFloatAlmostEqual(t, order.RemainingQuantity, 0)
	if order.FillCount != 3 {
		t.Fatalf("expected three split fills, got %d", order.FillCount)
	}
}

func TestResetSessionPreservesMarketExecutionProfile(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 10000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.StartSessionWithProfile("profile-reset-session", papertrading.SessionExecutionProfile{
		InitialBalance: 10000,
		Rules:          papertrading.SimulationRules{},
		MarketProfile: papertrading.MarketExecutionProfile{
			MaxFillNotionalPerTick: 1000,
			LiquidityCurve: []papertrading.LiquidityCurvePoint{
				{MaxNotional: 2000, FillRatio: 0.5},
			},
			QueuePriority:    0.5,
			CancelAfterTicks: 1,
		},
	})
	if err != nil {
		t.Fatalf("failed to start profiled session: %v", err)
	}
	if _, err := engine.ResetSession(); err != nil {
		t.Fatalf("failed to reset profiled session: %v", err)
	}

	_, err = engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: "impact-bot",
		SignalID:   "sig-after-reset",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   4000,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 24, 0, 1, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("expected signal to be accepted after reset, got error: %v", err)
	}

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 1 {
		t.Fatalf("expected one order, got %d", len(orders))
	}
	order := orders[0]
	if order.Status != "stopped" {
		t.Fatalf("expected reset session to keep cancel timeout profile, got status %q", order.Status)
	}
	if order.TerminalReason != "cancel_after_ticks" {
		t.Fatalf("expected cancel_after_ticks reason, got %q", order.TerminalReason)
	}
	assertFloatAlmostEqual(t, order.Quantity, 2.5)
	assertFloatAlmostEqual(t, order.RemainingQuantity, 37.5)
}

func TestStartSessionRejectsInvalidRealismProfile(t *testing.T) {
	t.Parallel()

	engine, err := papertrading.NewEngine("paper-account-1", 10000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.StartSessionWithProfile("invalid-realism-session", papertrading.SessionExecutionProfile{
		InitialBalance: 10000,
		Rules:          papertrading.SimulationRules{},
		MarketProfile: papertrading.MarketExecutionProfile{
			LiquidityCurve: []papertrading.LiquidityCurvePoint{
				{MaxNotional: 1000, FillRatio: 0.5},
				{MaxNotional: 500, FillRatio: 0.5},
			},
		},
	})
	if !errors.Is(err, papertrading.ErrInvalidMarketProfile) {
		t.Fatalf("expected invalid market profile error, got %v", err)
	}
}

func processProfiledBuySignal(t *testing.T, sessionID string, profile papertrading.MarketExecutionProfile, notional float64) papertrading.PaperOrder {
	t.Helper()

	engine, err := papertrading.NewEngine("paper-account-1", 20000)
	if err != nil {
		t.Fatalf("failed to create engine: %v", err)
	}

	_, err = engine.StartSessionWithProfile(sessionID, papertrading.SessionExecutionProfile{
		InitialBalance: 20000,
		Rules:          papertrading.SimulationRules{},
		MarketProfile:  profile,
	})
	if err != nil {
		t.Fatalf("failed to start profiled session: %v", err)
	}

	_, err = engine.ProcessSignal(papertrading.SignalV1{
		StrategyID: sessionID + "-bot",
		SignalID:   sessionID + "-signal",
		Symbol:     "BTCUSDT",
		Side:       papertrading.OrderSideBuy,
		Notional:   notional,
		PriceHint:  100,
		Timestamp:  time.Date(2026, 4, 24, 0, 2, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("expected signal to be accepted, got error: %v", err)
	}

	orders := engine.ListOrders(papertrading.OrderFilter{Limit: 10, Offset: 0})
	if len(orders) != 1 {
		t.Fatalf("expected one order, got %d", len(orders))
	}
	return orders[0]
}

func assertFloatAlmostEqual(t *testing.T, got float64, want float64) {
	t.Helper()

	if math.Abs(got-want) > 0.000001 {
		t.Fatalf("expected %.6f, got %.6f", want, got)
	}
}

type failingStore struct {
	saveErr error
}

func (s *failingStore) SaveState(_ papertrading.PersistentState) error {
	return s.saveErr
}

func (s *failingStore) LoadState(_ string) (papertrading.PersistentState, bool, error) {
	return papertrading.PersistentState{}, false, nil
}

func (s *failingStore) ListSessions(_ string, _ papertrading.SessionHistoryFilter) ([]papertrading.SessionHistoryEntry, error) {
	return nil, nil
}

func (s *failingStore) LoadSessionReport(_ string, _ string) (papertrading.SessionReport, bool, error) {
	return papertrading.SessionReport{}, false, nil
}

func (s *failingStore) LoadSessionOrders(_ string, _ string, _ papertrading.OrderFilter) ([]papertrading.PaperOrder, bool, error) {
	return nil, false, nil
}

func (s *failingStore) LoadSessionAudit(_ string, _ string, _ int, _ int) ([]papertrading.AuditEvent, bool, error) {
	return nil, false, nil
}

func (s *failingStore) LoadSessionTimeline(_ string, _ string) ([]papertrading.SessionTimelinePoint, bool, error) {
	return nil, false, nil
}
