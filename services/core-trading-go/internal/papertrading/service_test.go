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
		},
		PeakEquity:       1015,
		ProcessedSignals: []string{"sig-1"},
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
