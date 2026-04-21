package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"crypto_simulator/core_trading/internal/simulation"
)

type simulationService interface {
	ListBots() ([]simulation.BotSummary, error)
	GetBot(botID string) (simulation.BotDetail, error)
	ListRuns(filter simulation.RunFilter) ([]simulation.RunSummary, error)
	ListLeaderboard(filter simulation.LeaderboardFilter) ([]simulation.LeaderboardEntry, error)
	GetRun(runID string) (simulation.RunDetail, error)
	CreateRun(rctx context.Context, request simulation.CreateRunRequest) (simulation.RunDetail, error)
	StopRun(rctx context.Context, runID string) (simulation.RunDetail, error)
	UpdateRunStatus(rctx context.Context, runID string, update simulation.RunStatusUpdate) (simulation.RunDetail, error)
	HeartbeatRun(rctx context.Context, runID string, heartbeatAt time.Time) (simulation.RunDetail, error)
	ListExperiments(filter simulation.ExperimentFilter) ([]simulation.ExperimentSummary, error)
	GetExperiment(experimentID string) (simulation.ExperimentDetail, error)
	CreateExperiment(rctx context.Context, request simulation.CreateExperimentRequest) (simulation.ExperimentDetail, error)
	StopExperiment(rctx context.Context, experimentID string) (simulation.ExperimentDetail, error)
	GetExperimentSummary(experimentID string) ([]simulation.ExperimentSummaryRow, error)
}

type simBotsResponse struct {
	Bots []simulation.BotSummary `json:"bots"`
}

type simBotResponse struct {
	Bot simulation.BotDetail `json:"bot"`
}

type simRunsResponse struct {
	Runs []simulation.RunSummary `json:"runs"`
}

type simRunResponse struct {
	Run simulation.RunDetail `json:"run"`
}

type simLeaderboardResponse struct {
	Rows []simulation.LeaderboardEntry `json:"rows"`
}

type simExperimentsResponse struct {
	Experiments []simulation.ExperimentSummary `json:"experiments"`
}

type simExperimentResponse struct {
	Experiment simulation.ExperimentDetail `json:"experiment"`
}

type simExperimentSummaryResponse struct {
	Rows []simulation.ExperimentSummaryRow `json:"rows"`
}

func NewSimulationBotsHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		bots, err := service.ListBots()
		if err != nil {
			writeSimulationError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, simBotsResponse{Bots: bots})
	}
}

func NewSimulationBotDetailHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		bot, err := service.GetBot(r.PathValue("botID"))
		if err != nil {
			writeSimulationError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, simBotResponse{Bot: bot})
	}
}

func NewSimulationRunsHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			limit, offset, err := parsePagination(r, 20, 100)
			if err != nil {
				writePaperTradingError(w, err)
				return
			}

			filter := simulation.RunFilter{
				Query:        r.URL.Query().Get("q"),
				BotID:        r.URL.Query().Get("bot_id"),
				BotVersion:   r.URL.Query().Get("bot_version"),
				ScenarioID:   r.URL.Query().Get("scenario_id"),
				ExperimentID: r.URL.Query().Get("experiment_id"),
				Limit:        limit,
				Offset:       offset,
			}
			if status := r.URL.Query().Get("status"); status != "" {
				filter.Status = simulation.RunStatus(status)
				if !simulation.IsValidRunStatus(filter.Status) {
					writeAPIError(w, http.StatusBadRequest, "invalid_run_status", "invalid run status")
					return
				}
			}

			runs, err := service.ListRuns(filter)
			if err != nil {
				writeSimulationError(w, err)
				return
			}

			writeJSON(w, http.StatusOK, simRunsResponse{Runs: runs})
		case http.MethodPost:
			var request simulation.CreateRunRequest
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&request); err != nil {
				writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
				return
			}

			run, err := service.CreateRun(r.Context(), request)
			if err != nil {
				writeSimulationError(w, err)
				return
			}

			writeJSON(w, http.StatusCreated, simRunResponse{Run: run})
		default:
			writeMethodNotAllowed(w)
		}
	}
}

func NewSimulationExperimentsHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			limit, offset, err := parsePagination(r, 20, 100)
			if err != nil {
				writePaperTradingError(w, err)
				return
			}

			filter := simulation.ExperimentFilter{
				Query:  r.URL.Query().Get("q"),
				Limit:  limit,
				Offset: offset,
			}
			if status := r.URL.Query().Get("status"); status != "" {
				filter.Status = simulation.ExperimentStatus(status)
				if !simulation.IsValidExperimentStatus(filter.Status) {
					writeAPIError(w, http.StatusBadRequest, "invalid_experiment_status", "invalid experiment status")
					return
				}
			}

			experiments, err := service.ListExperiments(filter)
			if err != nil {
				writeSimulationError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, simExperimentsResponse{Experiments: experiments})
		case http.MethodPost:
			var request simulation.CreateExperimentRequest
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			if err := decoder.Decode(&request); err != nil {
				writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
				return
			}

			experiment, err := service.CreateExperiment(r.Context(), request)
			if err != nil {
				writeSimulationError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, simExperimentResponse{Experiment: experiment})
		default:
			writeMethodNotAllowed(w)
		}
	}
}

func NewSimulationExperimentDetailHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		experiment, err := service.GetExperiment(r.PathValue("experimentID"))
		if err != nil {
			writeSimulationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, simExperimentResponse{Experiment: experiment})
	}
}

func NewSimulationExperimentStopHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		experiment, err := service.StopExperiment(r.Context(), r.PathValue("experimentID"))
		if err != nil {
			writeSimulationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, simExperimentResponse{Experiment: experiment})
	}
}

func NewSimulationExperimentSummaryHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		rows, err := service.GetExperimentSummary(r.PathValue("experimentID"))
		if err != nil {
			writeSimulationError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, simExperimentSummaryResponse{Rows: rows})
	}
}

func NewSimulationLeaderboardHandler(service simulationService) http.HandlerFunc {
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

		rows, err := service.ListLeaderboard(simulation.LeaderboardFilter{
			BotID:      r.URL.Query().Get("bot_id"),
			BotVersion: r.URL.Query().Get("bot_version"),
			ScenarioID: r.URL.Query().Get("scenario_id"),
			Limit:      limit,
			Offset:     offset,
		})
		if err != nil {
			writeSimulationError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, simLeaderboardResponse{Rows: rows})
	}
}

func NewSimulationRunDetailHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		run, err := service.GetRun(r.PathValue("runID"))
		if err != nil {
			writeSimulationError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, simRunResponse{Run: run})
	}
}

func NewSimulationRunStopHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		run, err := service.StopRun(r.Context(), r.PathValue("runID"))
		if err != nil {
			writeSimulationError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, simRunResponse{Run: run})
	}
}

func NewSimulationRunStatusHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var update simulation.RunStatusUpdate
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&update); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
			return
		}

		run, err := service.UpdateRunStatus(r.Context(), r.PathValue("runID"), update)
		if err != nil {
			writeSimulationError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, simRunResponse{Run: run})
	}
}

func NewSimulationRunHeartbeatHandler(service simulationService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		var request simulation.RunHeartbeatRequest
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			writeAPIError(w, http.StatusBadRequest, "invalid_request_body", "invalid request body")
			return
		}

		heartbeatAt := time.Now().UTC()
		if request.HeartbeatAt != nil {
			heartbeatAt = request.HeartbeatAt.UTC()
		}

		run, err := service.HeartbeatRun(r.Context(), r.PathValue("runID"), heartbeatAt)
		if err != nil {
			writeSimulationError(w, err)
			return
		}

		writeJSON(w, http.StatusOK, simRunResponse{Run: run})
	}
}

func writeSimulationError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, simulation.ErrSimulationUnavailable):
		writeAPIError(w, http.StatusServiceUnavailable, "simulation_unavailable", err.Error())
	case errors.Is(err, simulation.ErrBotNotFound):
		writeAPIError(w, http.StatusNotFound, "bot_not_found", err.Error())
	case errors.Is(err, simulation.ErrBotVersionNotFound):
		writeAPIError(w, http.StatusNotFound, "bot_version_not_found", err.Error())
	case errors.Is(err, simulation.ErrRunNotFound):
		writeAPIError(w, http.StatusNotFound, "run_not_found", err.Error())
	case errors.Is(err, simulation.ErrExperimentNotFound):
		writeAPIError(w, http.StatusNotFound, "experiment_not_found", err.Error())
	case errors.Is(err, simulation.ErrRunAlreadyActive):
		writeAPIError(w, http.StatusConflict, "run_already_active", err.Error())
	case errors.Is(err, simulation.ErrSimulationBusy):
		writeAPIError(w, http.StatusConflict, "simulation_busy", err.Error())
	case errors.Is(err, simulation.ErrInvalidRunStatus):
		writeAPIError(w, http.StatusBadRequest, "invalid_run_status", err.Error())
	case errors.Is(err, simulation.ErrInvalidBotID):
		writeAPIError(w, http.StatusBadRequest, "invalid_bot_id", err.Error())
	case errors.Is(err, simulation.ErrInvalidScenarioID):
		writeAPIError(w, http.StatusBadRequest, "invalid_scenario_id", err.Error())
	case errors.Is(err, simulation.ErrInvalidExperimentID), errors.Is(err, simulation.ErrInvalidExperiment):
		writeAPIError(w, http.StatusBadRequest, "invalid_experiment", err.Error())
	case errors.Is(err, simulation.ErrRunnerUnavailable):
		writeAPIError(w, http.StatusServiceUnavailable, "runner_unavailable", err.Error())
	default:
		writePaperTradingError(w, err)
	}
}
