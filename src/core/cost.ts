import type { PriceTable } from "./prices";
import type {
  ArtifactAttemptRow,
  AttemptArtifactRawCall,
  AttemptRecord,
  RawCallCost,
  SettleFlag,
  Usage,
} from "./types";

const USD_FIELD_KEYS = [
  "cost_usd",
  "costUsd",
  "total_cost_usd",
  "totalCostUsd",
  "usd_cost",
  "usdCost",
  "price_usd",
  "priceUsd",
] as const;

const MICRO_USD_FIELD_KEYS = ["micro_usd", "microUsd", "cost_micro_usd", "costMicroUsd"] as const;

const USD_OBJECT_KEYS = ["usd"] as const;
const MICRO_USD_OBJECT_KEYS = ["micro_usd", "microUsd"] as const;

/** Containers the settle record may wrap its payload in (one level of wrapping is searched). */
const CONTAINER_KEYS = [
  "data",
  "generation",
  "result",
  "settlement",
  "billing",
  "cost",
  "usage",
] as const;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function searchUsd(obj: Record<string, unknown>): number | null {
  for (const key of USD_FIELD_KEYS) {
    const value = finiteNumber(obj[key]);
    if (value !== null && value >= 0) {
      return value;
    }
  }
  for (const key of MICRO_USD_FIELD_KEYS) {
    const value = finiteNumber(obj[key]);
    if (value !== null && value >= 0) {
      return value / 1_000_000;
    }
  }
  for (const key of CONTAINER_KEYS) {
    const nested = obj[key];
    if (nested !== null && typeof nested === "object") {
      const nestedUsd = searchUsd(nested as Record<string, unknown>);
      if (nestedUsd !== null) {
        return nestedUsd;
      }
    }
  }
  // tokencamp's ledger bills in micro_usd (ADR-0004); a plain "usd" object is
  // checked before any generic "cost: number" assumption.
  for (const key of USD_OBJECT_KEYS) {
    const value = finiteNumber(obj[key]);
    if (value !== null && value >= 0) {
      return value;
    }
  }
  for (const key of MICRO_USD_OBJECT_KEYS) {
    const value = finiteNumber(obj[key]);
    if (value !== null && value >= 0) {
      return value / 1_000_000;
    }
  }
  return null;
}

/**
 * Extracts the customer-paid cost (USD) from a `GET /v1/generation/{id}` settle
 * record (ADR-0004/0006). Tolerant of key casing and one level of wrapping;
 * the live record shape is an unverified wire assumption (map fog) — null here
 * flags the attempt "missing" rather than guessing a cost.
 */
export function extractSettledCostUsd(settledGeneration: unknown): number | null {
  if (settledGeneration === null || typeof settledGeneration !== "object") {
    return null;
  }
  return searchUsd(settledGeneration as Record<string, unknown>);
}

function hasNonZeroUsage(usage: Usage | null | undefined): boolean {
  if (usage === null || usage === undefined) {
    return false;
  }
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadInputTokens > 0 ||
    usage.cacheWriteInputTokens > 0 ||
    usage.reasoningTokens > 0
  );
}

function priceRawCall(
  rawCall: AttemptRecord["rawCalls"][number],
  modelId: string,
  priceTable: PriceTable,
): RawCallCost {
  const settledCostUsd =
    rawCall.settledGeneration !== null ? extractSettledCostUsd(rawCall.settledGeneration) : null;
  // Failed tries carry zero usage — nothing was billed for them; retry folding
  // (ADR-0006) is therefore the plain sum over rawCalls.
  const computedCostUsd = priceTable.costFor(modelId, rawCall.usage);
  return { settledCostUsd, computedCostUsd };
}

export interface EnrichOptions {
  readonly priceTable: PriceTable;
  /** Instance id → difficulty tier from the frozen dataset (ADR-0003); missing instances stay null. */
  readonly instanceTiers?: ReadonlyMap<string, string>;
}

/**
 * Fills the cost module's field on an attempt row (ADR-0006):
 *
 * - headline = Σ settled token cost (computed fallback per call missing settle)
 *   + Tool Cost (Σ billed wall-clock × pinned machine rate);
 * - `settle: "settled"` when every billable call carries a settle record,
 *   `"missing"` when any falls back to computed, `"unbilled"` when nothing was
 *   captured at all ($0, flagged);
 * - computed stays per attempt as the reproducible anchor; settled − computed
 *   is the platform reconciliation line.
 *
 * Sync by design: settle is fetched inline by the resolver; refetch remains
 * available to the report layer via the captured generation ids.
 */
export function enrichAttemptRow(
  record: AttemptRecord,
  options: EnrichOptions,
): ArtifactAttemptRow {
  const priced = record.rawCalls.map((rawCall): AttemptArtifactRawCall => ({
    ...rawCall,
    ...priceRawCall(rawCall, record.model, options.priceTable),
  }));

  let computedTokenUsd = 0;
  let settledTokenUsd = 0;
  let billableCalls = 0;
  let settledCalls = 0;
  for (const call of priced) {
    computedTokenUsd += call.computedCostUsd;
    settledTokenUsd += call.settledCostUsd ?? call.computedCostUsd;
    if (call.status === "ok" && hasNonZeroUsage(call.usage)) {
      billableCalls++;
      if (call.settledCostUsd !== null) {
        settledCalls++;
      }
    }
  }

  const settle: SettleFlag =
    billableCalls === 0 ? "unbilled" : settledCalls === billableCalls ? "settled" : "missing";

  const toolCostUsd =
    record.toolCalls.length > 0 && record.sandboxSpec !== null
      ? options.priceTable.toolCost(record.toolCalls, record.sandboxSpec)
      : 0;

  return {
    ...record,
    rawCalls: priced,
    cost: {
      settle,
      headlineUsd: settledTokenUsd + toolCostUsd,
      settledTokenUsd,
      computedTokenUsd,
      toolCostUsd,
    },
    difficultyTier: options.instanceTiers?.get(record.instanceId) ?? null,
    verification: null,
  };
}
