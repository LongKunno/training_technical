import { ApiClientError } from "./http";

const validationErrorCodes = new Set([
  "invalid_bot_id",
  "invalid_experiment",
  "invalid_experiment_status",
  "invalid_limit",
  "invalid_market_profile",
  "invalid_notional",
  "invalid_offset",
  "invalid_order_side",
  "invalid_price",
  "invalid_quantity",
  "invalid_run_status",
  "invalid_scenario_id",
  "invalid_session_status",
  "invalid_signal_id",
  "invalid_strategy_id",
  "invalid_symbol",
  "invalid_timestamp",
]);

const riskErrorCodes = new Set([
  "cooldown_active",
  "insufficient_asset_quantity",
  "insufficient_funds",
  "max_daily_loss_exceeded",
  "max_open_notional_exceeded",
  "max_order_notional_exceeded",
  "max_position_quantity_exceeded",
  "symbol_blocked",
]);

const notFoundErrorCodes = new Set([
  "bot_not_found",
  "bot_version_not_found",
  "experiment_not_found",
  "not_found",
  "run_not_found",
  "session_not_found",
]);

function lowerCode(code: string) {
  return code.trim().toLowerCase();
}

export function formatOperatorErrorMessage(
  error: unknown,
  fallback = "Request failed.",
): string {
  if (!(error instanceof ApiClientError)) {
    return error instanceof Error ? error.message : fallback;
  }

  const code = lowerCode(error.code);

  if (error.status >= 500 || code === "internal_error" || code === "stream_unsupported") {
    return "The service hit an internal error. Retry once; if it repeats, check service logs with the request time and route.";
  }

  if (
    error.status === 503 ||
    code === "upstream_unavailable" ||
    code === "runner_unavailable" ||
    code === "simulation_unavailable"
  ) {
    return "An upstream service is unavailable. Refresh health checks, then retry after the service recovers.";
  }

  if (code === "simulation_busy") {
    return "The simulator scheduler is busy. Wait for the active run or experiment to finish, or stop it before retrying.";
  }

  if (code === "run_already_active") {
    return "A standalone run is already active. Stop it or wait for it to finish before starting another run.";
  }

  if (code === "session_stopped") {
    return "The paper session is stopped. Start or reset a session before sending new activity.";
  }

  if (code === "signal_already_processed") {
    return "This signal id was already processed. Generate a new signal id before retrying.";
  }

  if (notFoundErrorCodes.has(code) || error.status === 404) {
    return "The requested item was not found. Refresh the list and reopen the latest saved record.";
  }

  if (validationErrorCodes.has(code) || error.status === 400) {
    return "The request is invalid. Review the input values and try again.";
  }

  if (riskErrorCodes.has(code)) {
    return `Risk controls rejected this action: ${error.message}`;
  }

  if (error.status === 409) {
    return "The request conflicts with current simulator state. Refresh state, then retry the action.";
  }

  return error.message || fallback;
}
