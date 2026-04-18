import type { IsoDateTimeString, QueryParams } from "./api";

export type OrderSide = "buy" | "sell";
export type SessionStatus = "running" | "stopped";

export interface VirtualAccountPosition {
  symbol: string;
  quantity: number;
  average_price: number;
}

export interface VirtualAccount {
  id: string;
  cash_balance: number;
  positions: Record<string, VirtualAccountPosition>;
}

export interface PaperOrder {
  id: string;
  account_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  requested_price: number;
  notional: number;
  fee: number;
  fee_rate: number;
  slippage_rate: number;
  status: string;
  executed_at: IsoDateTimeString;
}

export interface PlacePaperOrderRequest {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
}

export interface PortfolioPositionSummary {
  symbol: string;
  quantity: number;
  average_price: number;
  market_price: number;
  market_value: number;
  unrealized_pnl: number;
}

export interface PortfolioSummary {
  account_id: string;
  cash_balance: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_equity: number;
  positions: PortfolioPositionSummary[];
}

export interface RiskControls {
  allowed_symbols: string[];
  max_position_quantity: number;
  max_order_notional: number;
  max_daily_loss: number;
  cooldown_seconds: number;
  max_open_notional: number;
}

export interface RulesSummary {
  paper_account_id: string;
  initial_balance: number;
  fee_rate: number;
  slippage_rate: number;
  risk_controls: RiskControls;
}

export interface SimulationSession {
  id: string;
  status: SessionStatus;
  started_at: IsoDateTimeString;
  stopped_at?: IsoDateTimeString;
  reset_count: number;
  last_event_at: IsoDateTimeString;
}

export interface SessionHistoryEntry {
  session_id: string;
  status: SessionStatus;
  started_at: IsoDateTimeString;
  stopped_at?: IsoDateTimeString;
  last_event_at: IsoDateTimeString;
  reset_count: number;
  filled_orders: number;
  rejected_signals: number;
  realized_pnl: number;
  total_pnl: number;
  max_drawdown: number;
}

export interface SessionTimelinePoint {
  timestamp: IsoDateTimeString;
  equity: number;
  cash_balance: number;
  unrealized_pnl: number;
  drawdown: number;
  event_type: string;
}

export interface AuditEvent {
  id: string;
  session_id: string;
  type: string;
  message: string;
  symbol?: string;
  timestamp: IsoDateTimeString;
  details?: Record<string, unknown>;
}

export interface SymbolReport {
  symbol: string;
  filled_orders: number;
  fees_paid: number;
}

export interface SessionReport {
  session_id: string;
  status: SessionStatus;
  started_at: IsoDateTimeString;
  stopped_at?: IsoDateTimeString;
  reset_count: number;
  filled_orders: number;
  rejected_signals: number;
  fees_paid: number;
  slippage_cost: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  max_drawdown: number;
  symbols: SymbolReport[];
  timeline?: SessionTimelinePoint[];
}

export interface SignalExecution {
  signal_id: string;
  strategy_id: string;
  status: string;
  order?: PaperOrder;
  derived_price?: number;
  derived_amount?: number;
}

export interface SessionHistoryFilter extends QueryParams {
  q?: string;
  status?: SessionStatus | "";
  limit?: number;
  offset?: number;
}

export interface PaperOrderFilter extends QueryParams {
  symbol?: string;
  side?: OrderSide | "";
  limit?: number;
  offset?: number;
}

export interface PaperAuditQuery extends QueryParams {
  session_id?: string | null;
  limit?: number;
  offset?: number;
}

export interface PaperReportQuery extends QueryParams {
  session_id?: string | null;
}

export interface PaperTimelineQuery extends QueryParams {
  session_id?: string | null;
}

export interface StartSessionRequest {
  session_id?: string;
}

export interface ManualSignalRequest {
  strategy_id: string;
  signal_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  notional: number;
  price_hint: number;
  timestamp: IsoDateTimeString;
}

export interface CurrentSessionSnapshotQuery {
  orders_limit?: number;
  orders_offset?: number;
}

export interface SelectedSessionDetailQuery {
  audit_limit?: number;
  audit_offset?: number;
}

export interface CurrentSessionSnapshot {
  session: SimulationSession;
  portfolio: PortfolioSummary;
  positions: PortfolioPositionSummary[];
  report: SessionReport;
  rules: RulesSummary;
  orders: PaperOrder[];
  timeline: SessionTimelinePoint[];
}

export interface SelectedSessionDetail {
  session_id: string;
  report: SessionReport;
  events: AuditEvent[];
  timeline: SessionTimelinePoint[];
}

export interface PaperAccountResponse {
  account: VirtualAccount;
}

export interface PaperPortfolioResponse {
  portfolio: PortfolioSummary;
}

export interface PaperPositionsResponse {
  positions: PortfolioPositionSummary[];
}

export interface PaperRulesResponse {
  rules: RulesSummary;
}

export interface PaperSessionResponse {
  session: SimulationSession;
}

export interface PaperSessionsResponse {
  sessions: SessionHistoryEntry[];
}

export interface PaperOrdersResponse {
  orders: PaperOrder[];
}

export interface PaperAuditResponse {
  events: AuditEvent[];
}

export interface PaperReportResponse {
  report: SessionReport;
}

export interface PaperTimelineResponse {
  timeline: SessionTimelinePoint[];
}

export interface PlacePaperOrderResponse {
  order: PaperOrder;
  account: VirtualAccount;
}

export interface SignalExecutionResponse {
  execution: SignalExecution;
}
