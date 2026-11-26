import { describe, expect, test } from "bun:test";
import { PriceTableError, loadPriceTable } from "./prices";
import { enrichAttemptRow, extractSettledCostUsd } from "./cost";
import type { AttemptRawCall, AttemptRecord, ToolCallMetering, Usage } from "./types";

const M3 = "minimax/minimax-m3"; // input $0.30/1M, output $1.20/1M, no cache row

const usage = (overrides: Partial<Usage> = {}): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  reasoningTokens: 0,
  ...overrides,
});

function rawCall(overrides: Partial<AttemptRawCall> = {}): AttemptRawCall {
  return {
    traceId: "run.1.inst.1",
    status: "ok",
    generationId: "gen-1",
    usage: usage(),
    latencyMs: 42,
    cfRay: null,
    xRequestId: null,
    settledGeneration: null,
    error: null,
    ...overrides,
  };
}

function attemptRow(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    runId: "run",
    benchmarkId: "task/codegen",
    model: M3,
    instanceId: "inst",
    epoch: 1,
    attempt: 1,
    status: "ok",
    output: "print(1)",
    usage: usage(),
    traceId: "run.1.inst.1",
    latencyMs: 42,
    providerResponseId: "gen-1",
    rawCalls: [rawCall()],
    cost: null,
    toolCalls: [],
    sandboxSpec: null,
    ...overrides,
  };
}

const table = (await loadPriceTable("prices/prices.json")).table;

describe("extractSettledCostUsd", () => {
  test.each([
    ["cost_usd", { cost_usd: 0.0123 }, 0.0123],
    ["camelCase usd key", { costUsd: "0.5" }, 0.5],
    ["tokencamp micro_usd ledger", { micro_usd: 12345 }, 0.012345],
    ["camelCase micro key", { microUsd: 1_000_000 }, 1],
    ["nested generation container", { generation: { cost_usd: 0.02 } }, 0.02],
    ["nested data → billing container", { data: { billing: { micro_usd: 1000 } } }, 0.001],
    ["cost object with usd inside", { cost: { usd: 0.5 } }, 0.5],
    ["total_cost_usd alias", { total_cost_usd: 3.5 }, 3.5],
  ])("reads %s", (_name, record, expected) => {
    expect(extractSettledCostUsd(record)).toBeCloseTo(expected, 12);
  });

  test.each([
    ["an unrecognized shape", { foo: "bar" }],
    ["a negative cost", { cost_usd: -1 }],
    ["a non-numeric cost", { cost_usd: "lots" }],
    ["null", null],
    ["undefined", undefined],
  ])("returns null on %s", (_name, record) => {
    expect(extractSettledCostUsd(record)).toBeNull();
  });
});

describe("enrichAttemptRow — ADR-0006 cost semantics", () => {
  test("fully settled attempt: headline = settled cost, computed kept as the anchor", () => {
    const row = enrichAttemptRow(
      attemptRow({
        rawCalls: [
          rawCall({
            usage: usage({
              inputTokens: 1_000_000,
              cacheReadInputTokens: 400_000,
              outputTokens: 1_000_000,
            }),
            settledGeneration: { cost_usd: 1.45 },
          }),
        ],
      }),
      { priceTable: table },
    );
    expect(row.cost.settle).toBe("settled");
    expect(row.cost.settledTokenUsd).toBeCloseTo(1.45, 12);
    expect(row.cost.computedTokenUsd).toBeCloseTo(1.5, 10);
    expect(row.cost.toolCostUsd).toBe(0);
    expect(row.cost.headlineUsd).toBeCloseTo(1.45, 12);
    expect(row.verification).toBeNull();
    expect(row.difficultyTier).toBeNull();
  });

  test("per-call settledCost rides the artifact row's rawCalls", () => {
    const row = enrichAttemptRow(
      attemptRow({ rawCalls: [rawCall({ settledGeneration: { cost_usd: 1.45 } })] }),
      { priceTable: table },
    );
    expect(row.rawCalls).toHaveLength(1);
    expect(row.rawCalls[0]!.settledCostUsd).toBeCloseTo(1.45, 12);
    expect(row.rawCalls[0]!.computedCostUsd).toBeCloseTo(0, 12);
  });

  test("missing settle falls back to computed and flags 'missing' (ADR-0006)", () => {
    const row = enrichAttemptRow(
      attemptRow({
        rawCalls: [
          rawCall({
            traceId: "run.1.inst.1",
            usage: usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
            settledGeneration: { cost_usd: 1.45 },
          }),
          rawCall({
            traceId: "run.1.inst.2",
            generationId: "gen-2",
            usage: usage({ inputTokens: 100_000 }),
            settledGeneration: null,
          }),
        ],
      }),
      { priceTable: table },
    );
    expect(row.cost.settle).toBe("missing");
    // settled where present (1.45) + computed fallback for the missing one (0.03)
    expect(row.cost.settledTokenUsd).toBeCloseTo(1.48, 10);
    expect(row.cost.computedTokenUsd).toBeCloseTo(1.53, 10);
    expect(row.cost.headlineUsd).toBeCloseTo(1.48, 10);
  });

  test("transport retries fold into the attempt: failed tries cost nothing", () => {
    const row = enrichAttemptRow(
      attemptRow({
        rawCalls: [
          rawCall({
            traceId: "run.1.inst.0",
            status: "transport-failed",
            generationId: null,
            usage: usage(),
            error: "HTTP 429",
          }),
          rawCall({
            traceId: "run.1.inst.1",
            usage: usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }),
            settledGeneration: { cost_usd: 1.44 },
          }),
        ],
      }),
      { priceTable: table },
    );
    expect(row.cost.settle).toBe("settled");
    expect(row.cost.headlineUsd).toBeCloseTo(1.44, 12);
    expect(row.cost.computedTokenUsd).toBeCloseTo(1.5, 10);
  });

  test("no usage captured either ⇒ $0, flagged 'unbilled' (ADR-0006)", () => {
    const row = enrichAttemptRow(
      attemptRow({
        status: "transport-failed",
        usage: usage(),
        rawCalls: [
          rawCall({
            status: "transport-failed",
            generationId: null,
            usage: usage(),
            error: "timeout",
          }),
        ],
      }),
      { priceTable: table },
    );
    expect(row.cost.settle).toBe("unbilled");
    expect(row.cost.headlineUsd).toBe(0);
    expect(row.cost.computedTokenUsd).toBe(0);
  });

  test("tool cost joins the headline: 15 minutes of sandbox time at $0.20/h = $0.05", () => {
    const calls: ToolCallMetering[] = [
      {
        toolName: "run_command",
        wallClockMs: 600_000,
        exitCode: 0,
        stdoutTail: null,
        stderrTail: null,
      },
      {
        toolName: "read_file",
        wallClockMs: 300_000,
        exitCode: 0,
        stdoutTail: null,
        stderrTail: null,
      },
    ];
    const row = enrichAttemptRow(
      attemptRow({
        rawCalls: [
          rawCall({
            usage: usage({ outputTokens: 1_000_000 }),
            settledGeneration: { cost_usd: 1.2 },
          }),
        ],
        toolCalls: calls,
        sandboxSpec: "docker:4cpu:16gb",
      }),
      { priceTable: table },
    );
    expect(row.cost.toolCostUsd).toBeCloseTo(0.05, 10);
    expect(row.cost.headlineUsd).toBeCloseTo(1.25, 10);
    expect(row.cost.settle).toBe("settled");
  });

  test("tool-free rows price at zero tools even with a sandboxSpec", () => {
    const row = enrichAttemptRow(attemptRow({ toolCalls: [], sandboxSpec: "docker:4cpu:16gb" }), {
      priceTable: table,
    });
    expect(row.cost.toolCostUsd).toBe(0);
  });

  test("an unknown model refuses to enrich — the startup gate is the CLI's, this is the backstop", () => {
    expect(() =>
      enrichAttemptRow(attemptRow({ model: "forge/never-heard-of-it" }), { priceTable: table }),
    ).toThrow(PriceTableError);
  });

  test("attempt identity and evidence carry through unchanged", () => {
    const record = attemptRow();
    const row = enrichAttemptRow(record, { priceTable: table });
    expect(row.runId).toBe(record.runId);
    expect(row.instanceId).toBe(record.instanceId);
    expect(row.epoch).toBe(record.epoch);
    expect(row.attempt).toBe(record.attempt);
    expect(row.output).toBe(record.output);
    expect(row.traceId).toBe(record.traceId);
    expect(row.usage).toEqual(record.usage);
    expect(row.rawCalls[0]!.traceId).toBe("run.1.inst.1");
    expect(row.rawCalls[0]!.settledGeneration).toBeNull();
  });

  test("instanceTiers fills difficultyTier from the dataset's instance map", () => {
    const row = enrichAttemptRow(attemptRow(), {
      priceTable: table,
      instanceTiers: new Map([["inst", "hard"]]),
    });
    expect(row.difficultyTier).toBe("hard");
  });
});
