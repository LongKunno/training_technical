package simulation

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"crypto_simulator/core_trading/internal/papertrading"
)

const defaultHeartbeatTimeout = 30 * time.Second

type Service struct {
	accountID        string
	engine           PaperEngine
	store            Store
	runner           RunnerClient
	scenarios        ScenarioCatalogClient
	heartbeatTimeout time.Duration
	mu               sync.Mutex
}

func NewService(
	accountID string,
	engine PaperEngine,
	store Store,
	runner RunnerClient,
	scenarios ScenarioCatalogClient,
) *Service {
	return &Service{
		accountID:        strings.TrimSpace(accountID),
		engine:           engine,
		store:            store,
		runner:           runner,
		scenarios:        scenarios,
		heartbeatTimeout: defaultHeartbeatTimeout,
	}
}

func (s *Service) StartCoordinator(ctx context.Context, reconcileInterval time.Duration, heartbeatTimeout time.Duration) {
	if reconcileInterval <= 0 {
		reconcileInterval = 5 * time.Second
	}
	if heartbeatTimeout <= 0 {
		heartbeatTimeout = defaultHeartbeatTimeout
	}

	s.mu.Lock()
	s.heartbeatTimeout = heartbeatTimeout
	s.mu.Unlock()

	go func() {
		ticker := time.NewTicker(reconcileInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = s.Reconcile(context.Background())
			}
		}
	}()
}

func (s *Service) Reconcile(ctx context.Context) error {
	if s.store == nil {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	return s.reconcileLocked(ctx)
}

func (s *Service) Restore(ctx context.Context) error {
	if s.store == nil {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	activeRun, found, err := s.store.FindActiveRun(s.accountID)
	if err != nil {
		return err
	}
	if found && !activeRun.Status.IsTerminal() {
		if err := s.store.UpdateRunHeartbeat(s.accountID, activeRun.RunID, time.Now().UTC()); err != nil {
			return err
		}
	}

	experiment, found, err := s.store.FindActiveExperiment(s.accountID)
	if err != nil {
		return err
	}
	if found {
		if err := s.resumeExperimentLocked(ctx, experiment); err != nil {
			return err
		}
	}
	return s.reconcileLocked(ctx)
}

func (s *Service) ListBots() ([]BotSummary, error) {
	if s.store == nil {
		return nil, ErrSimulationUnavailable
	}

	return s.store.ListBots()
}

func (s *Service) GetBot(botID string) (BotDetail, error) {
	if s.store == nil {
		return BotDetail{}, ErrSimulationUnavailable
	}
	if strings.TrimSpace(botID) == "" {
		return BotDetail{}, ErrInvalidBotID
	}

	bot, found, err := s.store.GetBot(botID)
	if err != nil {
		return BotDetail{}, err
	}
	if !found {
		return BotDetail{}, ErrBotNotFound
	}

	return bot, nil
}

func (s *Service) ListRuns(filter RunFilter) ([]RunSummary, error) {
	if s.store == nil {
		return nil, ErrSimulationUnavailable
	}

	return s.store.ListRuns(s.accountID, NormalizeRunFilter(filter))
}

func (s *Service) ListLeaderboard(filter LeaderboardFilter) ([]LeaderboardEntry, error) {
	if s.store == nil {
		return nil, ErrSimulationUnavailable
	}

	return s.store.ListLeaderboard(s.accountID, NormalizeLeaderboardFilter(filter))
}

func (s *Service) GetRun(runID string) (RunDetail, error) {
	if s.store == nil {
		return RunDetail{}, ErrSimulationUnavailable
	}
	if strings.TrimSpace(runID) == "" {
		return RunDetail{}, ErrRunNotFound
	}

	run, found, err := s.store.GetRun(s.accountID, runID)
	if err != nil {
		return RunDetail{}, err
	}
	if !found {
		return RunDetail{}, ErrRunNotFound
	}

	return run, nil
}

func (s *Service) CreateRun(ctx context.Context, request CreateRunRequest) (RunDetail, error) {
	if s.store == nil || s.runner == nil || s.engine == nil {
		return RunDetail{}, ErrSimulationUnavailable
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.ensureExperimentIdleLocked(); err != nil {
		return RunDetail{}, err
	}

	resolved, err := s.resolveStandaloneRunLocked(ctx, request)
	if err != nil {
		return RunDetail{}, err
	}

	return s.createRunLocked(ctx, resolved)
}

func (s *Service) StopRun(ctx context.Context, runID string) (RunDetail, error) {
	if s.store == nil || s.engine == nil {
		return RunDetail{}, ErrSimulationUnavailable
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	run, err := s.getRunLocked(runID)
	if err != nil {
		return RunDetail{}, err
	}
	if run.Status.IsTerminal() {
		return run, nil
	}

	if s.runner != nil {
		if err := s.runner.StopRun(ctx, runID); err != nil && !errors.Is(err, ErrRunNotFound) {
			return RunDetail{}, err
		}
	}

	s.stopSessionIfMatch(run.SessionID)
	completedAt := time.Now().UTC()
	report, reportErr := s.engine.ReportBySession(run.SessionID)
	if reportErr != nil {
		return RunDetail{}, reportErr
	}
	metrics := metricsFromReport(report)
	if err := s.store.UpdateRunStatus(s.accountID, runID, RunStatusStopped, "", "operator_stop", &completedAt, &metrics); err != nil {
		return RunDetail{}, err
	}

	updatedRun, err := s.getRunLocked(runID)
	if err != nil {
		return RunDetail{}, err
	}
	if updatedRun.ExperimentID != "" {
		if err := s.advanceExperimentAfterRunLocked(ctx, updatedRun, updatedRun.Status); err != nil {
			return RunDetail{}, err
		}
		updatedRun, err = s.getRunLocked(runID)
		if err != nil {
			return RunDetail{}, err
		}
		if err := s.reconcileLocked(ctx); err != nil {
			return RunDetail{}, err
		}
		return updatedRun, nil
	}

	if err := s.reconcileLocked(ctx); err != nil {
		return RunDetail{}, err
	}

	return updatedRun, nil
}

func (s *Service) UpdateRunStatus(_ context.Context, runID string, update RunStatusUpdate) (RunDetail, error) {
	if s.store == nil {
		return RunDetail{}, ErrSimulationUnavailable
	}
	if !IsValidRunStatus(update.Status) {
		return RunDetail{}, ErrInvalidRunStatus
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	run, err := s.getRunLocked(runID)
	if err != nil {
		return RunDetail{}, err
	}
	if run.Status.IsTerminal() {
		return run, nil
	}

	var completedAt *time.Time
	var metrics *RunMetricsSummary
	stoppedReason := ""
	if update.Status.IsTerminal() {
		now := time.Now().UTC()
		completedAt = &now
		s.stopSessionIfMatch(run.SessionID)
		report, reportErr := s.engine.ReportBySession(run.SessionID)
		if reportErr != nil {
			return RunDetail{}, reportErr
		}
		snapshot := metricsFromReport(report)
		metrics = &snapshot
		stoppedReason = stoppedReasonForStatus(update.Status)
	}

	if err := s.store.UpdateRunStatus(
		s.accountID,
		runID,
		update.Status,
		strings.TrimSpace(update.ErrorMessage),
		stoppedReason,
		completedAt,
		metrics,
	); err != nil {
		return RunDetail{}, err
	}

	updatedRun, err := s.getRunLocked(runID)
	if err != nil {
		return RunDetail{}, err
	}
	if updatedRun.ExperimentID != "" && update.Status.IsTerminal() {
		if err := s.advanceExperimentAfterRunLocked(context.Background(), updatedRun, update.Status); err != nil {
			return RunDetail{}, err
		}
		updatedRun, err = s.getRunLocked(runID)
		if err != nil {
			return RunDetail{}, err
		}
	}
	if update.Status.IsTerminal() {
		if err := s.reconcileLocked(context.Background()); err != nil {
			return RunDetail{}, err
		}
	}

	return updatedRun, nil
}

func (s *Service) HeartbeatRun(_ context.Context, runID string, heartbeatAt time.Time) (RunDetail, error) {
	if s.store == nil {
		return RunDetail{}, ErrSimulationUnavailable
	}
	if heartbeatAt.IsZero() {
		heartbeatAt = time.Now().UTC()
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	run, err := s.getRunLocked(runID)
	if err != nil {
		return RunDetail{}, err
	}
	if run.Status.IsTerminal() {
		return run, nil
	}
	if err := s.store.UpdateRunHeartbeat(s.accountID, runID, heartbeatAt); err != nil {
		return RunDetail{}, err
	}
	return s.getRunLocked(runID)
}

func (s *Service) ListExperiments(filter ExperimentFilter) ([]ExperimentSummary, error) {
	if s.store == nil {
		return nil, ErrSimulationUnavailable
	}

	experiments, err := s.store.ListExperiments(s.accountID, NormalizeExperimentFilter(filter))
	if err != nil {
		return nil, err
	}
	if err := s.applyQueuePositionsToSummaries(experiments); err != nil {
		return nil, err
	}
	return experiments, nil
}

func (s *Service) GetExperiment(experimentID string) (ExperimentDetail, error) {
	if s.store == nil {
		return ExperimentDetail{}, ErrSimulationUnavailable
	}
	if strings.TrimSpace(experimentID) == "" {
		return ExperimentDetail{}, ErrInvalidExperimentID
	}

	experiment, found, err := s.store.GetExperiment(s.accountID, experimentID)
	if err != nil {
		return ExperimentDetail{}, err
	}
	if !found {
		return ExperimentDetail{}, ErrExperimentNotFound
	}

	runs, err := s.store.ListRuns(s.accountID, RunFilter{
		ExperimentID: experimentID,
		Limit:        max(1, len(experiment.Slots)),
		Offset:       0,
	})
	if err != nil {
		return ExperimentDetail{}, err
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].StartedAt.Before(runs[j].StartedAt)
	})
	experiment.Runs = runs
	if err := s.applyQueuePositionToDetail(&experiment); err != nil {
		return ExperimentDetail{}, err
	}
	return experiment, nil
}

func (s *Service) CreateExperiment(ctx context.Context, request CreateExperimentRequest) (ExperimentDetail, error) {
	if s.store == nil || s.runner == nil || s.engine == nil || s.scenarios == nil {
		return ExperimentDetail{}, ErrSimulationUnavailable
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	experiment, err := s.buildExperimentLocked(ctx, request)
	if err != nil {
		return ExperimentDetail{}, err
	}
	shouldQueue, err := s.shouldQueueExperimentLocked()
	if err != nil {
		return ExperimentDetail{}, err
	}
	if shouldQueue {
		experiment.Status = ExperimentStatusQueued
	}
	if err := s.store.CreateExperiment(s.accountID, experiment); err != nil {
		return ExperimentDetail{}, err
	}
	if !shouldQueue {
		if err := s.startNextExperimentRunLocked(ctx, experiment.ExperimentID); err != nil {
			return ExperimentDetail{}, err
		}
	} else if err := s.reconcileLocked(ctx); err != nil {
		return ExperimentDetail{}, err
	}

	return s.GetExperiment(experiment.ExperimentID)
}

func (s *Service) StopExperiment(ctx context.Context, experimentID string) (ExperimentDetail, error) {
	if s.store == nil {
		return ExperimentDetail{}, ErrSimulationUnavailable
	}

	s.mu.Lock()
	experiment, err := s.getExperimentLocked(experimentID)
	if err != nil {
		s.mu.Unlock()
		return ExperimentDetail{}, err
	}
	if experiment.Status.IsTerminal() {
		s.mu.Unlock()
		return s.GetExperiment(experimentID)
	}

	now := time.Now().UTC()
	experiment.StopRequested = true
	if experiment.Status == ExperimentStatusQueued {
		experiment.Status = ExperimentStatusStopped
		experiment.CompletedAt = &now
		experiment.UpdatedAt = now
		if err := s.store.UpdateExperiment(s.accountID, experiment); err != nil {
			s.mu.Unlock()
			return ExperimentDetail{}, err
		}
		if err := s.reconcileLocked(ctx); err != nil {
			s.mu.Unlock()
			return ExperimentDetail{}, err
		}
		s.mu.Unlock()
		return s.GetExperiment(experimentID)
	}
	if experiment.ActiveRunID == "" {
		experiment.Status = ExperimentStatusStopped
		experiment.CompletedAt = &now
	}
	experiment.UpdatedAt = now
	if err := s.store.UpdateExperiment(s.accountID, experiment); err != nil {
		s.mu.Unlock()
		return ExperimentDetail{}, err
	}
	activeRunID := experiment.ActiveRunID
	s.mu.Unlock()

	if activeRunID != "" {
		if _, err := s.StopRun(ctx, activeRunID); err != nil {
			return ExperimentDetail{}, err
		}
	}

	return s.GetExperiment(experimentID)
}

func (s *Service) GetExperimentSummary(experimentID string) ([]ExperimentSummaryRow, error) {
	experiment, err := s.GetExperiment(experimentID)
	if err != nil {
		return nil, err
	}

	type key struct {
		botID      string
		botVersion string
		scenarioID string
	}
	rowsByKey := make(map[key]*ExperimentSummaryRow)
	pnlStatsByKey := make(map[key]*experimentSummaryStats)

	for _, slot := range experiment.Slots {
		currentKey := key{botID: slot.BotID, botVersion: slot.BotVersion, scenarioID: slot.ScenarioID}
		row := rowsByKey[currentKey]
		if row == nil {
			row = &ExperimentSummaryRow{
				BotID:         slot.BotID,
				BotVersion:    slot.BotVersion,
				ScenarioID:    slot.ScenarioID,
				BestTotalPnL:  -1 << 62,
				WorstTotalPnL: 1 << 62,
			}
			rowsByKey[currentKey] = row
		}
		row.ScheduledRuns++
	}

	for _, run := range experiment.Runs {
		currentKey := key{botID: run.BotID, botVersion: run.BotVersion, scenarioID: run.ScenarioID}
		row := rowsByKey[currentKey]
		if row == nil {
			row = &ExperimentSummaryRow{
				BotID:         run.BotID,
				BotVersion:    run.BotVersion,
				ScenarioID:    run.ScenarioID,
				BestTotalPnL:  -1 << 62,
				WorstTotalPnL: 1 << 62,
			}
			rowsByKey[currentKey] = row
		}
		switch run.Status {
		case RunStatusCompleted:
			row.CompletedRuns++
		case RunStatusFailed:
			row.FailedRuns++
		case RunStatusStopped:
			row.StoppedRuns++
		}
	}

	detailRuns := make(map[string]RunDetail, len(experiment.Runs))
	for _, run := range experiment.Runs {
		runDetail, err := s.GetRun(run.RunID)
		if err != nil {
			return nil, err
		}
		detailRuns[run.RunID] = runDetail
	}

	for _, run := range experiment.Runs {
		if run.Status != RunStatusCompleted {
			continue
		}
		detail := detailRuns[run.RunID]
		if detail.MetricsSnapshot == nil {
			continue
		}

		currentKey := key{botID: run.BotID, botVersion: run.BotVersion, scenarioID: run.ScenarioID}
		row := rowsByKey[currentKey]
		row.AvgTotalPnL += detail.MetricsSnapshot.TotalPnL
		row.AvgMaxDrawdown += detail.MetricsSnapshot.MaxDrawdown
		row.AvgFillRatio += detail.MetricsSnapshot.FillRatio
		row.AvgSlippageBps += detail.MetricsSnapshot.AverageSlippageBps
		row.AvgCancelRate += detail.MetricsSnapshot.CancelRate
		stats := pnlStatsByKey[currentKey]
		if stats == nil {
			stats = &experimentSummaryStats{}
			pnlStatsByKey[currentKey] = stats
		}
		stats.Add(detail.MetricsSnapshot.TotalPnL)
		if detail.MetricsSnapshot.TotalPnL > row.BestTotalPnL {
			row.BestTotalPnL = detail.MetricsSnapshot.TotalPnL
		}
		if detail.MetricsSnapshot.TotalPnL < row.WorstTotalPnL {
			row.WorstTotalPnL = detail.MetricsSnapshot.TotalPnL
		}
	}

	rows := make([]ExperimentSummaryRow, 0, len(rowsByKey))
	for _, row := range rowsByKey {
		if row.CompletedRuns > 0 {
			row.AvgTotalPnL /= float64(row.CompletedRuns)
			row.AvgMaxDrawdown /= float64(row.CompletedRuns)
			row.AvgFillRatio /= float64(row.CompletedRuns)
			row.AvgSlippageBps /= float64(row.CompletedRuns)
			row.AvgCancelRate /= float64(row.CompletedRuns)
			if stats := pnlStatsByKey[key{botID: row.BotID, botVersion: row.BotVersion, scenarioID: row.ScenarioID}]; stats != nil {
				row.StdDevTotalPnL = stats.SampleStdDev()
				row.CI95TotalPnL = stats.CI95()
			}
		} else {
			row.BestTotalPnL = 0
			row.WorstTotalPnL = 0
		}
		terminalRuns := row.CompletedRuns + row.FailedRuns + row.StoppedRuns
		if terminalRuns > 0 {
			row.FailureRate = float64(row.FailedRuns) / float64(terminalRuns)
		}
		rows = append(rows, *row)
	}

	sort.Slice(rows, func(i, j int) bool {
		if rows[i].BotID != rows[j].BotID {
			return rows[i].BotID < rows[j].BotID
		}
		if rows[i].BotVersion != rows[j].BotVersion {
			return rows[i].BotVersion < rows[j].BotVersion
		}
		return rows[i].ScenarioID < rows[j].ScenarioID
	})

	return rows, nil
}

type experimentSummaryStats struct {
	count int
	mean  float64
	m2    float64
}

func (s *experimentSummaryStats) Add(value float64) {
	s.count++
	delta := value - s.mean
	s.mean += delta / float64(s.count)
	s.m2 += delta * (value - s.mean)
}

func (s experimentSummaryStats) SampleStdDev() float64 {
	if s.count < 2 {
		return 0
	}
	return math.Sqrt(s.m2 / float64(s.count-1))
}

func (s experimentSummaryStats) CI95() float64 {
	if s.count < 2 {
		return 0
	}
	return 1.96 * s.SampleStdDev() / math.Sqrt(float64(s.count))
}

func (s *Service) stopSessionIfMatch(sessionID string) {
	if s.engine == nil {
		return
	}

	currentSession := s.engine.SessionSummary()
	if currentSession.ID != sessionID || currentSession.Status != papertrading.SessionStatusRunning {
		return
	}

	_, _ = s.engine.StopSession()
}

type resolvedRunInput struct {
	ExperimentID     string
	BotID            string
	BotName          string
	BotVersion       string
	ScenarioID       string
	ConfigSnapshot   map[string]any
	ExecutionProfile ExecutionProfile
	MarketProfile    MarketMicrostructureProfile
}

func (s *Service) ensureExperimentIdleLocked() error {
	experiment, found, err := s.store.FindActiveExperiment(s.accountID)
	if err != nil {
		return err
	}
	if found && !experiment.Status.IsTerminal() {
		return ErrSimulationBusy
	}
	queued, err := s.store.ListQueuedExperiments(s.accountID)
	if err != nil {
		return err
	}
	if len(queued) > 0 {
		return ErrSimulationBusy
	}
	return nil
}

func (s *Service) shouldQueueExperimentLocked() (bool, error) {
	activeRun, found, err := s.store.FindActiveRun(s.accountID)
	if err != nil {
		return false, err
	}
	if found && !activeRun.Status.IsTerminal() {
		return true, nil
	}
	activeExperiment, found, err := s.store.FindActiveExperiment(s.accountID)
	if err != nil {
		return false, err
	}
	if found && !activeExperiment.Status.IsTerminal() {
		return true, nil
	}
	queued, err := s.store.ListQueuedExperiments(s.accountID)
	if err != nil {
		return false, err
	}
	return len(queued) > 0, nil
}

func (s *Service) applyQueuePositionsToSummaries(experiments []ExperimentSummary) error {
	queued, err := s.store.ListQueuedExperiments(s.accountID)
	if err != nil {
		return err
	}
	positions := make(map[string]int, len(queued))
	for index, experiment := range queued {
		positions[experiment.ExperimentID] = index + 1
	}
	for index := range experiments {
		experiments[index].QueuePosition = positions[experiments[index].ExperimentID]
	}
	return nil
}

func (s *Service) applyQueuePositionToDetail(experiment *ExperimentDetail) error {
	queued, err := s.store.ListQueuedExperiments(s.accountID)
	if err != nil {
		return err
	}
	for index, item := range queued {
		if item.ExperimentID == experiment.ExperimentID {
			experiment.QueuePosition = index + 1
			return nil
		}
	}
	experiment.QueuePosition = 0
	return nil
}

func (s *Service) reconcileLocked(ctx context.Context) error {
	activeRun, found, err := s.store.FindActiveRun(s.accountID)
	if err != nil {
		return err
	}
	if found && !activeRun.Status.IsTerminal() {
		if s.isHeartbeatStaleLocked(activeRun) {
			return s.failRunAsLostLocked(ctx, activeRun)
		}
		return nil
	}

	activeExperiment, found, err := s.store.FindActiveExperiment(s.accountID)
	if err != nil {
		return err
	}
	if found {
		return s.resumeExperimentLocked(ctx, activeExperiment)
	}

	return s.maybeStartQueuedExperimentLocked(ctx)
}

func (s *Service) maybeStartQueuedExperimentLocked(ctx context.Context) error {
	activeRun, found, err := s.store.FindActiveRun(s.accountID)
	if err != nil {
		return err
	}
	if found && !activeRun.Status.IsTerminal() {
		return nil
	}

	activeExperiment, found, err := s.store.FindActiveExperiment(s.accountID)
	if err != nil {
		return err
	}
	if found && !activeExperiment.Status.IsTerminal() {
		return nil
	}

	queued, err := s.store.ListQueuedExperiments(s.accountID)
	if err != nil {
		return err
	}
	if len(queued) == 0 {
		return nil
	}

	experiment, err := s.getExperimentLocked(queued[0].ExperimentID)
	if err != nil {
		return err
	}
	if experiment.Status != ExperimentStatusQueued {
		return nil
	}
	experiment.Status = ExperimentStatusStarting
	experiment.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateExperiment(s.accountID, experiment); err != nil {
		return err
	}
	return s.startNextExperimentRunLocked(ctx, experiment.ExperimentID)
}

func (s *Service) isHeartbeatStaleLocked(run RunDetail) bool {
	timeout := s.heartbeatTimeout
	if timeout <= 0 {
		timeout = defaultHeartbeatTimeout
	}
	lastSeen := run.UpdatedAt
	if run.LastHeartbeatAt != nil && !run.LastHeartbeatAt.IsZero() {
		lastSeen = *run.LastHeartbeatAt
	}
	return time.Since(lastSeen) > timeout
}

func (s *Service) failRunAsLostLocked(ctx context.Context, run RunDetail) error {
	failedAt := time.Now().UTC()
	s.stopSessionIfMatch(run.SessionID)
	report, reportErr := s.engine.ReportBySession(run.SessionID)
	var metrics *RunMetricsSummary
	if reportErr == nil {
		snapshot := metricsFromReport(report)
		metrics = &snapshot
	}
	if err := s.store.UpdateRunStatus(s.accountID, run.RunID, RunStatusFailed, "runner heartbeat stale", "runner_lost", &failedAt, metrics); err != nil {
		return err
	}
	updatedRun, err := s.getRunLocked(run.RunID)
	if err != nil {
		return err
	}
	if updatedRun.ExperimentID != "" {
		if err := s.advanceExperimentAfterRunLocked(ctx, updatedRun, updatedRun.Status); err != nil {
			return err
		}
	}
	return s.maybeStartQueuedExperimentLocked(ctx)
}

func (s *Service) resolveStandaloneRunLocked(ctx context.Context, request CreateRunRequest) (resolvedRunInput, error) {
	botID := strings.TrimSpace(request.BotID)
	if botID == "" {
		return resolvedRunInput{}, ErrInvalidBotID
	}

	activeRun, found, err := s.store.FindActiveRun(s.accountID)
	if err != nil {
		return resolvedRunInput{}, err
	}
	if found && !activeRun.Status.IsTerminal() {
		return resolvedRunInput{}, ErrRunAlreadyActive
	}

	bot, err := s.GetBot(botID)
	if err != nil {
		return resolvedRunInput{}, err
	}
	selectedVersion, versionDef, err := resolveBotVersion(bot, request.BotVersion)
	if err != nil {
		return resolvedRunInput{}, err
	}

	scenarioID := strings.TrimSpace(request.ScenarioID)
	if scenarioID == "" {
		scenarioID = bot.DefaultScenario
	}
	scenario, err := s.getScenarioLocked(ctx, scenarioID)
	if err != nil {
		return resolvedRunInput{}, err
	}

	return resolvedRunInput{
		BotID:            bot.BotID,
		BotName:          bot.Name,
		BotVersion:       selectedVersion,
		ScenarioID:       scenario.ScenarioID,
		ConfigSnapshot:   mergeConfig(versionDef.DefaultConfig, resolveBotConfig(request)),
		ExecutionProfile: resolveExecutionProfile(s.engine.DefaultRulesSummary(), request.ExecutionProfile),
		MarketProfile:    scenario.MicrostructureProfile,
	}, nil
}

func (s *Service) createRunLocked(ctx context.Context, resolved resolvedRunInput) (RunDetail, error) {
	now := time.Now().UTC()
	runID := fmt.Sprintf("sim-run-%d", now.UnixNano())
	sessionID := runID

	session, err := s.engine.StartSessionWithProfile(sessionID, toPaperExecutionProfile(resolved.ExecutionProfile, resolved.MarketProfile))
	if err != nil {
		return RunDetail{}, err
	}

	run := RunDetail{
		RunSummary: RunSummary{
			RunID:           runID,
			ExperimentID:    resolved.ExperimentID,
			BotID:           resolved.BotID,
			BotName:         resolved.BotName,
			BotVersion:      resolved.BotVersion,
			ScenarioID:      resolved.ScenarioID,
			SessionID:       session.ID,
			Status:          RunStatusStarting,
			LastHeartbeatAt: &now,
			StartedAt:       session.StartedAt,
			UpdatedAt:       now,
		},
		ConfigSnapshot:           resolved.ConfigSnapshot,
		ExecutionProfileSnapshot: resolved.ExecutionProfile,
		MarketProfileSnapshot:    resolved.MarketProfile,
	}

	if err := s.store.CreateRun(s.accountID, run); err != nil {
		s.stopSessionIfMatch(session.ID)
		return RunDetail{}, err
	}

	if err := s.runner.StartRun(ctx, RunnerStartRequest{
		RunID:      run.RunID,
		BotID:      run.BotID,
		BotVersion: run.BotVersion,
		ScenarioID: run.ScenarioID,
		SessionID:  run.SessionID,
		Config:     run.ConfigSnapshot,
		StartedAt:  run.StartedAt,
	}); err != nil {
		failedAt := time.Now().UTC()
		s.stopSessionIfMatch(session.ID)
		report, reportErr := s.engine.ReportBySession(session.ID)
		var metrics *RunMetricsSummary
		if reportErr == nil {
			snapshot := metricsFromReport(report)
			metrics = &snapshot
		}
		_ = s.store.UpdateRunStatus(s.accountID, run.RunID, RunStatusFailed, err.Error(), "runner_start_failed", &failedAt, metrics)
		return RunDetail{}, err
	}

	if err := s.store.UpdateRunStatus(s.accountID, run.RunID, RunStatusRunning, "", "", nil, nil); err != nil {
		return RunDetail{}, err
	}
	if err := s.store.UpdateRunHeartbeat(s.accountID, run.RunID, now); err != nil {
		return RunDetail{}, err
	}

	return s.getRunLocked(run.RunID)
}

func (s *Service) buildExperimentLocked(ctx context.Context, request CreateExperimentRequest) (ExperimentDetail, error) {
	name := strings.TrimSpace(request.Name)
	if name == "" || len(request.Bots) == 0 || len(request.Scenarios) == 0 || request.Repetitions <= 0 {
		return ExperimentDetail{}, ErrInvalidExperiment
	}

	executionProfile := resolveExecutionProfile(s.engine.DefaultRulesSummary(), request.ExecutionProfile)
	scenarioIDs := make([]string, 0, len(request.Scenarios))
	for _, scenarioID := range request.Scenarios {
		scenario, err := s.getScenarioLocked(ctx, scenarioID)
		if err != nil {
			return ExperimentDetail{}, err
		}
		scenarioIDs = append(scenarioIDs, scenario.ScenarioID)
	}

	slots := make([]ExperimentRunSlot, 0, len(request.Bots)*len(scenarioIDs)*request.Repetitions)
	slotIndex := 0
	for _, botRequest := range request.Bots {
		botID := strings.TrimSpace(botRequest.BotID)
		if botID == "" {
			return ExperimentDetail{}, ErrInvalidBotID
		}

		bot, err := s.GetBot(botID)
		if err != nil {
			return ExperimentDetail{}, err
		}
		selectedVersion, versionDef, err := resolveBotVersion(bot, botRequest.BotVersion)
		if err != nil {
			return ExperimentDetail{}, err
		}
		configSnapshot := mergeConfig(versionDef.DefaultConfig, resolveExperimentBotConfig(botRequest))

		for _, scenarioID := range scenarioIDs {
			for repetition := 1; repetition <= request.Repetitions; repetition++ {
				slots = append(slots, ExperimentRunSlot{
					SlotIndex:      slotIndex,
					Repetition:     repetition,
					BotID:          bot.BotID,
					BotName:        bot.Name,
					BotVersion:     selectedVersion,
					ScenarioID:     scenarioID,
					ConfigSnapshot: configSnapshot,
				})
				slotIndex++
			}
		}
	}

	now := time.Now().UTC()
	experimentID := fmt.Sprintf("sim-exp-%d", now.UnixNano())
	return ExperimentDetail{
		ExperimentSummary: ExperimentSummary{
			ExperimentID:  experimentID,
			Name:          name,
			Status:        ExperimentStatusStarting,
			PlannedRuns:   len(slots),
			CompletedRuns: 0,
			FailedRuns:    0,
			StoppedRuns:   0,
			CreatedAt:     now,
			UpdatedAt:     now,
		},
		ExecutionProfileSnapshot: executionProfile,
		Slots:                    slots,
		CurrentIndex:             0,
		StopRequested:            false,
	}, nil
}

func (s *Service) startNextExperimentRunLocked(ctx context.Context, experimentID string) error {
	experiment, err := s.getExperimentLocked(experimentID)
	if err != nil {
		return err
	}
	if experiment.Status.IsTerminal() || experiment.ActiveRunID != "" {
		return nil
	}
	if experiment.StopRequested {
		now := time.Now().UTC()
		experiment.Status = ExperimentStatusStopped
		experiment.CompletedAt = &now
		experiment.UpdatedAt = now
		return s.store.UpdateExperiment(s.accountID, experiment)
	}
	if experiment.CurrentIndex >= len(experiment.Slots) {
		now := time.Now().UTC()
		experiment.Status = ExperimentStatusCompleted
		experiment.CompletedAt = &now
		experiment.UpdatedAt = now
		return s.store.UpdateExperiment(s.accountID, experiment)
	}

	slot := experiment.Slots[experiment.CurrentIndex]
	scenario, err := s.getScenarioLocked(ctx, slot.ScenarioID)
	if err != nil {
		return s.failExperimentLocked(experiment, err)
	}

	run, err := s.createRunLocked(ctx, resolvedRunInput{
		ExperimentID:     experiment.ExperimentID,
		BotID:            slot.BotID,
		BotName:          slot.BotName,
		BotVersion:       slot.BotVersion,
		ScenarioID:       slot.ScenarioID,
		ConfigSnapshot:   slot.ConfigSnapshot,
		ExecutionProfile: experiment.ExecutionProfileSnapshot,
		MarketProfile:    scenario.MicrostructureProfile,
	})
	if err != nil {
		return s.failExperimentLocked(experiment, err)
	}

	if experiment.StartedAt == nil {
		startedAt := run.StartedAt
		experiment.StartedAt = &startedAt
	}
	experiment.Status = ExperimentStatusRunning
	experiment.ActiveRunID = run.RunID
	experiment.UpdatedAt = time.Now().UTC()
	return s.store.UpdateExperiment(s.accountID, experiment)
}

func (s *Service) advanceExperimentAfterRunLocked(ctx context.Context, run RunDetail, terminalStatus RunStatus) error {
	experiment, err := s.getExperimentLocked(run.ExperimentID)
	if err != nil {
		return err
	}
	if experiment.ActiveRunID == run.RunID {
		experiment.ActiveRunID = ""
	}
	experiment.CurrentIndex++
	switch terminalStatus {
	case RunStatusCompleted:
		experiment.CompletedRuns++
	case RunStatusFailed:
		experiment.FailedRuns++
	case RunStatusStopped:
		experiment.StoppedRuns++
	}
	experiment.UpdatedAt = time.Now().UTC()

	isDone := experiment.CurrentIndex >= len(experiment.Slots)
	if experiment.StopRequested {
		experiment.Status = ExperimentStatusStopped
		completedAt := time.Now().UTC()
		experiment.CompletedAt = &completedAt
	} else if isDone {
		experiment.Status = ExperimentStatusCompleted
		completedAt := time.Now().UTC()
		experiment.CompletedAt = &completedAt
	} else {
		experiment.Status = ExperimentStatusRunning
	}

	if err := s.store.UpdateExperiment(s.accountID, experiment); err != nil {
		return err
	}
	if !experiment.Status.IsTerminal() {
		return s.startNextExperimentRunLocked(ctx, experiment.ExperimentID)
	}
	return s.maybeStartQueuedExperimentLocked(ctx)
}

func (s *Service) resumeExperimentLocked(ctx context.Context, experiment ExperimentDetail) error {
	if experiment.Status.IsTerminal() {
		return nil
	}
	if experiment.ActiveRunID != "" {
		run, found, err := s.store.GetRun(s.accountID, experiment.ActiveRunID)
		if err != nil {
			return err
		}
		if found && !run.Status.IsTerminal() {
			return nil
		}
		if found {
			return s.advanceExperimentAfterRunLocked(ctx, run, run.Status)
		}
	}
	return s.startNextExperimentRunLocked(ctx, experiment.ExperimentID)
}

func (s *Service) failExperimentLocked(experiment ExperimentDetail, cause error) error {
	now := time.Now().UTC()
	experiment.Status = ExperimentStatusFailed
	experiment.ErrorMessage = strings.TrimSpace(cause.Error())
	experiment.ActiveRunID = ""
	experiment.CompletedAt = &now
	experiment.UpdatedAt = now
	if err := s.store.UpdateExperiment(s.accountID, experiment); err != nil {
		return err
	}
	return cause
}

func (s *Service) getRunLocked(runID string) (RunDetail, error) {
	run, found, err := s.store.GetRun(s.accountID, runID)
	if err != nil {
		return RunDetail{}, err
	}
	if !found {
		return RunDetail{}, ErrRunNotFound
	}
	return run, nil
}

func (s *Service) getExperimentLocked(experimentID string) (ExperimentDetail, error) {
	if strings.TrimSpace(experimentID) == "" {
		return ExperimentDetail{}, ErrInvalidExperimentID
	}
	experiment, found, err := s.store.GetExperiment(s.accountID, experimentID)
	if err != nil {
		return ExperimentDetail{}, err
	}
	if !found {
		return ExperimentDetail{}, ErrExperimentNotFound
	}
	return experiment, nil
}

func (s *Service) getScenarioLocked(ctx context.Context, scenarioID string) (ScenarioCatalogEntry, error) {
	scenarioID = strings.TrimSpace(scenarioID)
	if scenarioID == "" {
		return ScenarioCatalogEntry{}, ErrInvalidScenarioID
	}
	if s.scenarios == nil {
		return ScenarioCatalogEntry{}, ErrSimulationUnavailable
	}
	return s.scenarios.GetScenario(ctx, scenarioID)
}

func resolveBotVersion(bot BotDetail, requestedVersion string) (string, BotVersion, error) {
	version := strings.TrimSpace(requestedVersion)
	if version == "" {
		version = strings.TrimSpace(bot.CurrentVersion)
	}
	for _, candidate := range bot.Versions {
		if candidate.Version == version {
			return version, candidate, nil
		}
	}

	return "", BotVersion{}, ErrBotVersionNotFound
}

func mergeConfig(defaults map[string]any, overrides map[string]any) map[string]any {
	merged := make(map[string]any, len(defaults)+len(overrides))
	for key, value := range defaults {
		merged[key] = value
	}
	for key, value := range overrides {
		merged[key] = value
	}
	return merged
}

func resolveBotConfig(request CreateRunRequest) map[string]any {
	if len(request.BotConfig) > 0 {
		return request.BotConfig
	}
	return request.Config
}

func resolveExperimentBotConfig(request ExperimentBotRequest) map[string]any {
	if len(request.BotConfig) > 0 {
		return request.BotConfig
	}
	return request.Config
}

func resolveExecutionProfile(defaults papertrading.RulesSummary, input *ExecutionProfileInput) ExecutionProfile {
	profile := ExecutionProfile{
		InitialBalance: defaults.InitialBalance,
		FeeRate:        defaults.FeeRate,
		SlippageRate:   defaults.SlippageRate,
		RiskControls:   cloneRiskControls(defaults.RiskControls),
	}
	if input == nil {
		return profile
	}
	if input.InitialBalance != nil && *input.InitialBalance > 0 {
		profile.InitialBalance = *input.InitialBalance
	}
	if input.FeeRate != nil {
		profile.FeeRate = *input.FeeRate
	}
	if input.SlippageRate != nil {
		profile.SlippageRate = *input.SlippageRate
	}
	if input.RiskControls != nil {
		profile.RiskControls = cloneRiskControls(*input.RiskControls)
	}
	return profile
}

func toPaperExecutionProfile(input ExecutionProfile, marketProfile MarketMicrostructureProfile) papertrading.SessionExecutionProfile {
	return papertrading.SessionExecutionProfile{
		InitialBalance: input.InitialBalance,
		Rules: papertrading.SimulationRules{
			FeeRate:      input.FeeRate,
			SlippageRate: input.SlippageRate,
			RiskControls: cloneRiskControls(input.RiskControls),
		},
		MarketProfile: papertrading.MarketExecutionProfile{
			SignalLatencyTicks:     marketProfile.SignalLatencyTicks,
			SpreadBps:              marketProfile.SpreadBps,
			MaxFillNotionalPerTick: marketProfile.MaxFillNotionalPerTick,
			LiquidityCurve:         toPaperLiquidityCurve(marketProfile.LiquidityCurve),
			QueuePriority:          marketProfile.QueuePriority,
			MarketImpactBpsPer10k:  marketProfile.MarketImpactBpsPer10k,
			CancelAfterTicks:       marketProfile.CancelAfterTicks,
		},
	}
}

func toPaperLiquidityCurve(input []LiquidityCurvePoint) []papertrading.LiquidityCurvePoint {
	output := make([]papertrading.LiquidityCurvePoint, 0, len(input))
	for _, point := range input {
		output = append(output, papertrading.LiquidityCurvePoint{
			MaxNotional: point.MaxNotional,
			FillRatio:   point.FillRatio,
		})
	}
	return output
}

func metricsFromReport(report papertrading.SessionReport) RunMetricsSummary {
	return RunMetricsSummary{
		FilledOrders:       report.FilledOrders,
		RejectedSignals:    report.RejectedSignals,
		FeesPaid:           report.FeesPaid,
		SlippageCost:       report.SlippageCost,
		FillRatio:          report.FillRatio,
		AverageSlippageBps: report.AverageSlippageBps,
		StoppedOrders:      report.StoppedOrders,
		CancelRate:         report.CancelRate,
		RealizedPnL:        report.RealizedPnL,
		UnrealizedPnL:      report.UnrealizedPnL,
		TotalPnL:           report.TotalPnL,
		MaxDrawdown:        report.MaxDrawdown,
	}
}

func stoppedReasonForStatus(status RunStatus) string {
	switch status {
	case RunStatusStopped:
		return "runner_stop"
	case RunStatusFailed:
		return "runner_failure"
	default:
		return ""
	}
}

func cloneRiskControls(input papertrading.RiskControls) papertrading.RiskControls {
	return papertrading.RiskControls{
		AllowedSymbols:      cloneStrings(input.AllowedSymbols),
		MaxPositionQuantity: input.MaxPositionQuantity,
		MaxOrderNotional:    input.MaxOrderNotional,
		MaxDailyLoss:        input.MaxDailyLoss,
		CooldownSeconds:     input.CooldownSeconds,
		MaxOpenNotional:     input.MaxOpenNotional,
	}
}

func cloneStrings(input []string) []string {
	if len(input) == 0 {
		return nil
	}
	output := make([]string, len(input))
	copy(output, input)
	return output
}

func max(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
