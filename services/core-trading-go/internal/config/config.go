package config

import (
	"os"
	"strconv"
	"strings"
)

const (
	defaultPort                   = "8080"
	defaultPaperAccountID         = "paper-account-1"
	defaultPaperInitialBalance    = 10000.0
	defaultDBURI                  = "postgres://root:rootpassword@postgres:5432/crypto_sim?sslmode=disable"
	defaultKafkaTopic             = "price-ticks-v1"
	defaultKafkaConsumerGroupID   = "core-trading-paper-engine"
	defaultPaperStateStoreEnabled = false
)

type Config struct {
	Port                   string
	DBURI                  string
	PaperStateStoreEnabled bool
	PaperAccountID         string
	PaperInitialBalance    float64
	PaperFeeRate           float64
	PaperSlippageRate      float64
	PaperAllowedSymbols    []string
	PaperMaxPositionQty    float64
	PaperMaxOrderNotional  float64
	PaperMaxDailyLoss      float64
	PaperCooldownSeconds   int
	PaperMaxOpenNotional   float64
	KafkaBootstrapServers  string
	KafkaTopic             string
	KafkaConsumerGroupID   string
}

func Load() Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}

	dbURI := os.Getenv("DB_URI")
	if dbURI == "" {
		dbURI = defaultDBURI
	}

	paperStateStoreEnabled := defaultPaperStateStoreEnabled
	if rawEnabled := os.Getenv("PAPER_STATE_STORE_ENABLED"); rawEnabled != "" {
		if parsedEnabled, err := strconv.ParseBool(rawEnabled); err == nil {
			paperStateStoreEnabled = parsedEnabled
		}
	}

	paperAccountID := os.Getenv("PAPER_ACCOUNT_ID")
	if paperAccountID == "" {
		paperAccountID = defaultPaperAccountID
	}

	paperInitialBalance := defaultPaperInitialBalance
	if rawBalance := os.Getenv("PAPER_INITIAL_BALANCE"); rawBalance != "" {
		if parsedBalance, err := strconv.ParseFloat(rawBalance, 64); err == nil {
			paperInitialBalance = parsedBalance
		}
	}

	paperFeeRate := 0.0
	if rawFeeRate := os.Getenv("PAPER_FEE_RATE"); rawFeeRate != "" {
		if parsedFeeRate, err := strconv.ParseFloat(rawFeeRate, 64); err == nil {
			paperFeeRate = parsedFeeRate
		}
	}

	paperSlippageRate := 0.0
	if rawSlippageRate := os.Getenv("PAPER_SLIPPAGE_RATE"); rawSlippageRate != "" {
		if parsedSlippageRate, err := strconv.ParseFloat(rawSlippageRate, 64); err == nil {
			paperSlippageRate = parsedSlippageRate
		}
	}

	paperAllowedSymbols := parseCSVEnv(os.Getenv("PAPER_ALLOWED_SYMBOLS"))

	paperMaxPositionQty := 0.0
	if rawMaxPositionQty := os.Getenv("PAPER_MAX_POSITION_QUANTITY"); rawMaxPositionQty != "" {
		if parsedMaxPositionQty, err := strconv.ParseFloat(rawMaxPositionQty, 64); err == nil {
			paperMaxPositionQty = parsedMaxPositionQty
		}
	}

	paperMaxOrderNotional := 0.0
	if rawMaxOrderNotional := os.Getenv("PAPER_MAX_ORDER_NOTIONAL"); rawMaxOrderNotional != "" {
		if parsedMaxOrderNotional, err := strconv.ParseFloat(rawMaxOrderNotional, 64); err == nil {
			paperMaxOrderNotional = parsedMaxOrderNotional
		}
	}

	paperMaxDailyLoss := 0.0
	if rawMaxDailyLoss := os.Getenv("PAPER_MAX_DAILY_LOSS"); rawMaxDailyLoss != "" {
		if parsedMaxDailyLoss, err := strconv.ParseFloat(rawMaxDailyLoss, 64); err == nil {
			paperMaxDailyLoss = parsedMaxDailyLoss
		}
	}

	paperCooldownSeconds := 0
	if rawCooldownSeconds := os.Getenv("PAPER_COOLDOWN_SECONDS"); rawCooldownSeconds != "" {
		if parsedCooldownSeconds, err := strconv.Atoi(rawCooldownSeconds); err == nil {
			paperCooldownSeconds = parsedCooldownSeconds
		}
	}

	paperMaxOpenNotional := 0.0
	if rawMaxOpenNotional := os.Getenv("PAPER_MAX_OPEN_NOTIONAL"); rawMaxOpenNotional != "" {
		if parsedMaxOpenNotional, err := strconv.ParseFloat(rawMaxOpenNotional, 64); err == nil {
			paperMaxOpenNotional = parsedMaxOpenNotional
		}
	}

	kafkaBootstrapServers := os.Getenv("CORE_TRADING_KAFKA_BOOTSTRAP_SERVERS")

	kafkaTopic := os.Getenv("CORE_TRADING_KAFKA_TOPIC")
	if kafkaTopic == "" {
		kafkaTopic = defaultKafkaTopic
	}

	kafkaConsumerGroupID := os.Getenv("CORE_TRADING_KAFKA_GROUP_ID")
	if kafkaConsumerGroupID == "" {
		kafkaConsumerGroupID = defaultKafkaConsumerGroupID
	}

	return Config{
		Port:                   port,
		DBURI:                  dbURI,
		PaperStateStoreEnabled: paperStateStoreEnabled,
		PaperAccountID:         paperAccountID,
		PaperInitialBalance:    paperInitialBalance,
		PaperFeeRate:           paperFeeRate,
		PaperSlippageRate:      paperSlippageRate,
		PaperAllowedSymbols:    paperAllowedSymbols,
		PaperMaxPositionQty:    paperMaxPositionQty,
		PaperMaxOrderNotional:  paperMaxOrderNotional,
		PaperMaxDailyLoss:      paperMaxDailyLoss,
		PaperCooldownSeconds:   paperCooldownSeconds,
		PaperMaxOpenNotional:   paperMaxOpenNotional,
		KafkaBootstrapServers:  kafkaBootstrapServers,
		KafkaTopic:             kafkaTopic,
		KafkaConsumerGroupID:   kafkaConsumerGroupID,
	}
}

func parseCSVEnv(raw string) []string {
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
