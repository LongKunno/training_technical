import type { RulesSummary } from "../../shared/types";

export type ExecutionProfilePresetId = "conservative" | "default" | "aggressive";

export interface ExecutionProfilePreset {
  id: ExecutionProfilePresetId;
  label: string;
}

export interface ExecutionProfilePresetValues {
  initial_balance: string;
  fee_rate: string;
  slippage_rate: string;
  allowed_symbols: string;
  max_position_quantity: string;
  max_order_notional: string;
  max_daily_loss: string;
  cooldown_seconds: string;
  max_open_notional: string;
}

const EXECUTION_PROFILE_FIELDS: Array<keyof ExecutionProfilePresetValues> = [
  "initial_balance",
  "fee_rate",
  "slippage_rate",
  "allowed_symbols",
  "max_position_quantity",
  "max_order_notional",
  "max_daily_loss",
  "cooldown_seconds",
  "max_open_notional",
];

const NUMERIC_EXECUTION_PROFILE_FIELDS = new Set<keyof ExecutionProfilePresetValues>([
  "initial_balance",
  "fee_rate",
  "slippage_rate",
  "max_position_quantity",
  "max_order_notional",
  "max_daily_loss",
  "cooldown_seconds",
  "max_open_notional",
]);

export const EXECUTION_PROFILE_PRESETS: ExecutionProfilePreset[] = [
  { id: "conservative", label: "Conservative" },
  { id: "default", label: "Default" },
  { id: "aggressive", label: "Aggressive" },
];

function formatInputNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function scaled(value: number, multiplier: number): number {
  return Math.max(0, value * multiplier);
}

export function buildExecutionProfilePreset(
  rules: RulesSummary,
  presetId: ExecutionProfilePresetId,
): ExecutionProfilePresetValues {
  const risk = rules.risk_controls;
  const isConservative = presetId === "conservative";
  const isAggressive = presetId === "aggressive";
  const frictionMultiplier = isConservative ? 1.5 : isAggressive ? 0.5 : 1;
  const riskMultiplier = isConservative ? 0.5 : isAggressive ? 1.5 : 1;
  const cooldownMultiplier = isConservative ? 1.5 : isAggressive ? 0.5 : 1;

  return {
    initial_balance: formatInputNumber(rules.initial_balance),
    fee_rate: formatInputNumber(scaled(rules.fee_rate, frictionMultiplier)),
    slippage_rate: formatInputNumber(
      scaled(rules.slippage_rate, frictionMultiplier),
    ),
    allowed_symbols: risk.allowed_symbols.join(", "),
    max_position_quantity: formatInputNumber(
      scaled(risk.max_position_quantity, riskMultiplier),
    ),
    max_order_notional: formatInputNumber(
      scaled(risk.max_order_notional, riskMultiplier),
    ),
    max_daily_loss: formatInputNumber(scaled(risk.max_daily_loss, riskMultiplier)),
    cooldown_seconds: String(
      Math.max(0, Math.round(risk.cooldown_seconds * cooldownMultiplier)),
    ),
    max_open_notional: formatInputNumber(
      scaled(risk.max_open_notional, riskMultiplier),
    ),
  };
}

export function isExecutionProfilePresetApplied(
  current: Partial<ExecutionProfilePresetValues>,
  preset: ExecutionProfilePresetValues,
): boolean {
  return EXECUTION_PROFILE_FIELDS.every((field) => {
    const currentValue = current[field] ?? "";
    const presetValue = preset[field];

    if (NUMERIC_EXECUTION_PROFILE_FIELDS.has(field)) {
      return Number(currentValue) === Number(presetValue);
    }

    return currentValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .join(",") === presetValue
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .join(",");
  });
}
