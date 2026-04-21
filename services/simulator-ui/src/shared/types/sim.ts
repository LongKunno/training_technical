import type { IsoDateTimeString, QueryParams } from "./api";
import type { MarketMicrostructureProfile } from "./market";
import type { RiskControls } from "./paper";

export type RunStatus = "starting" | "running" | "completed" | "stopped" | "failed";

export interface BotSummary {
  bot_id: string;
  name: string;
  description: string;
  runtime: string;
  current_version: string;
  default_scenario: string;
  updated_at: IsoDateTimeString;
}

export interface BotVersion {
  bot_id: string;
  version: string;
  title: string;
  description: string;
  entrypoint: string;
  config_schema: Record<string, unknown>;
  default_config: Record<string, unknown>;
  updated_at: IsoDateTimeString;
}

export interface BotDetail extends BotSummary {
  versions: BotVersion[];
}

export interface ExecutionProfile {
  initial_balance: number;
  fee_rate: number;
  slippage_rate: number;
  risk_controls: RiskControls;
}

export interface ExecutionProfileInput {
  initial_balance?: number;
  fee_rate?: number;
  slippage_rate?: number;
  risk_controls?: RiskControls;
}

export interface RunMetricsSummary {
  filled_orders: number;
  rejected_signals: number;
  fees_paid: number;
  slippage_cost: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  max_drawdown: number;
}

export interface RunSummary {
  run_id: string;
  experiment_id?: string;
  bot_id: string;
  bot_name: string;
  bot_version: string;
  scenario_id: string;
  session_id: string;
  status: RunStatus;
  error_message?: string;
  last_heartbeat_at?: IsoDateTimeString;
  started_at: IsoDateTimeString;
  completed_at?: IsoDateTimeString;
  updated_at: IsoDateTimeString;
}

export interface RunDetail extends RunSummary {
  config_snapshot: Record<string, unknown>;
  execution_profile_snapshot: ExecutionProfile;
  market_profile_snapshot: MarketMicrostructureProfile;
  metrics_snapshot?: RunMetricsSummary;
  stopped_reason?: string;
}

export interface RunFilter extends QueryParams {
  q?: string;
  status?: RunStatus | "";
  bot_id?: string;
  bot_version?: string;
  scenario_id?: string;
  experiment_id?: string;
  limit?: number;
  offset?: number;
}

export interface LeaderboardFilter extends QueryParams {
  bot_id?: string;
  bot_version?: string;
  scenario_id?: string;
  limit?: number;
  offset?: number;
}

export interface CreateRunRequest {
  bot_id: string;
  bot_version?: string;
  scenario_id?: string;
  bot_config?: Record<string, unknown>;
  config?: Record<string, unknown>;
  execution_profile?: ExecutionProfileInput;
}

export type ExperimentStatus = "queued" | "starting" | "running" | "completed" | "stopped" | "failed";

export interface ExperimentBotRequest {
  bot_id: string;
  bot_version?: string;
  bot_config?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface CreateExperimentRequest {
  name: string;
  bots: ExperimentBotRequest[];
  scenarios: string[];
  repetitions: number;
  execution_profile?: ExecutionProfileInput;
}

export interface ExperimentRunSlot {
  slot_index: number;
  repetition: number;
  bot_id: string;
  bot_name: string;
  bot_version: string;
  scenario_id: string;
  config_snapshot: Record<string, unknown>;
}

export interface ExperimentSummary {
  experiment_id: string;
  name: string;
  status: ExperimentStatus;
  planned_runs: number;
  completed_runs: number;
  failed_runs: number;
  stopped_runs: number;
  active_run_id?: string;
  queue_position?: number;
  error_message?: string;
  created_at: IsoDateTimeString;
  started_at?: IsoDateTimeString;
  completed_at?: IsoDateTimeString;
  updated_at: IsoDateTimeString;
}

export interface ExperimentDetail extends ExperimentSummary {
  execution_profile_snapshot: ExecutionProfile;
  slots: ExperimentRunSlot[];
  current_index: number;
  stop_requested: boolean;
  runs?: RunSummary[];
}

export interface ExperimentFilter extends QueryParams {
  q?: string;
  status?: ExperimentStatus | "";
  limit?: number;
  offset?: number;
}

export interface ExperimentSummaryRow {
  bot_id: string;
  bot_version: string;
  scenario_id: string;
  scheduled_runs: number;
  completed_runs: number;
  failed_runs: number;
  stopped_runs: number;
  avg_total_pnl: number;
  best_total_pnl: number;
  worst_total_pnl: number;
  avg_max_drawdown: number;
}

export interface LeaderboardEntry extends RunSummary {
  metrics_snapshot: RunMetricsSummary;
}

export interface BotsResponse {
  bots: BotSummary[];
}

export interface BotResponse {
  bot: BotDetail;
}

export interface RunsResponse {
  runs: RunSummary[];
}

export interface RunResponse {
  run: RunDetail;
}

export interface LeaderboardResponse {
  rows: LeaderboardEntry[];
}

export interface ExperimentsResponse {
  experiments: ExperimentSummary[];
}

export interface ExperimentResponse {
  experiment: ExperimentDetail;
}

export interface ExperimentSummaryResponse {
  rows: ExperimentSummaryRow[];
}
