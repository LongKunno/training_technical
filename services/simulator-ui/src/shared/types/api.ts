export type IsoDateTimeString = string;

export type QueryParamPrimitive = string | number | boolean | Date;
export type QueryParamValue =
  | QueryParamPrimitive
  | null
  | undefined
  | Array<QueryParamPrimitive | null | undefined>;

export type QueryParams = Record<string, QueryParamValue>;

export interface ApiRequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
  detail?: unknown;
}

export interface ServiceHealth {
  status: string;
  service: string;
  message: string;
}

export type UpstreamAvailability = "unknown" | "healthy" | "degraded" | "down";

export type TimelineStreamStatus = "idle" | "connecting" | "open" | "degraded";
