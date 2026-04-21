package simulation

import "errors"

var (
	ErrSimulationUnavailable = errors.New("simulation service unavailable")
	ErrBotNotFound           = errors.New("bot not found")
	ErrBotVersionNotFound    = errors.New("bot version not found")
	ErrRunNotFound           = errors.New("run not found")
	ErrRunAlreadyActive      = errors.New("run already active")
	ErrInvalidRunStatus      = errors.New("invalid run status")
	ErrInvalidBotID          = errors.New("invalid bot id")
	ErrInvalidScenarioID     = errors.New("invalid scenario id")
	ErrExperimentNotFound    = errors.New("experiment not found")
	ErrInvalidExperimentID   = errors.New("invalid experiment id")
	ErrInvalidExperiment     = errors.New("invalid experiment request")
	ErrSimulationBusy        = errors.New("simulation scheduler busy")
	ErrRunnerUnavailable     = errors.New("runner unavailable")
)
