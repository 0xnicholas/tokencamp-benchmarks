import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { attemptScopeKey } from "./attempts";
import { enrichAttemptRow } from "./cost";
import type { PriceTable } from "./prices";
import { assembleSummary } from "./summary";
import type {
  ArtifactAttemptRow,
  AttemptRecord,
  AttemptVerification,
  ConfigSnapshot,
  HarnessOverhead,
} from "./types";

/** Artifact-state problems that must stop the run or refuse a resume. */
export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactError";
  }
}

export interface ArtifactStoreConfig {
  readonly configSnapshot: ConfigSnapshot;
  /** tokencamp version pin (ADR-0004) — source verified on the first integration run. */
  readonly tokencampVersion: string | null;
  /** sha256 over the pinned price-table bytes: the run's catalog snapshot (ADR-0004). */
  readonly catalogSnapshotSha256: string;
}

export interface RunArtifactStoreOptions {
  readonly artifactDir: string;
  readonly runId: string;
  readonly config: ArtifactStoreConfig;
  readonly priceTable: PriceTable;
  /** Instance id → difficulty tier from the frozen dataset (ADR-0003). */
  readonly instanceTiers?: ReadonlyMap<string, string>;
  readonly overhead?: HarnessOverhead;
}

const MANIFEST_FORMAT_VERSION = 1;

/**
 * Canonical JSON (recursively sorted keys) — the stable serialization the
 * configHash is computed over, so identical configs hash identically across
 * processes and platforms.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * The configHash (ADR-0002): sha256 over everything that defines what is being
 * run — benchmark, model, temperature, params (minus artifactDir/resumeId,
 * which are artifact identity, not config), the price-table pin, git sha,
 * tokencamp version, and the catalog snapshot hash.
 *
 * Deliberately excludes runId and wall-clock date (they live unhashed in the
 * manifest): including them would make any later-day resume refuse on
 * mismatch, contradicting the resume discipline this ticket implements.
 */
export function computeConfigHash(config: ArtifactStoreConfig): string {
  const { configSnapshot } = config;
  const hashed = {
    benchmarkId: configSnapshot.benchmarkId,
    layer: configSnapshot.layer,
    model: configSnapshot.model,
    temperature: configSnapshot.temperature,
    gitSha: configSnapshot.gitSha,
    params: {
      epochs: configSnapshot.params.epochs,
      concurrency: configSnapshot.params.concurrency,
      start: configSnapshot.params.start,
      end: configSnapshot.params.end,
      limit: configSnapshot.params.limit,
    },
    priceTableRef: configSnapshot.priceTableRef,
    taskConfiguration: configSnapshot.taskConfiguration,
    tokencampVersion: config.tokencampVersion,
    catalogSnapshotSha256: config.catalogSnapshotSha256,
  };
  return createHash("sha256").update(canonicalJson(hashed)).digest("hex");
}

interface StoredManifest {
  readonly format_version: number;
  readonly runId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resumedAt?: readonly string[];
  readonly configHash: string;
  readonly configSnapshot: ConfigSnapshot;
  readonly tokencampVersion: string | null;
  readonly catalogSnapshotSha256: string;
}

interface StoredVerification {
  readonly instanceId: string;
  readonly epoch: number;
  readonly attempt: number;
  readonly verification: AttemptVerification;
}

function readJsonlLines(content: string, file: string): unknown[] {
  const rows: unknown[] = [];
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") {
      continue;
    }
    try {
      rows.push(JSON.parse(line));
    } catch {
      throw new ArtifactError(
        `${file} line ${index + 1} is malformed (a truncated final line means the last append was interrupted) — refusing rather than silently dropping data`,
      );
    }
  }
  return rows;
}

/**
 * The run artifact directory (ADR-0002): `<artifact-dir>/<runId>/` holding
 * `manifest.json` (pinned config + configHash), `results.jsonl` (append-only
 * attempt rows, cost-enriched by the cost module), and `summary.json`
 * (rewritten at run end and on resume).
 *
 * Resume reopens the same directory, refuses on configHash mismatch, replays
 * stored rows (verifications joined back on), and exposes the completed
 * (instanceId, epoch) pairs so the runner skips them.
 */
export class RunArtifactStore {
  readonly #options: RunArtifactStoreOptions;
  readonly #runDir: string;
  readonly #rows: ArtifactAttemptRow[] = [];
  readonly #completed = new Set<string>();
  readonly #overhead: HarnessOverhead;
  configHash: string = "";

  private constructor(options: RunArtifactStoreOptions, runDir: string, overhead: HarnessOverhead) {
    this.#options = options;
    this.#runDir = runDir;
    this.#overhead = overhead;
  }

  /** Creates (fresh) or reopens (resume) the run directory. Throws ArtifactError on refusal. */
  static async init(options: RunArtifactStoreOptions): Promise<RunArtifactStore> {
    const runDir = path.join(options.artifactDir, options.runId);
    await mkdir(runDir, { recursive: true });
    const overhead: HarnessOverhead = options.overhead ?? {
      verifierExecutionUsd: 0,
      sandboxStartupUsd: 0,
    };
    const store = new RunArtifactStore(options, runDir, overhead);
    store.configHash = computeConfigHash(options.config);

    const manifestPath = path.join(runDir, "manifest.json");
    const resultsPath = path.join(runDir, "results.jsonl");
    const manifestExists = await Bun.file(manifestPath).exists();
    const resultsExists = await Bun.file(resultsPath).exists();

    if (!manifestExists) {
      if (resultsExists) {
        throw new ArtifactError(
          `${resultsPath} exists without a manifest.json — corrupt run directory, refusing to touch it`,
        );
      }
      await store.#writeManifest({ createdAt: new Date().toISOString(), resumedAt: [] });
      return store;
    }

    // Resume: refuse on configHash mismatch — the price table and config were
    // pinned at run start and must not drift mid-run (ADR-0002/0006).
    const stored = JSON.parse(await readFile(manifestPath, "utf8")) as StoredManifest;
    if (stored.format_version !== MANIFEST_FORMAT_VERSION) {
      throw new ArtifactError(
        `manifest format_version ${stored.format_version} is not supported (expected ${MANIFEST_FORMAT_VERSION})`,
      );
    }
    if (stored.configHash !== store.configHash) {
      throw new ArtifactError(
        `resume refused: configHash mismatch — the config (or its price-table pin) changed since run ${options.runId} started (ADR-0002/0006)`,
      );
    }
    if (resultsExists) {
      store.#loadResults(await readFile(resultsPath, "utf8"));
    }
    const verificationsPath = path.join(runDir, "verifications.jsonl");
    if (await Bun.file(verificationsPath).exists()) {
      store.#loadVerifications(await readFile(verificationsPath, "utf8"));
    }
    const resumedAt = [...(stored.resumedAt ?? []), new Date().toISOString()];
    await store.#writeManifest({ createdAt: stored.createdAt, resumedAt });
    return store;
  }

  get runDir(): string {
    return this.#runDir;
  }

  rows(): readonly ArtifactAttemptRow[] {
    return [...this.#rows];
  }

  /** (instanceId, epoch) pairs that already have attempt rows — resume skips these. */
  completedUnits(): ReadonlySet<string> {
    return new Set(this.#completed);
  }

  /**
   * Cost-enriches the resolver's attempt row (#13), appends it to
   * results.jsonl (append-only — a crash keeps every completed attempt), and
   * keeps it in memory for aggregation.
   */
  appendAttempt(record: AttemptRecord): ArtifactAttemptRow {
    const row = enrichAttemptRow(record, {
      priceTable: this.#options.priceTable,
      instanceTiers: this.#options.instanceTiers,
    });
    this.#rows.push(row);
    this.#completed.add(attemptScopeKey(row.instanceId, row.epoch));
    appendFileSync(path.join(this.#runDir, "results.jsonl"), `${JSON.stringify(row)}\n`);
    return row;
  }

  /**
   * Joins the Evaluation Engine's verdict onto an attempt row (ADR-0005).
   * Verification runs after the row is recorded, so verdicts live in their own
   * append-only stream (verifications.jsonl) and are joined by
   * (instanceId, epoch, attempt) — the row schema's `verification` field is
   * satisfied at read time, on disk and in memory.
   */
  appendVerification(
    ref: { readonly instanceId: string; readonly epoch: number; readonly attempt: number },
    verification: AttemptVerification,
  ): void {
    this.#applyVerification(ref, verification);
    appendFileSync(
      path.join(this.#runDir, "verifications.jsonl"),
      `${JSON.stringify({ ...ref, verification })}\n`,
    );
  }

  /**
   * Applies a verdict in memory only. Appending is the caller's business:
   * resume replays the evidence stream as a *read*, so replaying must not
   * re-append lines (that duplicated every verdict once per resume).
   */
  #applyVerification(
    ref: { readonly instanceId: string; readonly epoch: number; readonly attempt: number },
    verification: AttemptVerification,
  ): void {
    const index = this.#rows.findIndex(
      (row) =>
        row.instanceId === ref.instanceId && row.epoch === ref.epoch && row.attempt === ref.attempt,
    );
    if (index < 0) {
      throw new ArtifactError(
        `no attempt row for instance ${ref.instanceId} epoch ${ref.epoch} attempt ${ref.attempt} — verdicts join onto recorded rows`,
      );
    }
    const current = this.#rows[index]!;
    this.#rows[index] = { ...current, verification };
  }

  /** Rewrites summary.json from the current rows (run end and resume, ADR-0002). */
  async writeSummary(): Promise<void> {
    const summary = assembleSummary({
      runId: this.#options.runId,
      configHash: this.configHash,
      rows: this.rows(),
      overhead: this.#overhead,
      generatedAt: new Date().toISOString(),
    });
    await writeFile(
      path.join(this.#runDir, "summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }

  async #writeManifest(times: { createdAt: string; resumedAt: readonly string[] }): Promise<void> {
    const { config } = this.#options;
    const manifest: StoredManifest = {
      format_version: MANIFEST_FORMAT_VERSION,
      runId: this.#options.runId,
      createdAt: times.createdAt,
      updatedAt: new Date().toISOString(),
      resumedAt: times.resumedAt,
      configHash: this.configHash,
      configSnapshot: config.configSnapshot,
      tokencampVersion: config.tokencampVersion,
      catalogSnapshotSha256: config.catalogSnapshotSha256,
    };
    await writeFile(
      path.join(this.#runDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  #loadResults(content: string): void {
    for (const raw of readJsonlLines(content, "results.jsonl")) {
      const row = raw as ArtifactAttemptRow;
      if (
        typeof row.instanceId !== "string" ||
        typeof row.epoch !== "number" ||
        typeof row.attempt !== "number" ||
        row.cost === undefined
      ) {
        throw new ArtifactError("results.jsonl holds a line that is not an attempt row");
      }
      this.#rows.push(row);
      this.#completed.add(attemptScopeKey(row.instanceId, row.epoch));
    }
  }

  #loadVerifications(content: string): void {
    for (const raw of readJsonlLines(content, "verifications.jsonl")) {
      const stored = raw as StoredVerification;
      if (
        typeof stored.instanceId !== "string" ||
        typeof stored.epoch !== "number" ||
        typeof stored.attempt !== "number" ||
        stored.verification === undefined
      ) {
        throw new ArtifactError(
          "verifications.jsonl holds a line that is not a verification record",
        );
      }
      this.#applyVerification(stored, stored.verification);
    }
  }
}

/** Anything that consumes streamed attempt spend — the run's spend guard (ADR-0006). */
export interface SpendRecorder {
  record(spendUsd: number): void;
}

export interface AttemptStreamOptions {
  /** null = the run writes no artifacts (`--artifact-dir` omitted). */
  readonly store: RunArtifactStore | null;
  readonly priceTable: PriceTable;
  readonly budget?: SpendRecorder | null;
  readonly instanceTiers?: ReadonlyMap<string, string>;
}

/**
 * The attempt-stream chain the CLI wires into the ledger: cost-enrich the
 * resolver's record, append it to the run artifacts when a store exists, and
 * feed the spend guard the same headline cost either way.
 *
 * The guard must not depend on artifact writing: `--max-spend-usd` without
 * `--artifact-dir` still has to refuse at the cap (ADR-0006) — otherwise the
 * flag silently does nothing on a run that writes no results.
 */
export function recordAttempt(
  options: AttemptStreamOptions,
  record: AttemptRecord,
): ArtifactAttemptRow {
  const row =
    options.store !== null
      ? options.store.appendAttempt(record)
      : enrichAttemptRow(record, {
          priceTable: options.priceTable,
          instanceTiers: options.instanceTiers,
        });
  options.budget?.record(row.cost.headlineUsd);
  return row;
}
