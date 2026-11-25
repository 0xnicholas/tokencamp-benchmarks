import { describe, expect, test } from "bun:test";
import { AbortRunError, TransportFailedError } from "./errors";
import { runBenchmark } from "./runner";
import type {
  Benchmark,
  BenchmarkMeta,
  GenerateCall,
  GenerateResult,
  GenerationResolver,
} from "./types";

function makeFakeResolver(
  options: {
    failFor?: (call: GenerateCall) => "transport" | "abort" | null;
    latencyFor?: (call: GenerateCall) => number;
  } = {},
): { resolver: GenerationResolver; calls: GenerateCall[]; maxInFlight: () => number } {
  const calls: GenerateCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const resolver: GenerationResolver = {
    providerFor: (_modelId: string) => "stub",
    generate: async (call: GenerateCall): Promise<GenerateResult> => {
      calls.push(call);
      const callIndex = calls.length;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, options.latencyFor?.(call) ?? 5));
        const fail = options.failFor?.(call) ?? null;
        if (fail === "transport") {
          throw new TransportFailedError("transport exhausted", call.instanceId, call.epoch);
        }
        if (fail === "abort") {
          throw new AbortRunError("systemic provider error", call.instanceId, call.epoch);
        }
        return {
          content: `content for ${call.instanceId} epoch ${call.epoch}`,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            reasoningTokens: 0,
          },
          finishReason: "stop",
          latencyMs: 42,
          providerResponseId: `stub-${callIndex}`,
          traceId: `${call.runId}.${call.epoch}.${call.instanceId}.1`,
          taskId: null,
          costAttribution: null,
        };
      } finally {
        inFlight--;
      }
    },
  };
  return { resolver, calls, maxInFlight: () => maxInFlight };
}

function makeBarrierResolver(
  releaseAt: number,
  latencyMs = 5,
): { resolver: GenerationResolver; calls: GenerateCall[]; maxInFlight: () => number } {
  const calls: GenerateCall[] = [];
  const waiters: Array<() => void> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const resolver: GenerationResolver = {
    providerFor: () => "stub",
    generate: async (call: GenerateCall): Promise<GenerateResult> => {
      calls.push(call);
      const callIndex = calls.length;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (inFlight < releaseAt) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 150);
            waiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
        while (waiters.length > 0) {
          waiters.shift()!();
        }
        await new Promise((resolve) => setTimeout(resolve, latencyMs));
        return {
          content: `content for ${call.instanceId} epoch ${call.epoch}`,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheWriteInputTokens: 0,
            reasoningTokens: 0,
          },
          finishReason: "stop",
          latencyMs: 42,
          providerResponseId: `stub-${callIndex}`,
          traceId: `${call.runId}.${call.epoch}.${call.instanceId}.1`,
          taskId: null,
          costAttribution: null,
        };
      } finally {
        inFlight--;
      }
    },
  };
  return { resolver, calls, maxInFlight: () => maxInFlight };
}

function makeFakeBenchmark(
  overrides: {
    meta?: Partial<BenchmarkMeta>;
    instances?: string[];
    runInstance?: Benchmark["runInstance"];
  } = {},
): Benchmark {
  const ids = overrides.instances ?? ["one", "two"];
  return {
    meta: {
      id: "fake",
      layer: "task",
      defaultEpochs: 1,
      temperature: 0,
      ...overrides.meta,
    },
    loadInstances: async () => ids.map((id) => ({ id })),
    runInstance:
      overrides.runInstance ??
      (async (instance, ctx) => {
        const result = await ctx.resolver.generate({
          runId: ctx.runId,
          benchmarkId: "fake",
          instanceId: instance.id,
          epoch: ctx.epoch,
          model: ctx.model,
          temperature: ctx.temperature,
          messages: [{ role: "user", content: `prompt for ${instance.id}` }],
          signal: ctx.signal,
        });
        return {
          status: "ok",
          content: result.content,
          usage: result.usage,
          latencyMs: result.latencyMs,
          providerResponseId: result.providerResponseId,
        };
      }),
  };
}

describe("runBenchmark", () => {
  test("runs every instance × epoch and records outcome rows", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark();

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "zhipu/glm-5.3",
      runId: "run-1",
      epochs: 2,
    });

    expect(result.status).toBe("completed");
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((row) => [row.instanceId, row.epoch] as const).sort()).toEqual([
      ["one", 1],
      ["one", 2],
      ["two", 1],
      ["two", 2],
    ]);

    const row = result.rows.find((r) => r.instanceId === "one" && r.epoch === 1);
    expect(row).toMatchObject({
      runId: "run-1",
      benchmarkId: "fake",
      layer: "task",
      model: "zhipu/glm-5.3",
      status: "ok",
      content: "content for one epoch 1",
      usage: { inputTokens: 10, outputTokens: 5 },
      latencyMs: 42,
      providerResponseId: "stub-1",
    });

    const call = fake.calls.find((c) => c.instanceId === "one" && c.epoch === 1);
    expect(call).toMatchObject({
      runId: "run-1",
      benchmarkId: "fake",
      instanceId: "one",
      epoch: 1,
      model: "zhipu/glm-5.3",
      temperature: 0,
      messages: [{ role: "user", content: "prompt for one" }],
    });
  });

  test("slices instances with 0-based inclusive start and exclusive end", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({ instances: ["a", "b", "c", "d", "e"] });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      start: 1,
      end: 3,
    });

    expect(result.rows.map((row) => row.instanceId)).toEqual(["b", "c"]);
  });

  test("--limit caps the instance count after slicing", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({ instances: ["a", "b", "c", "d", "e"] });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      limit: 2,
    });

    expect(result.rows.map((row) => row.instanceId)).toEqual(["a", "b"]);
  });

  test("combines slicing and limit, clamping out-of-range ends", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({ instances: ["a", "b", "c", "d", "e"] });

    const clipped = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      start: 3,
      end: 99,
      limit: 10,
    });
    expect(clipped.rows.map((row) => row.instanceId)).toEqual(["d", "e"]);

    const empty = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      start: 1,
      end: 1,
    });
    expect(empty.rows).toHaveLength(0);
    expect(empty.status).toBe("completed");
  });

  test("never exceeds the global concurrency cap", async () => {
    // Barrier resolver: each call waits until `releaseAt` calls are in flight
    // (fail-safe timeout keeps a broken/sequential runner from hanging the test),
    // so maxInFlight === 2 proves both parallel dispatch and the cap.
    const fake = makeBarrierResolver(2);
    const benchmark = makeFakeBenchmark({ instances: ["a", "b", "c", "d", "e", "f"] });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      concurrency: 2,
    });

    expect(result.rows).toHaveLength(6);
    expect(result.status).toBe("completed");
    expect(fake.maxInFlight()).toBe(2);
  });

  test("per-provider caps tighten the global cap", async () => {
    // Global cap 4 would let the releaseAt=2 barrier fire; the provider cap of 1
    // must prevent that, so maxInFlight stays at 1.
    const fake = makeBarrierResolver(2);
    const benchmark = makeFakeBenchmark({ instances: ["a", "b", "c"] });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      concurrency: 4,
      adapterConfig: { providerCaps: { stub: 1 } },
    });

    expect(result.rows).toHaveLength(3);
    expect(fake.maxInFlight()).toBe(1);
  });

  test("records transport-failed rows and keeps the run going", async () => {
    const fake = makeFakeResolver({
      failFor: (call) => (call.instanceId === "two" ? "transport" : null),
    });
    const benchmark = makeFakeBenchmark();

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      epochs: 2,
    });

    expect(result.status).toBe("completed");
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows.filter((r) => r.instanceId === "two")) {
      expect(row.status).toBe("transport-failed");
      expect(row.content).toBeNull();
      expect(row.usage).toBeNull();
      expect(row.latencyMs).toBeNull();
      expect(row.providerResponseId).toBeNull();
    }
    for (const row of result.rows.filter((r) => r.instanceId === "one")) {
      expect(row.status).toBe("ok");
    }
  });

  test("systemic abort stops scheduling and reports an aborted run", async () => {
    const fake = makeFakeResolver({
      failFor: (call) => (call.instanceId === "b" ? "abort" : null),
    });
    const benchmark = makeFakeBenchmark({ instances: ["a", "b", "c", "d"] });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      concurrency: 1,
    });

    expect(result.status).toBe("aborted");
    expect(result.rows.map((row) => row.instanceId)).toEqual(["a"]);
    expect(fake.calls.map((call) => call.instanceId)).toEqual(["a", "b"]);
  });

  test("abort keeps in-flight outcomes but skips unscheduled units", async () => {
    // b aborts at ~5ms while a is still in flight (10ms): a's outcome is kept,
    // c and d are never dispatched.
    const fake = makeFakeResolver({
      failFor: (call) => (call.instanceId === "b" ? "abort" : null),
      latencyFor: (call) => (call.instanceId === "a" ? 10 : 5),
    });
    const benchmark = makeFakeBenchmark({ instances: ["a", "b", "c", "d"] });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      concurrency: 2,
    });

    expect(result.status).toBe("aborted");
    expect(result.rows.map((row) => row.instanceId)).toEqual(["a"]);
    expect(fake.calls.map((call) => call.instanceId).sort()).toEqual(["a", "b"]);
    const inFlightCall = fake.calls.find((call) => call.instanceId === "a");
    expect(inFlightCall?.signal.aborted).toBe(true);
  });

  test("records the full config snapshot on the run result", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({ meta: { temperature: 0.5 } });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "zhipu/glm-5.3",
      runId: "run-1",
      epochs: 2,
      concurrency: 3,
      start: 1,
      end: 4,
      limit: 2,
      gitSha: "abc123",
      artifactDir: "artifacts",
      resumeId: "res-1",
    });

    expect(result.configSnapshot).toEqual({
      benchmarkId: "fake",
      layer: "task",
      model: "zhipu/glm-5.3",
      temperature: 0.5,
      gitSha: "abc123",
      params: {
        epochs: 2,
        concurrency: 3,
        start: 1,
        end: 4,
        limit: 2,
        artifactDir: "artifacts",
        resumeId: "res-1",
      },
      priceTableRef: null,
      taskConfiguration: null,
    });
  });

  test("config snapshot falls back to run defaults", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({ meta: { defaultEpochs: 3 } });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
    });

    expect(result.configSnapshot).toMatchObject({
      gitSha: null,
      params: {
        epochs: 3,
        concurrency: 8,
        start: null,
        end: null,
        limit: null,
        artifactDir: null,
        resumeId: null,
      },
    });
  });

  test("onOutcome observes every outcome row in completion order", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({ instances: ["a", "b"] });
    const observed: Array<[string, number]> = [];

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      concurrency: 1,
      onOutcome: (row) => observed.push([row.instanceId, row.epoch]),
    });

    expect(observed).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(result.rows.map((row) => [row.instanceId, row.epoch])).toEqual(observed);
  });

  test("unexpected benchmark errors reject the run and stop scheduling", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({
      instances: ["a", "b", "c"],
      runInstance: async (instance, ctx) => {
        if (instance.id === "a") {
          // Bug lands before b finishes (~5ms) and long before c would dispatch.
          await new Promise((resolve) => setTimeout(resolve, 1));
          throw new TypeError("benchmark bug");
        }
        await ctx.resolver.generate({
          runId: ctx.runId,
          benchmarkId: "fake",
          instanceId: instance.id,
          epoch: ctx.epoch,
          model: ctx.model,
          temperature: ctx.temperature,
          messages: [],
          signal: ctx.signal,
        });
        return {
          status: "ok",
          content: "",
          usage: null,
          latencyMs: null,
          providerResponseId: null,
        };
      },
    });

    const run = runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "m",
      runId: "run-1",
      concurrency: 2,
    });
    expect(run).rejects.toThrow(TypeError);
    await run.catch(() => {});

    // b was in flight when a's bug landed; c is never dispatched (a itself
    // never reaches generate).
    expect(fake.calls.map((call) => call.instanceId)).toEqual(["b"]);
  });

  test("defaults epochs to the benchmark's defaultEpochs", async () => {
    const fake = makeFakeResolver();
    const benchmark = makeFakeBenchmark({ meta: { defaultEpochs: 3 } });

    const result = await runBenchmark({
      benchmark,
      resolver: fake.resolver,
      model: "zhipu/glm-5.3",
      runId: "run-1",
    });

    expect(result.rows).toHaveLength(6);
    expect(result.rows.filter((row) => row.instanceId === "one")).toHaveLength(3);
  });
});
