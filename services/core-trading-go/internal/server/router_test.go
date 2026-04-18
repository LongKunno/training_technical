package server_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"crypto_simulator/core_trading/internal/papertrading"
	"crypto_simulator/core_trading/internal/server"
)

func TestNewRouterHealthEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}
}

func TestNewRouterPaperAccountEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	req := httptest.NewRequest(http.MethodGet, "/api/paper/account", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Account struct {
			ID          string  `json:"id"`
			CashBalance float64 `json:"cash_balance"`
		} `json:"account"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Account.ID != "paper-account-1" {
		t.Fatalf("unexpected account id %q", payload.Account.ID)
	}

	if payload.Account.CashBalance != 1000 {
		t.Fatalf("expected balance 1000, got %v", payload.Account.CashBalance)
	}
}

func TestNewRouterPaperRulesEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	req := httptest.NewRequest(http.MethodGet, "/api/paper/rules", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Rules struct {
			PaperAccountID string  `json:"paper_account_id"`
			InitialBalance float64 `json:"initial_balance"`
			FeeRate        float64 `json:"fee_rate"`
			SlippageRate   float64 `json:"slippage_rate"`
		} `json:"rules"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode rules response: %v", err)
	}

	if payload.Rules.PaperAccountID != "paper-account-1" {
		t.Fatalf("unexpected account id %q", payload.Rules.PaperAccountID)
	}

	if payload.Rules.InitialBalance != 1000 {
		t.Fatalf("expected initial balance 1000, got %v", payload.Rules.InitialBalance)
	}

	if payload.Rules.FeeRate != 0 || payload.Rules.SlippageRate != 0 {
		t.Fatalf("expected zeroed default rules, got %+v", payload.Rules)
	}
}

func TestNewRouterPaperSessionLifecycleEndpoints(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)

	startRecorder := postAnyJSON(t, router, "/api/paper/session/start", `{"session_id":"session-e2e"}`)
	if startRecorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, startRecorder.Code)
	}

	resetRecorder := postAnyJSON(t, router, "/api/paper/session/reset", `{}`)
	if resetRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, resetRecorder.Code)
	}

	stopRecorder := postAnyJSON(t, router, "/api/paper/session/stop", `{}`)
	if stopRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, stopRecorder.Code)
	}

	var payload struct {
		Session struct {
			Status     string `json:"status"`
			ResetCount int    `json:"reset_count"`
		} `json:"session"`
	}
	if err := json.Unmarshal(stopRecorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode session response: %v", err)
	}

	if payload.Session.Status != string(papertrading.SessionStatusStopped) {
		t.Fatalf("expected stopped session, got %q", payload.Session.Status)
	}
	if payload.Session.ResetCount != 1 {
		t.Fatalf("expected reset count 1, got %d", payload.Session.ResetCount)
	}
}

func TestNewRouterPaperOrderEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	body := bytes.NewBufferString(`{"symbol":"BTCUSDT","side":"buy","quantity":2,"price":100}`)
	req := httptest.NewRequest(http.MethodPost, "/api/paper/orders", body)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}

	var payload struct {
		Order struct {
			Status string `json:"status"`
			Symbol string `json:"symbol"`
			Side   string `json:"side"`
		} `json:"order"`
		Account struct {
			CashBalance float64 `json:"cash_balance"`
			Positions   map[string]struct {
				Quantity float64 `json:"quantity"`
			} `json:"positions"`
		} `json:"account"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if payload.Order.Status != "filled" {
		t.Fatalf("expected filled order, got %q", payload.Order.Status)
	}

	if payload.Account.CashBalance != 800 {
		t.Fatalf("expected account balance 800, got %v", payload.Account.CashBalance)
	}

	if payload.Account.Positions["BTCUSDT"].Quantity != 2 {
		t.Fatalf("expected BTC position 2, got %v", payload.Account.Positions["BTCUSDT"].Quantity)
	}
}

func TestNewRouterPaperOrderEndpointRejectsInsufficientFunds(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 50)
	body := bytes.NewBufferString(`{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)
	req := httptest.NewRequest(http.MethodPost, "/api/paper/orders", body)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, recorder.Code)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode error response: %v", err)
	}

	if payload.Error.Code != "insufficient_funds" {
		t.Fatalf("unexpected error code %q", payload.Error.Code)
	}
}

func TestNewRouterPaperOrdersHistoryEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)

	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)
	postJSON(t, router, "/api/paper/orders", `{"symbol":"ETHUSDT","side":"buy","quantity":1,"price":50}`)

	req := httptest.NewRequest(http.MethodGet, "/api/paper/orders?symbol=BTCUSDT&limit=10&offset=0", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Orders []papertrading.PaperOrder `json:"orders"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode orders history: %v", err)
	}

	if len(payload.Orders) != 1 {
		t.Fatalf("expected 1 order in filtered history, got %d", len(payload.Orders))
	}

	if payload.Orders[0].Symbol != "BTCUSDT" {
		t.Fatalf("unexpected symbol %q", payload.Orders[0].Symbol)
	}
}

func TestNewRouterPaperPositionsEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":2,"price":100}`)

	req := httptest.NewRequest(http.MethodGet, "/api/paper/positions", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Positions []papertrading.PortfolioPositionSummary `json:"positions"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode positions response: %v", err)
	}

	if len(payload.Positions) != 1 {
		t.Fatalf("expected 1 position, got %d", len(payload.Positions))
	}
}

func TestNewRouterInternalMarketPriceIngestEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)

	body := bytes.NewBufferString(`{"ticks":[{"symbol":"BTCUSDT","price":150,"source":"mock-replay","timestamp":"2026-04-17T00:00:00Z"}]}`)
	req := httptest.NewRequest(http.MethodPost, "/internal/market/prices", body)
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Received int `json:"received"`
		Updated  int `json:"updated"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode ingest response: %v", err)
	}

	if payload.Received != 1 || payload.Updated != 1 {
		t.Fatalf("unexpected ingest counters %+v", payload)
	}

	portfolioReq := httptest.NewRequest(http.MethodGet, "/api/paper/portfolio", nil)
	portfolioRecorder := httptest.NewRecorder()
	router.ServeHTTP(portfolioRecorder, portfolioReq)

	var portfolioPayload struct {
		Portfolio struct {
			UnrealizedPnL float64                                 `json:"unrealized_pnl"`
			Positions     []papertrading.PortfolioPositionSummary `json:"positions"`
		} `json:"portfolio"`
	}
	if err := json.Unmarshal(portfolioRecorder.Body.Bytes(), &portfolioPayload); err != nil {
		t.Fatalf("failed to decode portfolio response: %v", err)
	}

	if portfolioPayload.Portfolio.UnrealizedPnL != 50 {
		t.Fatalf("expected unrealized pnl 50, got %v", portfolioPayload.Portfolio.UnrealizedPnL)
	}
}

func TestNewRouterInternalSignalEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	recorder := postAnyJSON(t, router, "/internal/signals", `{
		"strategy_id":"mean-reversion",
		"signal_id":"sig-1",
		"symbol":"BTCUSDT",
		"side":"buy",
		"notional":100,
		"price_hint":100,
		"timestamp":"2026-04-17T00:00:00Z"
	}`)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d, got %d", http.StatusCreated, recorder.Code)
	}

	var payload struct {
		Execution struct {
			Status        string  `json:"status"`
			DerivedAmount float64 `json:"derived_amount"`
		} `json:"execution"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode signal response: %v", err)
	}

	if payload.Execution.Status != "accepted" {
		t.Fatalf("expected accepted signal, got %q", payload.Execution.Status)
	}
	if payload.Execution.DerivedAmount != 1 {
		t.Fatalf("expected derived amount 1, got %v", payload.Execution.DerivedAmount)
	}
}

func TestNewRouterSignalEndpointRejectsStoppedSession(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postAnyJSON(t, router, "/api/paper/session/stop", `{}`)

	recorder := postAnyJSON(t, router, "/internal/signals", `{
		"strategy_id":"mean-reversion",
		"signal_id":"sig-2",
		"symbol":"BTCUSDT",
		"side":"buy",
		"quantity":1,
		"price_hint":100,
		"timestamp":"2026-04-17T00:00:00Z"
	}`)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, recorder.Code)
	}
}

func TestNewRouterPaperAuditAndReportEndpoints(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)
	postAnyJSON(t, router, "/internal/market/prices", `{"ticks":[{"symbol":"BTCUSDT","price":150,"source":"mock-replay","timestamp":"2026-04-17T00:00:00Z"}]}`)

	auditReq := httptest.NewRequest(http.MethodGet, "/api/paper/audit?limit=10&offset=0", nil)
	auditRecorder := httptest.NewRecorder()
	router.ServeHTTP(auditRecorder, auditReq)

	if auditRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, auditRecorder.Code)
	}

	reportReq := httptest.NewRequest(http.MethodGet, "/api/paper/report", nil)
	reportRecorder := httptest.NewRecorder()
	router.ServeHTTP(reportRecorder, reportReq)

	if reportRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, reportRecorder.Code)
	}

	var auditPayload struct {
		Events []papertrading.AuditEvent `json:"events"`
	}
	if err := json.Unmarshal(auditRecorder.Body.Bytes(), &auditPayload); err != nil {
		t.Fatalf("failed to decode audit payload: %v", err)
	}
	if len(auditPayload.Events) < 3 {
		t.Fatalf("expected at least 3 audit events, got %d", len(auditPayload.Events))
	}

	var reportPayload struct {
		Report struct {
			FilledOrders  int     `json:"filled_orders"`
			UnrealizedPnL float64 `json:"unrealized_pnl"`
		} `json:"report"`
	}
	if err := json.Unmarshal(reportRecorder.Body.Bytes(), &reportPayload); err != nil {
		t.Fatalf("failed to decode report payload: %v", err)
	}
	if reportPayload.Report.FilledOrders != 1 {
		t.Fatalf("expected 1 filled order, got %d", reportPayload.Report.FilledOrders)
	}
	if reportPayload.Report.UnrealizedPnL != 50 {
		t.Fatalf("expected unrealized pnl 50, got %v", reportPayload.Report.UnrealizedPnL)
	}
}

func TestNewRouterPaperSessionsEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postAnyJSON(t, router, "/api/paper/session/stop", `{}`)

	req := httptest.NewRequest(http.MethodGet, "/api/paper/sessions?limit=10&offset=0", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Sessions []papertrading.SessionHistoryEntry `json:"sessions"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode sessions payload: %v", err)
	}
	if len(payload.Sessions) != 1 {
		t.Fatalf("expected 1 session entry, got %d", len(payload.Sessions))
	}
	if payload.Sessions[0].Status != papertrading.SessionStatusStopped {
		t.Fatalf("expected stopped session, got %q", payload.Sessions[0].Status)
	}
}

func TestNewRouterPaperSessionsEndpointSupportsFiltersAndPagination(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postAnyJSON(t, router, "/api/paper/session/start", `{"session_id":"alpha-session"}`)
	postAnyJSON(t, router, "/api/paper/session/stop", `{}`)

	req := httptest.NewRequest(http.MethodGet, "/api/paper/sessions?q=alpha&status=stopped&limit=10&offset=0", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Sessions []papertrading.SessionHistoryEntry `json:"sessions"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode sessions payload: %v", err)
	}
	if len(payload.Sessions) != 1 || payload.Sessions[0].SessionID != "alpha-session" {
		t.Fatalf("unexpected filtered sessions payload %+v", payload.Sessions)
	}

	pagedReq := httptest.NewRequest(http.MethodGet, "/api/paper/sessions?limit=10&offset=1", nil)
	pagedRecorder := httptest.NewRecorder()
	router.ServeHTTP(pagedRecorder, pagedReq)

	var pagedPayload struct {
		Sessions []papertrading.SessionHistoryEntry `json:"sessions"`
	}
	if err := json.Unmarshal(pagedRecorder.Body.Bytes(), &pagedPayload); err != nil {
		t.Fatalf("failed to decode paged sessions payload: %v", err)
	}
	if len(pagedPayload.Sessions) != 0 {
		t.Fatalf("expected empty paged sessions payload, got %+v", pagedPayload.Sessions)
	}
}

func TestNewRouterPaperSessionsRejectsInvalidStatus(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	req := httptest.NewRequest(http.MethodGet, "/api/paper/sessions?status=paused", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Code)
	}
}

func TestNewRouterPaperAuditAndReportEndpointsSupportSessionID(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/paper/session", nil)
	sessionRecorder := httptest.NewRecorder()
	router.ServeHTTP(sessionRecorder, sessionReq)

	var sessionPayload struct {
		Session struct {
			ID string `json:"id"`
		} `json:"session"`
	}
	if err := json.Unmarshal(sessionRecorder.Body.Bytes(), &sessionPayload); err != nil {
		t.Fatalf("failed to decode session payload: %v", err)
	}

	reportReq := httptest.NewRequest(http.MethodGet, "/api/paper/report?session_id="+sessionPayload.Session.ID, nil)
	reportRecorder := httptest.NewRecorder()
	router.ServeHTTP(reportRecorder, reportReq)
	if reportRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, reportRecorder.Code)
	}

	auditReq := httptest.NewRequest(http.MethodGet, "/api/paper/audit?session_id="+sessionPayload.Session.ID+"&limit=10&offset=0", nil)
	auditRecorder := httptest.NewRecorder()
	router.ServeHTTP(auditRecorder, auditReq)
	if auditRecorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, auditRecorder.Code)
	}
}

func TestNewRouterPaperSessionScopedEndpointsReturnNotFound(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)

	for _, path := range []string{
		"/api/paper/report?session_id=missing",
		"/api/paper/audit?session_id=missing&limit=10&offset=0",
		"/api/paper/timeline?session_id=missing",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("expected status %d for %s, got %d", http.StatusNotFound, path, recorder.Code)
		}
	}
}

func TestNewRouterPaperTimelineEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)
	postAnyJSON(t, router, "/internal/market/prices", `{"ticks":[{"symbol":"BTCUSDT","price":150,"source":"mock-replay","timestamp":"2026-04-17T00:00:00Z"}]}`)

	req := httptest.NewRequest(http.MethodGet, "/api/paper/timeline", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, recorder.Code)
	}

	var payload struct {
		Timeline []papertrading.SessionTimelinePoint `json:"timeline"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode timeline payload: %v", err)
	}
	if len(payload.Timeline) < 3 {
		t.Fatalf("expected at least 3 timeline points, got %d", len(payload.Timeline))
	}
}

func TestNewRouterPaperTimelineStreamEndpoint(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	server := httptest.NewServer(router)
	defer server.Close()

	streamReq, err := http.NewRequest(http.MethodGet, server.URL+"/api/paper/timeline/stream", nil)
	if err != nil {
		t.Fatalf("failed to build request: %v", err)
	}

	resp, err := (&http.Client{}).Do(streamReq)
	if err != nil {
		t.Fatalf("failed to open stream: %v", err)
	}
	defer resp.Body.Close()

	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)

	buffer := make([]byte, 512)
	n, readErr := resp.Body.Read(buffer)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		t.Fatalf("failed to read stream: %v", readErr)
	}
	body := string(buffer[:n])
	if !strings.Contains(body, "event: timeline") {
		n, readErr = resp.Body.Read(buffer)
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			t.Fatalf("failed to read second stream chunk: %v", readErr)
		}
		body += string(buffer[:n])
	}
	if !strings.Contains(body, "event: timeline") {
		t.Fatalf("expected timeline event in stream, got %q", body)
	}
}

func TestNewRouterRiskControlsRejectBlockedSymbol(t *testing.T) {
	t.Parallel()

	router := newTestRouterWithRules(t, 1000, papertrading.SimulationRules{
		RiskControls: papertrading.RiskControls{
			AllowedSymbols: []string{"ETHUSDT"},
		},
	})
	recorder := postAnyJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected status %d, got %d", http.StatusConflict, recorder.Code)
	}
}

func TestNewRouterPaperTradingFullFlow(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"buy","quantity":1,"price":100}`)

	ingestReq := httptest.NewRequest(
		http.MethodPost,
		"/internal/market/prices",
		bytes.NewBufferString(`{"ticks":[{"symbol":"BTCUSDT","price":125,"source":"mock-replay","timestamp":"2026-04-17T00:00:00Z"}]}`),
	)
	ingestReq.Header.Set("Content-Type", "application/json")
	ingestRecorder := httptest.NewRecorder()
	router.ServeHTTP(ingestRecorder, ingestReq)
	if ingestRecorder.Code != http.StatusOK {
		t.Fatalf("expected ingest status %d, got %d", http.StatusOK, ingestRecorder.Code)
	}

	portfolioReq := httptest.NewRequest(http.MethodGet, "/api/paper/portfolio", nil)
	portfolioRecorder := httptest.NewRecorder()
	router.ServeHTTP(portfolioRecorder, portfolioReq)
	if portfolioRecorder.Code != http.StatusOK {
		t.Fatalf("expected portfolio status %d, got %d", http.StatusOK, portfolioRecorder.Code)
	}

	postJSON(t, router, "/api/paper/orders", `{"symbol":"BTCUSDT","side":"sell","quantity":1,"price":130}`)

	ordersReq := httptest.NewRequest(http.MethodGet, "/api/paper/orders?symbol=BTCUSDT&limit=10&offset=0", nil)
	ordersRecorder := httptest.NewRecorder()
	router.ServeHTTP(ordersRecorder, ordersReq)
	if ordersRecorder.Code != http.StatusOK {
		t.Fatalf("expected orders status %d, got %d", http.StatusOK, ordersRecorder.Code)
	}

	var payload struct {
		Orders []papertrading.PaperOrder `json:"orders"`
	}
	if err := json.Unmarshal(ordersRecorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to decode orders response: %v", err)
	}

	if len(payload.Orders) != 2 {
		t.Fatalf("expected 2 orders in full flow, got %d", len(payload.Orders))
	}

	if payload.Orders[0].Side != papertrading.OrderSideSell {
		t.Fatalf("expected newest order to be sell, got %q", payload.Orders[0].Side)
	}
}

func TestNewRouterRejectsInvalidOrderFilter(t *testing.T) {
	t.Parallel()

	router := newTestRouter(t, 1000)
	req := httptest.NewRequest(http.MethodGet, "/api/paper/orders?limit=abc", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected status %d, got %d", http.StatusBadRequest, recorder.Code)
	}
}

func newTestRouter(t *testing.T, initialBalance float64) http.Handler {
	t.Helper()

	return newTestRouterWithRules(t, initialBalance, papertrading.SimulationRules{})
}

func newTestRouterWithRules(t *testing.T, initialBalance float64, rules papertrading.SimulationRules) http.Handler {
	t.Helper()

	engine, err := papertrading.NewEngineWithStore("paper-account-1", initialBalance, rules, nil)
	if err != nil {
		t.Fatalf("failed to create paper trading engine: %v", err)
	}

	return server.NewRouter(engine)
}

func postJSON(t *testing.T, router http.Handler, path string, body string) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	if recorder.Code != http.StatusCreated {
		t.Fatalf("expected status %d for %s, got %d", http.StatusCreated, path, recorder.Code)
	}
}

func postAnyJSON(t *testing.T, router http.Handler, path string, body string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	return recorder
}
