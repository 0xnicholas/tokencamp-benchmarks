import { describe, expect, test } from "bun:test";
import { AttemptLedger } from "./attempts";
import type { AttemptRawCall, AttemptRecord, Usage } from "./types";

const USAGE: Usage = {
  inputTokens: 10,
  outputTokens: 5,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  reasoningTokens: 0,
};

function rawCall(overrides: Partial<AttemptRawCall> = {}): AttemptRawCall {
  return {
    traceId: "run.1.inst.1",
    status: "ok",
    generationId: "gen-1",
    usage: USAGE,
    latencyMs: 42,
    cfRay: null,
    xRequestId: null,
    settledGeneration: null,
    error: null,
    ...overrides,
  };
}

function standaloneInput(overrides: Partial<{ instanceId: string; epoch: number }> = {}) {
  return {
    runId: "run",
    benchmarkId: "fake",
    model: "zhipu/glm-5.3-flash",
    instanceId: overrides.instanceId ?? "inst",
    epoch: overrides.epoch ?? 1,
  };
}

describe("AttemptLedger", () => {
  test("standalone rows number attempts per (instance, epoch) and mirror their raw call", () => {
    const ledger = new AttemptLedger();
    const row1 = ledger.recordStandalone(standaloneInput(), rawCall(), "out-1");
    const row2 = ledger.recordStandalone(standaloneInput(), rawCall(), "out-2");
    const epoch2 = ledger.recordStandalone(standaloneInput({ epoch: 2 }), rawCall(), "out-3");

    expect(row1.attempt).toBe(1);
    expect(row2.attempt).toBe(2);
    expect(epoch2.attempt).toBe(1);
    expect(row1.traceId).toBe("run.1.inst.1");
    expect(row1.status).toBe("ok");
    expect(row1.output).toBe("out-1");
    expect(row1.usage).toEqual(USAGE);
    expect(row1.latencyMs).toBe(42);
    expect(row1.providerResponseId).toBe("gen-1");
    expect(row1.cost).toBeNull();
    expect(row1.rawCalls).toHaveLength(1);
  });

  test("nextTraceId yields unique 4-part trace ids per (instance, epoch)", () => {
    const ledger = new AttemptLedger();
    expect(ledger.nextTraceId("run", 1, "inst")).toBe("run.1.inst.1");
    expect(ledger.nextTraceId("run", 1, "inst")).toBe("run.1.inst.2");
    expect(ledger.nextTraceId("run", 1, "other")).toBe("run.1.other.1");
    expect(ledger.nextTraceId("run", 2, "inst")).toBe("run.2.inst.1");
  });

  test("onAttempt fires exactly once per recorded row", () => {
    const events: AttemptRecord[] = [];
    const ledger = new AttemptLedger({ onAttempt: (record) => events.push(record) });
    ledger.recordStandalone(standaloneInput(), rawCall(), "out-1");

    const scope = ledger.beginAttempt({
      runId: "run",
      benchmarkId: "fake",
      model: "zhipu/glm-5.3-flash",
      instanceId: "inst",
      epoch: 1,
    });
    scope.finish({ status: "ok" });

    expect(events).toHaveLength(2);
    expect(events[0]!.attempt).toBe(1);
    expect(events[1]!.attempt).toBe(2);
    expect(events[1]!.rawCalls).toHaveLength(0);
  });

  test("scoped attempt accumulates raw calls into one row, closed by finish", () => {
    const ledger = new AttemptLedger();
    const scope = ledger.beginAttempt({
      runId: "run",
      benchmarkId: "fake",
      model: "zhipu/glm-5.3-flash",
      instanceId: "inst",
      epoch: 1,
    });
    scope.recordCall(rawCall({ traceId: "run.1.inst.1" }));
    scope.recordCall(rawCall({ traceId: "run.1.inst.2" }));
    scope.recordCall(rawCall({ traceId: "run.1.inst.3" }));
    scope.finish({
      status: "ok",
      output: "patch-diff",
      usage: USAGE,
      latencyMs: 900,
      providerResponseId: "gen-3",
    });

    const rows = ledger.snapshot();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.attempt).toBe(1);
    expect(row.status).toBe("ok");
    expect(row.output).toBe("patch-diff");
    expect(row.usage).toEqual(USAGE);
    expect(row.latencyMs).toBe(900);
    expect(row.providerResponseId).toBe("gen-3");
    expect(row.traceId).toBe("run.1.inst.1");
    expect(row.rawCalls.map((call) => call.traceId)).toEqual([
      "run.1.inst.1",
      "run.1.inst.2",
      "run.1.inst.3",
    ]);
  });

  test("scoped rows share the per-(instance, epoch) row counter with standalone rows", () => {
    const ledger = new AttemptLedger();
    ledger.recordStandalone(standaloneInput(), rawCall(), "out-1");
    const scope = ledger.beginAttempt({
      runId: "run",
      benchmarkId: "fake",
      model: "zhipu/glm-5.3-flash",
      instanceId: "inst",
      epoch: 1,
    });
    scope.finish({ status: "ok" });

    expect(ledger.snapshot()[1]!.attempt).toBe(2);
  });

  test("snapshot returns an independent copy of every recorded row", () => {
    const ledger = new AttemptLedger();
    ledger.recordStandalone(standaloneInput(), rawCall(), "out-1");
    const snapshot = [...ledger.snapshot()];
    snapshot.pop();
    expect(ledger.snapshot()).toHaveLength(1);
  });
});
