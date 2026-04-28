package config_test

import (
	"testing"

	"crypto_simulator/core_trading/internal/config"
)

func TestLoadParsesSimulationCoordinatorIntervals(t *testing.T) {
	t.Setenv("SIM_HEARTBEAT_TIMEOUT_SECONDS", "45")
	t.Setenv("SIM_RECONCILE_INTERVAL_SECONDS", "7")

	cfg := config.Load()

	if cfg.SimulationHeartbeatTimeoutSeconds != 45 {
		t.Fatalf("expected heartbeat timeout 45, got %d", cfg.SimulationHeartbeatTimeoutSeconds)
	}
	if cfg.SimulationReconcileIntervalSeconds != 7 {
		t.Fatalf("expected reconcile interval 7, got %d", cfg.SimulationReconcileIntervalSeconds)
	}
}

func TestLoadKeepsDefaultSimulationCoordinatorIntervalsForInvalidEnv(t *testing.T) {
	t.Setenv("SIM_HEARTBEAT_TIMEOUT_SECONDS", "0")
	t.Setenv("SIM_RECONCILE_INTERVAL_SECONDS", "invalid")

	cfg := config.Load()

	if cfg.SimulationHeartbeatTimeoutSeconds != 30 {
		t.Fatalf("expected default heartbeat timeout 30, got %d", cfg.SimulationHeartbeatTimeoutSeconds)
	}
	if cfg.SimulationReconcileIntervalSeconds != 5 {
		t.Fatalf("expected default reconcile interval 5, got %d", cfg.SimulationReconcileIntervalSeconds)
	}
}
