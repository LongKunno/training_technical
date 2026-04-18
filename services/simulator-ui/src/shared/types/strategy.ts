import type { IsoDateTimeString, QueryParams } from "./api";
import type { OrderSide } from "./paper";

export interface StrategySignal {
  strategy_id: string;
  signal_id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  notional: number;
  price_hint: number;
  timestamp: IsoDateTimeString;
  scenario?: string;
}

export interface StrategySignalsQuery extends QueryParams {
  scenario?: string;
  strategy_id?: string | null;
  limit?: number;
  offset?: number;
}

export interface PublishSignalsRequest {
  scenario?: string;
  strategy_id?: string | null;
  limit?: number;
  offset?: number;
}

export interface ReplaySignalsRequest {
  scenario?: string;
  strategy_id?: string | null;
  speed_multiplier: number;
}

export interface StrategySignalsResponse {
  signals: StrategySignal[];
}

export interface StrategyScenariosResponse {
  scenarios: string[];
}

export interface PublishSignalsResponse {
  scenario: string;
  published_count: number;
  signal_ids: string[];
  strategy_ids: string[];
  transports: string[];
}

export interface ReplaySignalsResponse {
  scenario: string;
  published_count: number;
  signal_ids: string[];
  strategy_id?: string | null;
  speed_multiplier: number;
}
