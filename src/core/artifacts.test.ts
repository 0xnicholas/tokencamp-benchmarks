import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RunArtifactStore, computeConfigHash } from "./artifacts";
import type { RunArtifactStoreOptions } from "./artifacts";
import { loadPriceTable } from "./prices";
import { attemptScopeKey } from "./attempts";
import type { ArtifactAttemptRow, AttemptRawCall, AttemptRecord, Usage } from "./types";

const M3 = "minimax/minimax-m3";

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
    usage: usage({ inputTokens: 100_000, outputTokens: 1_000 }),
    latencyMs: 42,
    cfRay: null,
    xRequestId: null,
    settledGeneration: { cost_usd: 0.032 },
    error: null,
    ...overrides,
  };
}

function attemptRow(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    runId: "run-1",
    benchmarkId: "task/codegen",
    model: M3,
    instanceId: overrides.instanceId ?? "inst",
    epoch: overrides.epoch ?? 1,
    attempt: 1,
    status: "ok",
    output: "print(1)",
    usage: usage({ inputTokens: 100_000, outputTokens: 1_000 }),
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

const priceTable = (await loadPriceTable("prices/prices.json")).table;

function storeConfig(overrides: Partial<Parameters<typeof computeConfigHash>[0]> = {}) {
  return {
    configSnapshot: {
      benchmarkId: "task/codegen",
      layer: "task" as const,
      model: M3,
      temperature: 0,
      gitSha: "abc123",
      params: {
        epochs: 3,
        concurrency: 8,
        start: 0,
        end: 50,
        limit: null,
        artifactDir: "/tmp/artifacts",
        resumeId: null,
      },
      priceTableRef: "prices/prices.json@sha256:" + "a".repeat(64),
      taskConfiguration: null,
    },
    tokencampVersion: "2026-11-24",
    catalogSnapshotSha256: "a".repeat(64),
    ...overrides,
  };
}

async function makeStore(
  overrides: Partial<Omit<RunArtifactStoreOptions, "config" | "priceTable">> = {},
): Promise<{ store: RunArtifactStore; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "artifacts-"));
  const store = await RunArtifactStore.init({
    artifactDir: dir,
    runId: "run-1",
    config: storeConfig(),
    priceTable,
    ...overrides,
  });
  return { store, dir };
}

describe("RunArtifactStore.init — fresh run", () => {
  test("creates <artifact-dir>/<runId>/ and writes the manifest", async () => {
    const { store, dir } = await makeStore();
    const manifest = JSON.parse(await readFile(path.join(dir, "run-1", "manifest.json"), "utf8"));
    expect(manifest.format_version).toBe(1);
    expect(manifest.runId).toBe("run-1");
    expect(manifest.createdAt).toBeTypeOf("string");
    expect(manifest.configHash).toMatch(/^[0-9a-f]{64}$/);
    // full snapshot, price-table ref, params, git sha, tokencamp version, catalog snapshot hash
    expect(manifest.configSnapshot.model).toBe(M3);
    expect(manifest.configSnapshot.priceTableRef).toStartWith("prices/prices.json@sha256:");
    expect(manifest.configSnapshot.params.limit).toBeNull();
    expect(manifest.configSnapshot.gitSha).toBe("abc123");
    expect(manifest.tokencampVersion).toBe("2026-11-24");
    expect(manifest.catalogSnapshotSha256).toBe("a".repeat(64));
    expect(store.configHash).toBe(manifest.configHash);
    await rm(dir, { recursive: true, force: true });
  });

  test("manifest.json is the only file until attempts append", async () => {
    const { dir } = await makeStore();
    const files = await readdir(path.join(dir, "run-1"));
    expect(files.sort()).toEqual(["manifest.json"]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("RunArtifactStore.appendAttempt", () => {
  test("appends enriched JSONL lines and keeps rows in memory", async () => {
    const { store, dir } = await makeStore();
    const row1 = store.appendAttempt(attemptRow());
    store.appendAttempt(attemptRow({ instanceId: "inst-b", epoch: 2, attempt: 1 }));

    expect(row1.cost.headlineUsd).toBeGreaterThan(0);
    expect(store.rows()).toHaveLength(2);

    const lines = (await readFile(path.join(dir, "run-1", "results.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]!) as ArtifactAttemptRow;
    expect(parsed.instanceId).toBe("inst");
    expect(parsed.cost.settle).toBe("settled");
    expect(parsed.verification).toBeNull();
    // append-only: the first line is untouched by the second append
    expect(JSON.parse(lines[1]!).instanceId).toBe("inst-b");
    await rm(dir, { recursive: true, force: true });
  });

  test("completed units are exactly the (instanceId, epoch) pairs that have rows", async () => {
    const { store } = await makeStore();
    store.appendAttempt(attemptRow({ instanceId: "inst", epoch: 1 }));
    store.appendAttempt(attemptRow({ instanceId: "inst", epoch: 2 }));
    store.appendAttempt(attemptRow({ instanceId: "inst-b", epoch: 1 }));
    expect([...store.completedUnits()].sort()).toEqual(
      [attemptScopeKey("inst", 1), attemptScopeKey("inst", 2), attemptScopeKey("inst-b", 1)].sort(),
    );
  });

  test("difficultyTier comes from the instanceTiers map", async () => {
    const { store } = await makeStore({ instanceTiers: new Map([["inst", "medium"]]) });
    const row = store.appendAttempt(attemptRow());
    expect(row.difficultyTier).toBe("medium");
  });
});

describe("RunArtifactStore.appendVerification", () => {
  test("joins the verifier's verdict onto the attempt row and appends the evidence line", async () => {
    const { store, dir } = await makeStore();
    store.appendAttempt(attemptRow());
    const verification = { verifier: "mbpp_unit_tests", gate: true, score: 1, detail: {} };
    store.appendVerification({ instanceId: "inst", epoch: 1, attempt: 1 }, verification);
    expect(store.rows()[0]!.verification).toEqual(verification);

    const lines = (await readFile(path.join(dir, "run-1", "verifications.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(JSON.parse(lines[0]!)).toEqual({
      instanceId: "inst",
      epoch: 1,
      attempt: 1,
      verification,
    });
    await rm(dir, { recursive: true, force: true });
  });

  test("refuses a verification for an attempt that has no row", async () => {
    const { store } = await makeStore();
    expect(() =>
      store.appendVerification(
        { instanceId: "ghost", epoch: 1, attempt: 1 },
        { verifier: "x", gate: false, score: 0, detail: {} },
      ),
    ).toThrow(/no attempt row/);
  });
});

describe("RunArtifactStore.init — resume", () => {
  test("same config reopens the directory: rows load back, completed units are known", async () => {
    const { store: first, dir } = await makeStore();
    first.appendAttempt(attemptRow({ instanceId: "inst", epoch: 1 }));
    first.appendAttempt(attemptRow({ instanceId: "inst", epoch: 2 }));

    const resumed = await RunArtifactStore.init({
      artifactDir: dir,
      runId: "run-1",
      config: storeConfig(),
      priceTable,
    });
    expect(resumed.rows()).toHaveLength(2);
    expect(resumed.completedUnits().has(attemptScopeKey("inst", 1))).toBe(true);
    expect(resumed.completedUnits().has(attemptScopeKey("inst", 3))).toBe(false);
    // results.jsonl is append-only across the resume
    resumed.appendAttempt(attemptRow({ instanceId: "inst", epoch: 3 }));
    expect(resumed.rows()).toHaveLength(3);
    await rm(dir, { recursive: true, force: true });
  });

  test("resume joins previously appended verification lines onto loaded rows", async () => {
    const { store: first, dir } = await makeStore();
    first.appendAttempt(attemptRow({ instanceId: "inst", epoch: 1 }));
    first.appendVerification(
      { instanceId: "inst", epoch: 1, attempt: 1 },
      {
        verifier: "mbpp_unit_tests",
        gate: true,
        score: 1,
        detail: {},
      },
    );

    const resumed = await RunArtifactStore.init({
      artifactDir: dir,
      runId: "run-1",
      config: storeConfig(),
      priceTable,
    });
    expect(resumed.rows()[0]!.verification?.gate).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("a changed config refuses to resume — configHash mismatch (ADR-0002/0006)", async () => {
    const { store: first, dir } = await makeStore();
    first.appendAttempt(attemptRow());

    const changed = storeConfig({
      configSnapshot: {
        benchmarkId: "task/codegen",
        layer: "task",
        model: M3,
        temperature: 0,
        gitSha: "abc123",
        params: {
          epochs: 3,
          concurrency: 8,
          start: 0,
          end: 50,
          limit: null,
          artifactDir: "/tmp/artifacts",
          resumeId: null,
        },
        priceTableRef: "prices/prices.json@sha256:" + "a".repeat(64),
        taskConfiguration: null,
      },
      tokencampVersion: "2026-11-24",
      catalogSnapshotSha256: "b".repeat(64), // re-pinned price table
    });
    expect(
      RunArtifactStore.init({ artifactDir: dir, runId: "run-1", config: changed, priceTable }),
    ).rejects.toThrow(/configHash/);
    await rm(dir, { recursive: true, force: true });
  });

  test("results.jsonl without a manifest is corrupt state — refuse", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "artifacts-"));
    await Bun.write(path.join(dir, "run-1", "results.jsonl"), '{"hello":true}\n');
    expect(
      RunArtifactStore.init({
        artifactDir: dir,
        runId: "run-1",
        config: storeConfig(),
        priceTable,
      }),
    ).rejects.toThrow(/manifest/);
    await rm(dir, { recursive: true, force: true });
  });

  test("a truncated final line refuses to resume rather than silently dropping data", async () => {
    const { store: first, dir } = await makeStore();
    first.appendAttempt(attemptRow());
    const resultsPath = path.join(dir, "run-1", "results.jsonl");
    await Bun.write(resultsPath, (await readFile(resultsPath, "utf8")).slice(0, -10));

    expect(
      RunArtifactStore.init({
        artifactDir: dir,
        runId: "run-1",
        config: storeConfig(),
        priceTable,
      }),
    ).rejects.toThrow(/truncated|malformed/i);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("RunArtifactStore.writeSummary", () => {
  test("writes summary.json and rewrites it on every call (run end and resume)", async () => {
    const { store, dir } = await makeStore();
    store.appendAttempt(attemptRow({ instanceId: "inst", epoch: 1 }));
    await store.writeSummary();
    const summaryPath = path.join(dir, "run-1", "summary.json");
    const first = JSON.parse(await readFile(summaryPath, "utf8"));
    expect(first.runId).toBe("run-1");
    expect(first.configHash).toBe(store.configHash);

    store.appendAttempt(attemptRow({ instanceId: "inst", epoch: 2 }));
    await store.writeSummary();
    const second = JSON.parse(await readFile(summaryPath, "utf8"));
    expect(second.coverage.attempts).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("computeConfigHash", () => {
  test("stable across calls and sensitive to what defines the run", () => {
    const a = computeConfigHash(storeConfig());
    const b = computeConfigHash(storeConfig());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);

    const differentModel = computeConfigHash(
      storeConfig({
        configSnapshot: {
          benchmarkId: "task/codegen",
          layer: "task",
          model: "zhipu/glm-5.3-flash",
          temperature: 0,
          gitSha: "abc123",
          params: {
            epochs: 3,
            concurrency: 8,
            start: 0,
            end: 50,
            limit: null,
            artifactDir: "/tmp/artifacts",
            resumeId: null,
          },
          priceTableRef: "prices/prices.json@sha256:" + "a".repeat(64),
          taskConfiguration: null,
        },
      }),
    );
    expect(differentModel).not.toBe(a);
  });

  test("artifactDir/resumeId are artifact identity, not config — swapping them keeps the hash", () => {
    const base = storeConfig();
    const moved = storeConfig({
      configSnapshot: {
        ...base.configSnapshot,
        params: { ...base.configSnapshot.params, artifactDir: "/elsewhere", resumeId: "run-1" },
      },
    });
    expect(computeConfigHash(moved)).toBe(computeConfigHash(base));
  });
});
