package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"crypto_simulator/core_trading/internal/config"
	"crypto_simulator/core_trading/internal/marketdata"
	"crypto_simulator/core_trading/internal/papertrading"
	"crypto_simulator/core_trading/internal/server"
	"crypto_simulator/core_trading/internal/simulation"
	"crypto_simulator/core_trading/internal/storage/postgres"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const shutdownTimeout = 5 * time.Second

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var (
		db            *sql.DB
		postgresStore *postgres.StateStore
		stateStore    papertrading.StateStore
		simService    *simulation.Service
		err           error
	)

	if cfg.PaperStateStoreEnabled {
		db, err = sql.Open("pgx", cfg.DBURI)
		if err != nil {
			fmt.Println("Failed to open postgres connection:", err)
			return
		}
		defer func() {
			_ = db.Close()
		}()

		pingCtx, cancel := context.WithTimeout(ctx, shutdownTimeout)
		if err := db.PingContext(pingCtx); err != nil {
			cancel()
			fmt.Println("Failed to connect postgres:", err)
			return
		}
		cancel()

		postgresStore = postgres.NewStateStore(db)
		stateStore = postgresStore
	}

	engine, err := bootstrapEngine(cfg, stateStore)
	if err != nil {
		fmt.Println("Failed to initialize paper trading engine:", err)
		return
	}

	if postgresStore != nil {
		simService = simulation.NewService(
			cfg.PaperAccountID,
			engine,
			postgresStore,
			simulation.NewHTTPRunnerClient(cfg.BotRunnerBaseURL, nil),
			simulation.NewHTTPScenarioCatalogClient(cfg.DataPipelineBaseURL, nil),
		)
		if err := simService.Restore(ctx); err != nil {
			fmt.Println("Failed to restore simulation experiments:", err)
			return
		}
		simService.StartCoordinator(
			ctx,
			time.Duration(cfg.SimulationReconcileIntervalSeconds)*time.Second,
			time.Duration(cfg.SimulationHeartbeatTimeoutSeconds)*time.Second,
		)
	}

	if cfg.KafkaBootstrapServers != "" {
		consumer := marketdata.NewConsumer(
			parseCSV(cfg.KafkaBootstrapServers),
			cfg.KafkaTopic,
			cfg.KafkaConsumerGroupID,
			engine,
		)

		go func() {
			if err := consumer.Run(ctx); err != nil {
				fmt.Println("Kafka consumer stopped with error:", err)
				stop()
			}
		}()
	}

	router := server.NewRouter(engine, simService)
	httpServer := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()

	fmt.Printf("Core Trading Server is running on port %s\n", cfg.Port)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Println("Server failed:", err)
	}
}

func bootstrapEngine(cfg config.Config, store papertrading.StateStore) (*papertrading.Engine, error) {
	rules := papertrading.SimulationRules{
		FeeRate:      cfg.PaperFeeRate,
		SlippageRate: cfg.PaperSlippageRate,
		RiskControls: papertrading.RiskControls{
			AllowedSymbols:      cfg.PaperAllowedSymbols,
			MaxPositionQuantity: cfg.PaperMaxPositionQty,
			MaxOrderNotional:    cfg.PaperMaxOrderNotional,
			MaxDailyLoss:        cfg.PaperMaxDailyLoss,
			CooldownSeconds:     cfg.PaperCooldownSeconds,
			MaxOpenNotional:     cfg.PaperMaxOpenNotional,
		},
	}

	if store == nil {
		return papertrading.NewEngineWithRules(cfg.PaperAccountID, cfg.PaperInitialBalance, rules)
	}

	state, found, err := store.LoadState(cfg.PaperAccountID)
	if err != nil {
		return nil, err
	}
	if found {
		return papertrading.NewEngineFromPersistentState(state, papertrading.SessionExecutionProfile{
			InitialBalance: cfg.PaperInitialBalance,
			Rules:          rules,
		}, store)
	}

	return papertrading.NewEngineWithStore(cfg.PaperAccountID, cfg.PaperInitialBalance, rules, store)
}

func parseCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			values = append(values, trimmed)
		}
	}
	return values
}
