import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PriceTableError, loadPriceTable } from "./prices";
import type { ToolCallMetering, Usage } from "./types";

const REAL_TABLE = "prices/prices.json";

const usage = (overrides: Partial<Usage> = {}): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  reasoningTokens: 0,
  ...overrides,
});

const toolCall = (overrides: Partial<ToolCallMetering> = {}): ToolCallMetering => ({
  toolName: "run_command",
  wallClockMs: 0,
  exitCode: 0,
  stdoutTail: null,
  stderrTail: null,
  ...overrides,
});

async function writeTable(raw: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "prices-"));
  const file = path.join(dir, "prices.json");
  await writeFile(file, JSON.stringify(raw));
  return file;
}

describe("loadPriceTable", () => {
  test("loads the pinned v1 table: nine matrix models, one sandbox spec, content sha256", async () => {
    const loaded = await loadPriceTable(REAL_TABLE);
    expect(loaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.table.hasModel("zhipu/glm-5.3-flash")).toBe(true);
    expect(loaded.table.hasModel("tokencamp/auto")).toBe(false);
    expect(loaded.table.modelIds()).toHaveLength(9);
    const rate = loaded.table.sandboxRate("docker:4cpu:16gb");
    expect(rate.usdPerHour).toBe(0.2);
    expect(rate.provenance.pinnedAt).toBe("2026-11-26");
  });

  test("same bytes always hash to the same sha (the pin is content-addressed)", async () => {
    const [a, b] = await Promise.all([loadPriceTable(REAL_TABLE), loadPriceTable(REAL_TABLE)]);
    expect(a.sha256).toBe(b.sha256);
  });
});

describe("PriceTable.costFor", () => {
  test("worked example — minimax/minimax-m3, 600k uncached input + 400k cache-read + 1M output = $1.50", async () => {
    const { table } = await loadPriceTable(REAL_TABLE);
    // input $0.30/1M, output $1.20/1M, no cache row disclosed → cache prices default to input
    const cost = table.costFor(
      "minimax/minimax-m3",
      usage({ inputTokens: 1_000_000, cacheReadInputTokens: 400_000, outputTokens: 1_000_000 }),
    );
    // (1M − 400k) × $0.30/1M + 400k × $0.30/1M + 1M × $1.20/1M = 0.18 + 0.12 + 1.20
    expect(cost).toBeCloseTo(1.5, 10);
  });

  test("cache-read and cache-write default to the input price when the row omits them", async () => {
    const { table } = await loadPriceTable(REAL_TABLE);
    const cost = table.costFor(
      "minimax/minimax-m3",
      usage({ inputTokens: 500_000, cacheWriteInputTokens: 200_000 }),
    );
    // 500k × 0.3/1M + 200k × 0.3/1M = 0.15 + 0.06
    expect(cost).toBeCloseTo(0.21, 10);
  });

  test("reasoning tokens ride inside outputTokens — never billed separately", async () => {
    const { table } = await loadPriceTable(REAL_TABLE);
    const withReasoning = table.costFor(
      "minimax/minimax-m3",
      usage({ outputTokens: 1_000_000, reasoningTokens: 300_000 }),
    );
    const plain = table.costFor("minimax/minimax-m3", usage({ outputTokens: 1_000_000 }));
    expect(withReasoning).toBeCloseTo(plain, 12);
  });

  test("a row that pins a cache-read price uses it instead of the input price", async () => {
    const file = await writeTable({
      meta: { format_version: 1, pinned_at: "2026-11-26", provenance: "test" },
      models: [
        {
          id: "test/model",
          usd_per_1m_input: 1,
          usd_per_1m_output: 2,
          usd_per_1m_cache_read: 0.1,
          provenance: { source: "test", pinned_at: "2026-11-26" },
        },
      ],
      sandbox_rates: [],
    });
    const { table } = await loadPriceTable(file);
    const cost = table.costFor(
      "test/model",
      usage({ inputTokens: 1_000_000, cacheReadInputTokens: 1_000_000 }),
    );
    // 0 uncached + 1M × $0.1/1M
    expect(cost).toBeCloseTo(0.1, 10);
  });

  test("an unknown model id refuses to price — a score without cost violates the destination", async () => {
    const { table } = await loadPriceTable(REAL_TABLE);
    expect(() => table.costFor("forge/some-virtual-id", usage())).toThrow(PriceTableError);
  });
});

describe("PriceTable.toolCost", () => {
  test("Σ billed wall-clock × machine rate: 15 minutes of sandbox time at $0.20/h = $0.05", async () => {
    const { table } = await loadPriceTable(REAL_TABLE);
    const calls = [toolCall({ wallClockMs: 600_000 }), toolCall({ wallClockMs: 300_000 })];
    expect(table.toolCost(calls, "docker:4cpu:16gb")).toBeCloseTo(0.05, 10);
  });

  test("an unknown sandbox spec refuses — same discipline as unknown models (ADR-0006)", async () => {
    const { table } = await loadPriceTable(REAL_TABLE);
    expect(() => table.toolCost([toolCall({ wallClockMs: 1 })], "docker:99cpu:1gb")).toThrow(
      PriceTableError,
    );
  });
});

describe("price table validation", () => {
  const validModel = {
    id: "test/model",
    usd_per_1m_input: 1,
    usd_per_1m_output: 2,
    provenance: { source: "test", pinned_at: "2026-11-26" },
  };
  const validTable = () => ({
    meta: { format_version: 1, pinned_at: "2026-11-26", provenance: "test" },
    models: [validModel],
    sandbox_rates: [
      {
        spec: "docker:4cpu:16gb",
        usd_per_hour: 0.2,
        provenance: { source: "test", pinned_at: "2026-11-26" },
      },
    ],
  });

  test("a missing file refuses with a clear error", async () => {
    expect(loadPriceTable("prices/does-not-exist.json")).rejects.toThrow(PriceTableError);
  });

  test.each([
    [
      "negative input price",
      { ...validTable(), models: [{ ...validModel, usd_per_1m_input: -1 }] },
    ],
    ["zero output price", { ...validTable(), models: [{ ...validModel, usd_per_1m_output: 0 }] }],
    ["duplicate model id", { ...validTable(), models: [validModel, validModel] }],
    [
      "model row without provenance",
      {
        ...validTable(),
        models: [{ id: "test/model", usd_per_1m_input: 1, usd_per_1m_output: 2 }],
      },
    ],
    [
      "sandbox rate without provenance",
      {
        ...validTable(),
        sandbox_rates: [{ spec: "docker:4cpu:16gb", usd_per_hour: 0.2 }],
      },
    ],
    [
      "negative machine rate",
      {
        ...validTable(),
        sandbox_rates: [
          {
            spec: "docker:4cpu:16gb",
            usd_per_hour: -0.2,
            provenance: { source: "test", pinned_at: "2026-11-26" },
          },
        ],
      },
    ],
    [
      "unknown format_version",
      { ...validTable(), meta: { ...validTable().meta, format_version: 2 } },
    ],
    ["missing pinned_at", { ...validTable(), meta: { format_version: 1, provenance: "test" } }],
  ])("rejects %s", async (_name, raw) => {
    const file = await writeTable(raw);
    expect(loadPriceTable(file)).rejects.toThrow(PriceTableError);
  });

  test("an empty sandbox_rates section is legal — tool-free v1 runs", async () => {
    const file = await writeTable({ ...validTable(), sandbox_rates: [] });
    const { table } = await loadPriceTable(file);
    expect(table.sandboxSpecs()).toHaveLength(0);
  });
});
