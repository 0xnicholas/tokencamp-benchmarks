import { describe, expect, test } from "bun:test";
import { assembleSummary } from "./summary";
import type { ArtifactAttemptRow, AttemptCost, AttemptVerification } from "./types";

const cost = (overrides: Partial<AttemptCost> = {}): AttemptCost => ({
  settle: "settled",
  headlineUsd: 1,
  settledTokenUsd: 1,
  computedTokenUsd: 1,
  toolCostUsd: 0,
  ...overrides,
});

const verification = (overrides: Partial<AttemptVerification> = {}): AttemptVerification => ({
  verifier: "mbpp_unit_tests",
  gate: true,
  score: 1,
  detail: {},
  ...overrides,
});

function row(
  overrides: Partial<ArtifactAttemptRow> & {
    instanceId?: string;
    epoch?: number;
    cost?: AttemptCost;
    verification?: AttemptVerification | null;
    difficultyTier?: string | null;
  },
): ArtifactAttemptRow {
  return {
    runId: "run-1",
    benchmarkId: "task/codegen",
    model: "minimax/minimax-m3",
    instanceId: overrides.instanceId ?? "inst",
    epoch: overrides.epoch ?? 1,
    attempt: 1,
    status: "ok",
    output: "out",
    usage: null,
    traceId: null,
    latencyMs: null,
    providerResponseId: null,
    rawCalls: [],
    toolCalls: [],
    sandboxSpec: null,
    difficultyTier: null,
    verification: null,
    ...overrides,
    cost: overrides.cost ?? cost(),
  } as ArtifactAttemptRow;
}

const OVERHEAD = { verifierExecutionUsd: 0.25, sandboxStartupUsd: 0.05 };

function summarize(rows: readonly ArtifactAttemptRow[]) {
  return assembleSummary({
    runId: "run-1",
    configHash: "hash",
    rows,
    overhead: OVERHEAD,
    generatedAt: "2026-11-26T00:00:00Z",
  });
}

describe("assembleSummary — money (ADR-0006)", () => {
  test("empty run: zero spend, no invented CPET, empty groups", () => {
    const summary = summarize([]);
    expect(summary.coverage.attempts).toBe(0);
    expect(summary.money.totalSpendUsd).toBe(0);
    expect(summary.money.cpetUsd).toBeNull();
    expect(summary.money.wasteShare).toBeNull();
    expect(summary.quality).toBeNull();
    expect(summary.byTaskType).toEqual({});
    expect(summary.harnessOverhead.totalUsd).toBeCloseTo(0.3, 12);
  });

  test("CPET = total spend across ALL attempts ÷ effective tasks (failures and retries included)", () => {
    const summary = summarize([
      row({
        instanceId: "a",
        cost: cost({ headlineUsd: 1 }),
        verification: verification({ gate: true }),
      }),
      row({
        instanceId: "b",
        cost: cost({ headlineUsd: 2 }),
        verification: verification({ gate: false, score: 0.4 }),
      }),
      row({ instanceId: "c", cost: cost({ headlineUsd: 0.5 }) }),
    ]);
    expect(summary.money.totalSpendUsd).toBeCloseTo(3.5, 12);
    expect(summary.money.effectiveTasks).toBe(1);
    expect(summary.money.cpetUsd).toBeCloseTo(3.5, 12);
  });

  test("waste share = verified-failed spend ÷ total spend, unverified spend disclosed", () => {
    const summary = summarize([
      row({
        instanceId: "a",
        cost: cost({ headlineUsd: 1 }),
        verification: verification({ gate: true }),
      }),
      row({
        instanceId: "b",
        cost: cost({ headlineUsd: 2 }),
        verification: verification({ gate: false, score: 0.4 }),
      }),
      row({ instanceId: "c", cost: cost({ headlineUsd: 0.5 }) }),
    ]);
    expect(summary.money.wasteShare).toBeCloseTo(2 / 3.5, 12);
    expect(summary.money.unverifiedSpendUsd).toBeCloseTo(0.5, 12);
  });

  test("multiple effective tasks divide the spend", () => {
    const summary = summarize([
      row({
        instanceId: "a",
        epoch: 1,
        cost: cost({ headlineUsd: 1 }),
        verification: verification(),
      }),
      row({
        instanceId: "a",
        epoch: 2,
        cost: cost({ headlineUsd: 1 }),
        verification: verification({ gate: false, score: 0.9 }),
      }),
      row({
        instanceId: "b",
        epoch: 1,
        cost: cost({ headlineUsd: 2 }),
        verification: verification(),
      }),
    ]);
    expect(summary.money.effectiveTasks).toBe(2);
    expect(summary.money.cpetUsd).toBeCloseTo(2, 12);
  });

  test("no effective tasks ⇒ CPET is null, never a misleading zero or infinity", () => {
    const summary = summarize([
      row({
        instanceId: "a",
        cost: cost({ headlineUsd: 2 }),
        verification: verification({ gate: false, score: 0.4 }),
      }),
    ]);
    expect(summary.money.cpetUsd).toBeNull();
    expect(summary.money.wasteShare).toBe(1);
  });

  test("spend decomposition and settle coverage aggregate per flag", () => {
    const summary = summarize([
      row({
        instanceId: "a",
        cost: cost({ headlineUsd: 1, settledTokenUsd: 0.9, computedTokenUsd: 1, toolCostUsd: 0.1 }),
      }),
      row({
        instanceId: "b",
        cost: cost({
          settle: "missing",
          headlineUsd: 0.4,
          settledTokenUsd: 0.4,
          computedTokenUsd: 0.5,
        }),
      }),
      row({
        instanceId: "c",
        cost: cost({ settle: "unbilled", headlineUsd: 0, settledTokenUsd: 0, computedTokenUsd: 0 }),
      }),
    ]);
    expect(summary.money.tokenSpendUsd.settled).toBeCloseTo(1.3, 12);
    expect(summary.money.tokenSpendUsd.computed).toBeCloseTo(1.5, 12);
    expect(summary.money.toolSpendUsd).toBeCloseTo(0.1, 12);
    expect(summary.money.settleCoverage).toEqual({ settled: 1, missing: 1, unbilled: 1 });
  });
});

describe("assembleSummary — quality (ADR-0005)", () => {
  test("Task Success Rate = mean gate; Quality = mean score over all verified outcomes", () => {
    const summary = summarize([
      row({ instanceId: "a", epoch: 1, verification: verification({ gate: true, score: 1 }) }),
      row({ instanceId: "a", epoch: 2, verification: verification({ gate: false, score: 0.5 }) }),
      row({ instanceId: "b", epoch: 1, verification: verification({ gate: true, score: 0.75 }) }),
    ]);
    expect(summary.quality?.verifiedAttempts).toBe(3);
    expect(summary.quality?.taskSuccessRate).toBeCloseTo(2 / 3, 12);
    expect(summary.quality?.meanQualityScore).toBeCloseTo((1 + 0.5 + 0.75) / 3, 12);
  });

  test("Reliability = per-instance gate-pass fraction, averaged across instances", () => {
    const summary = summarize([
      row({ instanceId: "inst-1", epoch: 1, verification: verification({ gate: true }) }),
      row({ instanceId: "inst-1", epoch: 2, verification: verification({ gate: true }) }),
      row({
        instanceId: "inst-2",
        epoch: 1,
        verification: verification({ gate: false, score: 0 }),
      }),
    ]);
    // inst-1: 2/2; inst-2: 0/1 → mean 0.5
    expect(summary.quality?.reliability).toBeCloseTo(0.5, 12);
    expect(summary.quality?.instancesWithVerification).toBe(2);
  });

  test("unverified attempts never enter the quality aggregates", () => {
    const summary = summarize([
      row({ instanceId: "a", epoch: 1, verification: verification({ gate: true }) }),
      row({ instanceId: "b", epoch: 1, cost: cost({ headlineUsd: 0.4 }) }),
    ]);
    expect(summary.quality?.verifiedAttempts).toBe(1);
    expect(summary.quality?.taskSuccessRate).toBe(1);
    expect(summary.coverage.verifiedAttempts).toBe(1);
    expect(summary.coverage.instances).toBe(2);
    // but their spend still counts
    expect(summary.money.totalSpendUsd).toBeCloseTo(1.4, 12);
  });
});

describe("assembleSummary — grouping and ledger", () => {
  test("config key is benchmark × model; task type and tier group separately", () => {
    const summary = summarize([
      row({
        instanceId: "a",
        difficultyTier: "easy",
        cost: cost({ headlineUsd: 1 }),
        verification: verification(),
      }),
      row({
        instanceId: "b",
        difficultyTier: null,
        cost: cost({ headlineUsd: 2 }),
        verification: verification({ gate: false, score: 0.5 }),
      }),
    ]);
    expect(Object.keys(summary.configs)).toEqual(["task/codegen|minimax/minimax-m3"]);
    expect(Object.keys(summary.byTaskType)).toEqual(["task/codegen"]);
    // null-tier rows are omitted from tier grouping, never bucketed as a fake tier
    expect(Object.keys(summary.byDifficultyTier)).toEqual(["easy"]);
    expect(summary.byDifficultyTier["easy"]!.money.effectiveTasks).toBe(1);
  });

  test("the run-level ledger carries totals and per-type tables, and no cross-type CPET", () => {
    const summary = summarize([
      row({ instanceId: "a", cost: cost({ headlineUsd: 1 }), verification: verification() }),
    ]);
    expect(summary.ledger.totalSpendUsd).toBeCloseTo(1, 12);
    expect(summary.ledger.perType["task/codegen"]).toBeDefined();
    expect(summary.ledger.perType["task/codegen"]!.cpetUsd).toBeCloseTo(1, 12);
    expect(summary.ledger).not.toHaveProperty("cpetUsd");
  });

  test("harness overhead is disclosed and kept out of every CPET numerator", () => {
    const summary = summarize([
      row({ instanceId: "a", cost: cost({ headlineUsd: 1 }), verification: verification() }),
    ]);
    expect(summary.harnessOverhead.verifierExecutionUsd).toBeCloseTo(0.25, 12);
    expect(summary.harnessOverhead.sandboxStartupUsd).toBeCloseTo(0.05, 12);
    expect(summary.harnessOverhead.note).toContain("excluded from CPET");
    // CPET uses attempt spend only
    expect(summary.money.cpetUsd).toBeCloseTo(1, 12);
  });
});
