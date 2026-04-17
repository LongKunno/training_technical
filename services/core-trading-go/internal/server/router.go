package server

import (
	"net/http"

	"crypto_simulator/core_trading/internal/handlers"
	"crypto_simulator/core_trading/internal/papertrading"
)

const (
	defaultServiceName = "Core Trading (Golang)"
	defaultMessage     = "Sieu toc do phan tich gia!"
)

func NewRouter(engine *papertrading.Engine) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", handlers.NewHealthHandler(defaultServiceName, defaultMessage))
	mux.HandleFunc("/api/paper/account", handlers.NewPaperAccountHandler(engine))
	mux.HandleFunc("/api/paper/portfolio", handlers.NewPaperPortfolioHandler(engine))
	mux.HandleFunc("/api/paper/positions", handlers.NewPaperPositionsHandler(engine))
	mux.HandleFunc("/api/paper/rules", handlers.NewPaperRulesHandler(engine))
	mux.HandleFunc("/api/paper/session", handlers.NewPaperSessionHandler(engine))
	mux.HandleFunc("/api/paper/session/start", handlers.NewPaperSessionStartHandler(engine))
	mux.HandleFunc("/api/paper/session/reset", handlers.NewPaperSessionResetHandler(engine))
	mux.HandleFunc("/api/paper/session/stop", handlers.NewPaperSessionStopHandler(engine))
	mux.HandleFunc("/api/paper/audit", handlers.NewPaperAuditHandler(engine))
	mux.HandleFunc("/api/paper/report", handlers.NewPaperReportHandler(engine))
	mux.HandleFunc("/api/paper/orders", handlers.NewPaperOrderHandler(engine))
	mux.HandleFunc("/internal/signals", handlers.NewInternalSignalHandler(engine))
	mux.HandleFunc("/internal/market/prices", handlers.NewMarketPriceIngestHandler(engine))

	return mux
}
