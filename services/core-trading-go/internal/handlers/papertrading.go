package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"crypto_simulator/core_trading/internal/marketdata"
	"crypto_simulator/core_trading/internal/papertrading"
)

type paperTradingEngine interface {
	Snapshot() papertrading.VirtualAccount
	PortfolioSummary() papertrading.PortfolioSummary
	PositionsSummary() []papertrading.PortfolioPositionSummary
	RulesSummary() papertrading.RulesSummary
	SessionSummary() papertrading.SimulationSession
	SessionHistory(filter papertrading.SessionHistoryFilter) ([]papertrading.SessionHistoryEntry, error)
	StartSession(sessionID string) (papertrading.SimulationSession, error)
	ResetSession() (papertrading.SimulationSession, error)
	StopSession() (papertrading.SimulationSession, error)
	AuditTrail(limit int, offset int) []papertrading.AuditEvent
	AuditTrailBySession(sessionID string, limit int, offset int) ([]papertrading.AuditEvent, error)
	CurrentReport() papertrading.SessionReport
	ReportBySession(sessionID string) (papertrading.SessionReport, error)
	TimelineBySession(sessionID string) ([]papertrading.SessionTimelinePoint, error)
	SubscribeTimeline() (papertrading.TimelineSubscription, func())
	ListOrders(filter papertrading.OrderFilter) []papertrading.PaperOrder
	ListOrdersBySession(sessionID string, filter papertrading.OrderFilter) ([]papertrading.PaperOrder, error)
	PlaceMarketOrder(request papertrading.PlaceOrderRequest) (papertrading.PaperOrder, error)
	ProcessSignal(signal papertrading.SignalV1) (papertrading.SignalExecution, error)
	ApplyMarketPrices(ticks []marketdata.PriceTickV1) (int, error)
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error apiError `json:"error"`
}

type paperAccountResponse struct {
	Account papertrading.VirtualAccount `json:"account"`
}

type paperPortfolioResponse struct {
	Portfolio papertrading.PortfolioSummary `json:"portfolio"`
}

type paperOrdersResponse struct {
	Orders []papertrading.PaperOrder `json:"orders"`
}

type paperPositionsResponse struct {
	Positions []papertrading.PortfolioPositionSummary `json:"positions"`
}

type paperRulesResponse struct {
	Rules papertrading.RulesSummary `json:"rules"`
}

type paperSessionResponse struct {
	Session papertrading.SimulationSession `json:"session"`
}

type paperSessionsResponse struct {
	Sessions []papertrading.SessionHistoryEntry `json:"sessions"`
}

type paperAuditResponse struct {
	Events []papertrading.AuditEvent `json:"events"`
}

type paperReportResponse struct {
	Report papertrading.SessionReport `json:"report"`
}

type paperTimelineResponse struct {
	Timeline []papertrading.SessionTimelinePoint `json:"timeline"`
}

type priceIngestResponse struct {
	Received int `json:"received"`
	Updated  int `json:"updated"`
}

type signalExecutionResponse struct {
	Execution papertrading.SignalExecution `json:"execution"`
}

type placePaperOrderResponse struct {
	Order   papertrading.PaperOrder     `json:"order"`
	Account papertrading.VirtualAccount `json:"account"`
}

type placePaperOrderRequest struct {
	Symbol   string                 `json:"symbol"`
	Side     papertrading.OrderSide `json:"side"`
	Quantity float64                `json:"quantity"`
	Price    float64                `json:"price"`
}

type startSessionRequest struct {
	SessionID string `json:"session_id"`
}

func NewPaperAccountHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		writeJSON(w, http.StatusOK, paperAccountResponse{
			Account: engine.Snapshot(),
		})
	}
}

func NewPaperPortfolioHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		writeJSON(w, http.StatusOK, paperPortfolioResponse{
			Portfolio: engine.PortfolioSummary(),
		})
	}
}

func NewPaperPositionsHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		writeJSON(w, http.StatusOK, paperPositionsResponse{
			Positions: engine.PositionsSummary(),
		})
	}
}

func NewPaperRulesHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		writeJSON(w, http.StatusOK, paperRulesResponse{
			Rules: engine.RulesSummary(),
		})
	}
}

func NewPaperSessionHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		writeJSON(w, http.StatusOK, paperSessionResponse{
			Session: engine.SessionSummary(),
		})
	}
}

func NewPaperSessionsHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		limit, offset, err := parsePagination(r, 20, 100)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		filter := papertrading.SessionHistoryFilter{
			Query:  r.URL.Query().Get("q"),
			Limit:  limit,
			Offset: offset,
		}
		if status := r.URL.Query().Get("status"); status != "" {
			filter.Status = papertrading.SessionStatus(status)
			if filter.Status != papertrading.SessionStatusRunning && filter.Status != papertrading.SessionStatusStopped {
				writeAPIError(w, http.StatusBadRequest, "invalid_session_status", "invalid session status")
				return
			}
		}

		sessions, err := engine.SessionHistory(filter)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, paperSessionsResponse{Sessions: sessions})
	}
}

func NewPaperSessionStartHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var request startSessionRequest
		if r.ContentLength > 0 {
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&request); err != nil {
				writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
				return
			}
		}

		session, err := engine.StartSession(request.SessionID)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, paperSessionResponse{
			Session: session,
		})
	}
}

func NewPaperSessionResetHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		session, err := engine.ResetSession()
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, paperSessionResponse{
			Session: session,
		})
	}
}

func NewPaperSessionStopHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		session, err := engine.StopSession()
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, paperSessionResponse{
			Session: session,
		})
	}
}

func NewPaperAuditHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		limit, offset, err := parsePagination(r, 100, 500)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		sessionID := r.URL.Query().Get("session_id")
		if sessionID == "" {
			writeJSON(w, http.StatusOK, paperAuditResponse{
				Events: engine.AuditTrail(limit, offset),
			})
			return
		}

		events, err := engine.AuditTrailBySession(sessionID, limit, offset)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, paperAuditResponse{Events: events})
	}
}

func NewPaperReportHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		sessionID := r.URL.Query().Get("session_id")
		if sessionID == "" {
			writeJSON(w, http.StatusOK, paperReportResponse{
				Report: engine.CurrentReport(),
			})
			return
		}

		report, err := engine.ReportBySession(sessionID)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, paperReportResponse{Report: report})
	}
}

func NewPaperTimelineHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		points, err := engine.TimelineBySession(r.URL.Query().Get("session_id"))
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, paperTimelineResponse{Timeline: points})
	}
}

func NewPaperTimelineStreamHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			writeAPIError(w, http.StatusInternalServerError, "stream_unsupported", "stream unsupported")
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		subscription, unsubscribe := engine.SubscribeTimeline()
		defer unsubscribe()

		if _, err := fmt.Fprint(w, ": connected\n\n"); err != nil {
			return
		}
		flusher.Flush()

		for {
			select {
			case <-r.Context().Done():
				return
			case point, ok := <-subscription:
				if !ok {
					return
				}
				payload, err := json.Marshal(point)
				if err != nil {
					continue
				}
				if _, err := fmt.Fprintf(w, "event: timeline\ndata: %s\n\n", payload); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	}
}

func NewPaperOrderHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			filter, err := parseOrderFilter(r)
			if err != nil {
				writePaperTradingError(w, err)
				return
			}
			if filter.SessionID != "" {
				orders, err := engine.ListOrdersBySession(filter.SessionID, filter)
				if err != nil {
					writePaperTradingError(w, err)
					return
				}
				writeJSON(w, http.StatusOK, paperOrdersResponse{Orders: orders})
				return
			}

			writeJSON(w, http.StatusOK, paperOrdersResponse{
				Orders: engine.ListOrders(filter),
			})
		case http.MethodPost:
			var request placePaperOrderRequest
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&request); err != nil {
				writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
				return
			}

			order, err := engine.PlaceMarketOrder(papertrading.PlaceOrderRequest{
				Symbol:   request.Symbol,
				Side:     request.Side,
				Quantity: request.Quantity,
				Price:    request.Price,
			})
			if err != nil {
				writePaperTradingError(w, err)
				return
			}

			writeJSON(w, http.StatusCreated, placePaperOrderResponse{
				Order:   order,
				Account: engine.Snapshot(),
			})
		default:
			writeMethodNotAllowed(w)
		}
	}
}

func NewInternalSignalHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var signal papertrading.SignalV1
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&signal); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
			return
		}

		execution, err := engine.ProcessSignal(signal)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, signalExecutionResponse{
			Execution: execution,
		})
	}
}

func NewMarketPriceIngestHandler(engine paperTradingEngine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var payload marketdata.PriceTickBatch
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
			return
		}

		updated, err := engine.ApplyMarketPrices(payload.Ticks)
		if err != nil {
			writePaperTradingError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, priceIngestResponse{
			Received: len(payload.Ticks),
			Updated:  updated,
		})
	}
}

func parseOrderFilter(r *http.Request) (papertrading.OrderFilter, error) {
	limit, offset, err := parsePagination(r, 50, 200)
	if err != nil {
		return papertrading.OrderFilter{}, err
	}

	query := r.URL.Query()
	filter := papertrading.OrderFilter{
		SessionID: query.Get("session_id"),
		Symbol:    query.Get("symbol"),
		Limit:     limit,
		Offset:    offset,
	}

	if side := query.Get("side"); side != "" {
		filter.Side = papertrading.OrderSide(side)
		if filter.Side != papertrading.OrderSideBuy && filter.Side != papertrading.OrderSideSell {
			return papertrading.OrderFilter{}, papertrading.ErrInvalidOrderSide
		}
	}

	return filter, nil
}

func parsePagination(r *http.Request, defaultLimit int, maxLimit int) (int, int, error) {
	query := r.URL.Query()
	limit := defaultLimit
	offset := 0

	if rawLimit := query.Get("limit"); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err != nil || parsedLimit <= 0 {
			return 0, 0, papertrading.ErrInvalidLimit
		}
		if parsedLimit > maxLimit {
			parsedLimit = maxLimit
		}
		limit = parsedLimit
	}

	if rawOffset := query.Get("offset"); rawOffset != "" {
		parsedOffset, err := strconv.Atoi(rawOffset)
		if err != nil || parsedOffset < 0 {
			return 0, 0, papertrading.ErrInvalidOffset
		}
		offset = parsedOffset
	}

	return limit, offset, nil
}

func writePaperTradingError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, papertrading.ErrInvalidStrategyID):
		writeAPIError(w, http.StatusBadRequest, "invalid_strategy_id", err.Error())
	case errors.Is(err, papertrading.ErrInvalidSignalID):
		writeAPIError(w, http.StatusBadRequest, "invalid_signal_id", err.Error())
	case errors.Is(err, papertrading.ErrInvalidNotional):
		writeAPIError(w, http.StatusBadRequest, "invalid_notional", err.Error())
	case errors.Is(err, papertrading.ErrInvalidOrderSide):
		writeAPIError(w, http.StatusBadRequest, "invalid_order_side", err.Error())
	case errors.Is(err, papertrading.ErrInvalidQuantity):
		writeAPIError(w, http.StatusBadRequest, "invalid_quantity", err.Error())
	case errors.Is(err, papertrading.ErrInvalidPrice):
		writeAPIError(w, http.StatusBadRequest, "invalid_price", err.Error())
	case errors.Is(err, papertrading.ErrSessionNotFound):
		writeAPIError(w, http.StatusNotFound, "session_not_found", err.Error())
	case errors.Is(err, papertrading.ErrInvalidSymbol):
		writeAPIError(w, http.StatusBadRequest, "invalid_symbol", err.Error())
	case errors.Is(err, papertrading.ErrInvalidTimestamp):
		writeAPIError(w, http.StatusBadRequest, "invalid_timestamp", err.Error())
	case errors.Is(err, papertrading.ErrInvalidMarketProfile):
		writeAPIError(w, http.StatusBadRequest, "invalid_market_profile", err.Error())
	case errors.Is(err, papertrading.ErrInvalidLimit):
		writeAPIError(w, http.StatusBadRequest, "invalid_limit", err.Error())
	case errors.Is(err, papertrading.ErrInvalidOffset):
		writeAPIError(w, http.StatusBadRequest, "invalid_offset", err.Error())
	case errors.Is(err, papertrading.ErrSessionStopped):
		writeAPIError(w, http.StatusConflict, "session_stopped", err.Error())
	case errors.Is(err, papertrading.ErrSignalAlreadyProcessed):
		writeAPIError(w, http.StatusConflict, "signal_already_processed", err.Error())
	case errors.Is(err, papertrading.ErrSymbolBlocked):
		writeAPIError(w, http.StatusConflict, "symbol_blocked", err.Error())
	case errors.Is(err, papertrading.ErrMaxPositionExceeded):
		writeAPIError(w, http.StatusConflict, "max_position_quantity_exceeded", err.Error())
	case errors.Is(err, papertrading.ErrMaxOrderNotionalExceeded):
		writeAPIError(w, http.StatusConflict, "max_order_notional_exceeded", err.Error())
	case errors.Is(err, papertrading.ErrMaxDailyLossExceeded):
		writeAPIError(w, http.StatusConflict, "max_daily_loss_exceeded", err.Error())
	case errors.Is(err, papertrading.ErrCooldownActive):
		writeAPIError(w, http.StatusConflict, "cooldown_active", err.Error())
	case errors.Is(err, papertrading.ErrMaxOpenNotionalExceeded):
		writeAPIError(w, http.StatusConflict, "max_open_notional_exceeded", err.Error())
	case errors.Is(err, papertrading.ErrInsufficientFunds):
		writeAPIError(w, http.StatusConflict, "insufficient_funds", err.Error())
	case errors.Is(err, papertrading.ErrInsufficientAsset):
		writeAPIError(w, http.StatusConflict, "insufficient_asset_quantity", err.Error())
	default:
		writeAPIError(w, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, `{"error":{"code":"internal_error","message":"failed to encode response"}}`, http.StatusInternalServerError)
	}
}

func writeAPIError(w http.ResponseWriter, statusCode int, code string, message string) {
	writeJSON(w, statusCode, errorResponse{
		Error: apiError{
			Code:    code,
			Message: message,
		},
	})
}

func writeMethodNotAllowed(w http.ResponseWriter) {
	writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
}
