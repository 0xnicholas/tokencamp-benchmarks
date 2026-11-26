import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ToolCallMetering, Usage } from "./types";

/** Configuration problems in the pinned price table — refuse before any spend (ADR-0006). */
export class PriceTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceTableError";
  }
}

export interface PriceProvenance {
  readonly source: string;
  readonly pinnedAt: string;
}

export interface ModelPrice {
  readonly id: string;
  readonly usdPer1mInput: number;
  readonly usdPer1mOutput: number;
  /** null = the catalog does not disclose a cache price; defaults to the input price. */
  readonly usdPer1mCacheRead: number | null;
  readonly usdPer1mCacheWrite: number | null;
  readonly provenance: PriceProvenance;
}

export interface SandboxRate {
  readonly spec: string;
  readonly usdPerHour: number;
  readonly provenance: PriceProvenance;
}

export interface PriceTableMeta {
  readonly formatVersion: number;
  readonly name: string | null;
  readonly pinnedAt: string;
  readonly provenance: string | null;
}

const TOKENS_PER_USD_UNIT = 1_000_000;
const MS_PER_HOUR = 3_600_000;

interface RawProvenance {
  readonly source?: unknown;
  readonly pinned_at?: unknown;
}

interface RawPriceTable {
  readonly meta?: Record<string, unknown>;
  readonly models?: unknown;
  readonly sandbox_rates?: unknown;
}

function provenanceOf(raw: RawProvenance, what: string): PriceProvenance {
  const source = raw.source;
  const pinnedAt = raw.pinned_at;
  if (typeof source !== "string" || source.trim() === "") {
    throw new PriceTableError(
      `${what} is missing provenance.source — every price row carries its provenance (ADR-0006)`,
    );
  }
  if (typeof pinnedAt !== "string" || pinnedAt.trim() === "") {
    throw new PriceTableError(
      `${what} is missing provenance.pinned_at — every price row carries its pin date (ADR-0006)`,
    );
  }
  return { source, pinnedAt };
}

function positiveNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PriceTableError(
      `${what} must be a positive finite number, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function optionalPositive(value: unknown, what: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return positiveNumber(value, what);
}

function parseModelPrice(raw: unknown, index: number): ModelPrice {
  if (raw === null || typeof raw !== "object") {
    throw new PriceTableError(`models[${index}] is not an object`);
  }
  const row = raw as Record<string, unknown>;
  const id = row.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new PriceTableError(`models[${index}] is missing a catalog model id`);
  }
  const what = `models["${id}"]`;
  return {
    id,
    usdPer1mInput: positiveNumber(row.usd_per_1m_input, `${what}.usd_per_1m_input`),
    usdPer1mOutput: positiveNumber(row.usd_per_1m_output, `${what}.usd_per_1m_output`),
    usdPer1mCacheRead: optionalPositive(row.usd_per_1m_cache_read, `${what}.usd_per_1m_cache_read`),
    usdPer1mCacheWrite: optionalPositive(
      row.usd_per_1m_cache_write,
      `${what}.usd_per_1m_cache_write`,
    ),
    provenance: provenanceOf((row.provenance ?? {}) as RawProvenance, what),
  };
}

function parseSandboxRate(raw: unknown, index: number): SandboxRate {
  if (raw === null || typeof raw !== "object") {
    throw new PriceTableError(`sandbox_rates[${index}] is not an object`);
  }
  const row = raw as Record<string, unknown>;
  const spec = row.spec;
  if (typeof spec !== "string" || spec.trim() === "") {
    throw new PriceTableError(`sandbox_rates[${index}] is missing its sandbox spec`);
  }
  const what = `sandbox_rates["${spec}"]`;
  return {
    spec,
    usdPerHour: positiveNumber(row.usd_per_hour, `${what}.usd_per_hour`),
    provenance: provenanceOf((row.provenance ?? {}) as RawProvenance, what),
  };
}

/**
 * The Pinned Price Table (ADR-0006): usage → cost, sandbox wall-clock → Tool Cost.
 * Cache-read tokens are a subset of inputTokens (OpenAI-compat usage), so the
 * uncached remainder bills at the input price; cache rows default to the input
 * price when the catalog does not disclose one. Reasoning tokens ride inside
 * outputTokens and are never billed separately.
 */
export class PriceTable {
  readonly meta: PriceTableMeta;
  readonly #models: ReadonlyMap<string, ModelPrice>;
  readonly #sandbox: ReadonlyMap<string, SandboxRate>;

  constructor(raw: RawPriceTable) {
    const meta = raw.meta;
    if (meta === null || typeof meta !== "object") {
      throw new PriceTableError("price table is missing its meta section");
    }
    const formatVersion = meta.format_version;
    if (formatVersion !== 1) {
      throw new PriceTableError(
        `price table format_version must be 1, got ${JSON.stringify(formatVersion)}`,
      );
    }
    const pinnedAt = meta.pinned_at;
    if (typeof pinnedAt !== "string" || pinnedAt.trim() === "") {
      throw new PriceTableError(
        "price table meta is missing pinned_at — a price table without a pin date is not pinned",
      );
    }
    const provenance = meta.provenance;
    if (typeof provenance !== "string" || provenance.trim() === "") {
      throw new PriceTableError(
        "price table meta is missing provenance — an unpinned price source violates ADR-0006",
      );
    }
    const name = meta.name;
    this.meta = {
      formatVersion: 1,
      name: typeof name === "string" ? name : null,
      pinnedAt,
      provenance,
    };

    if (!Array.isArray(raw.models)) {
      throw new PriceTableError("price table is missing its models array");
    }
    const models = new Map<string, ModelPrice>();
    for (const [index, rawModel] of raw.models.entries()) {
      const model = parseModelPrice(rawModel, index);
      if (models.has(model.id)) {
        throw new PriceTableError(`duplicate model id in price table: "${model.id}"`);
      }
      models.set(model.id, model);
    }
    this.#models = models;

    if (!Array.isArray(raw.sandbox_rates)) {
      throw new PriceTableError("price table is missing its sandbox_rates array");
    }
    const sandbox = new Map<string, SandboxRate>();
    for (const [index, rawRate] of raw.sandbox_rates.entries()) {
      const rate = parseSandboxRate(rawRate, index);
      if (sandbox.has(rate.spec)) {
        throw new PriceTableError(`duplicate sandbox spec in price table: "${rate.spec}"`);
      }
      sandbox.set(rate.spec, rate);
    }
    this.#sandbox = sandbox;
  }

  hasModel(modelId: string): boolean {
    return this.#models.has(modelId);
  }

  modelIds(): readonly string[] {
    return [...this.#models.keys()].sort();
  }

  sandboxSpecs(): readonly string[] {
    return [...this.#sandbox.keys()].sort();
  }

  /**
   * Computed Cost (ADR-0006): usage × the pinned price table. Throws on an
   * unknown model — startup validation refuses before any spend; this is the
   * library-caller backstop.
   */
  costFor(modelId: string, usage: Usage): number {
    const price = this.#models.get(modelId);
    if (price === undefined) {
      throw new PriceTableError(
        `model "${modelId}" is not in the pinned price table — a score without cost violates the destination (ADR-0006)`,
      );
    }
    const cacheRead = Math.max(0, usage.cacheReadInputTokens);
    // Subset semantics (OpenAI-compat): cached_tokens ⊆ prompt_tokens, so only
    // the uncached remainder bills at the input price.
    const uncachedInput = Math.max(0, usage.inputTokens - cacheRead);
    const cacheWrite = Math.max(0, usage.cacheWriteInputTokens);
    const cacheReadPrice = price.usdPer1mCacheRead ?? price.usdPer1mInput;
    const cacheWritePrice = price.usdPer1mCacheWrite ?? price.usdPer1mInput;
    const usd =
      (uncachedInput * price.usdPer1mInput +
        cacheRead * cacheReadPrice +
        cacheWrite * cacheWritePrice +
        Math.max(0, usage.outputTokens) * price.usdPer1mOutput) /
      TOKENS_PER_USD_UNIT;
    return usd;
  }

  /** The pinned machine rate for a sandbox spec (USD/hour). Throws on unknown specs. */
  sandboxRate(spec: string): SandboxRate {
    const rate = this.#sandbox.get(spec);
    if (rate === undefined) {
      throw new PriceTableError(
        `sandbox spec "${spec}" has no pinned machine rate — a score without cost violates the destination (ADR-0006)`,
      );
    }
    return rate;
  }

  /**
   * Tool Cost (ADR-0006): Σ billed tool-call wall-clock × machine rate. Zero
   * for tool-free configurations; sandbox startup and verification runs are
   * harness overhead, never tool cost (ADR-0007).
   */
  toolCost(toolCalls: readonly ToolCallMetering[], sandboxSpec: string): number {
    const rate = this.sandboxRate(sandboxSpec);
    const billedMs = toolCalls.reduce((sum, call) => sum + Math.max(0, call.wallClockMs), 0);
    return (billedMs / MS_PER_HOUR) * rate.usdPerHour;
  }
}

export interface LoadedPriceTable {
  readonly table: PriceTable;
  /** sha256 over the exact file bytes — the manifest's catalog snapshot / price-table pin. */
  readonly sha256: string;
  readonly path: string;
}

/**
 * Loads and validates the pinned price table. The file is git-versioned in
 * repo (ADR-0006); its content sha is what the run manifest records, so
 * re-pinning between runs is visible and mid-run drift is detectable.
 */
export async function loadPriceTable(
  path: string = "prices/prices.json",
): Promise<LoadedPriceTable> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new PriceTableError(
      `cannot read the pinned price table at "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let raw: RawPriceTable;
  try {
    raw = JSON.parse(bytes.toString("utf8")) as RawPriceTable;
  } catch (error) {
    throw new PriceTableError(
      `price table at "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const table = new PriceTable(raw);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { table, sha256, path };
}
