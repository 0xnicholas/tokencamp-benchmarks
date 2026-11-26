import { AbortRunError, TransportFailedError } from "./errors";
import { attemptScopeKey } from "./attempts";
import type {
  Benchmark,
  ConfigSnapshot,
  GenerationResolver,
  InstanceContext,
  InstanceOutcome,
  OutcomeRow,
  SpendGuard,
} from "./types";

export interface AdapterConfig {
  readonly providerCaps?: Readonly<Record<string, number>>;
}

export interface RunnerInput {
  readonly benchmark: Benchmark;
  readonly resolver: GenerationResolver;
  readonly model: string;
  readonly runId: string;
  readonly epochs?: number;
  readonly concurrency?: number;
  readonly start?: number;
  readonly end?: number;
  readonly limit?: number;
  readonly gitSha?: string | null;
  readonly artifactDir?: string | null;
  readonly resumeId?: string | null;
  readonly priceTableRef?: string | null;
  /** Resume: (instanceId, epoch) pairs that already have attempt rows — skipped, never re-run. */
  readonly completedUnits?: ReadonlySet<string>;
  /** Refuses new attempts once actual spend reaches the cap (ADR-0006). */
  readonly budget?: SpendGuard;
  readonly adapterConfig?: AdapterConfig;
  readonly onOutcome?: (row: OutcomeRow) => void;
}

export interface RunResult {
  readonly runId: string;
  readonly configSnapshot: ConfigSnapshot;
  readonly rows: readonly OutcomeRow[];
  readonly status: "completed" | "aborted" | "budget-reached";
  /** Units skipped on resume because their (instance, epoch) already has rows. */
  readonly skippedCompleted: number;
  /** Units refused because the spend guard tripped before they could start. */
  readonly budgetRefused: number;
}

class Semaphore {
  #active = 0;
  readonly #waiters: Array<() => void> = [];
  readonly #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  acquire(): Promise<() => void> {
    if (this.#active < this.#limit) {
      this.#active++;
      return Promise.resolve(() => this.release());
    }
    return new Promise((resolve) => {
      this.#waiters.push(() => {
        this.#active++;
        resolve(() => this.release());
      });
    });
  }

  release(): void {
    this.#active--;
    const next = this.#waiters.shift();
    if (next) {
      next();
    }
  }
}

export async function runBenchmark(input: RunnerInput): Promise<RunResult> {
  const { benchmark, resolver, model, runId } = input;
  const epochs = input.epochs ?? benchmark.meta.defaultEpochs;
  const concurrency = input.concurrency ?? 8;

  const instances = await benchmark.loadInstances();
  const start = input.start ?? 0;
  const end = input.end ?? instances.length;
  const limit = input.limit;
  const sliced = instances.slice(start, Math.min(end, instances.length));
  const selected = limit === undefined ? sliced : sliced.slice(0, limit);

  const units: Array<{ instance: (typeof selected)[number]; epoch: number }> = [];
  for (const instance of selected) {
    for (let epoch = 1; epoch <= epochs; epoch++) {
      units.push({ instance, epoch });
    }
  }
  // Resume discipline (ADR-0002): (instance, epoch) pairs with attempt rows are
  // complete — every concluded attempt counts toward CPET, so re-running it
  // would double-count spend.
  const completedUnits = input.completedUnits;
  const scheduled = completedUnits
    ? units.filter((unit) => !completedUnits.has(attemptScopeKey(unit.instance.id, unit.epoch)))
    : units;
  const skippedCompleted = units.length - scheduled.length;

  const provider = resolver.providerFor(model);
  const providerCap = input.adapterConfig?.providerCaps?.[provider] ?? concurrency;
  const globalLimiter = new Semaphore(concurrency);
  const providerLimiter = new Semaphore(Math.min(providerCap, concurrency));

  const controller = new AbortController();
  const rows: OutcomeRow[] = [];

  async function runUnit(unit: (typeof units)[number]): Promise<void> {
    const ctx: InstanceContext = {
      runId,
      epoch: unit.epoch,
      model,
      temperature: benchmark.meta.temperature,
      resolver,
      signal: controller.signal,
    };
    let outcome: InstanceOutcome;
    try {
      outcome = await benchmark.runInstance(unit.instance, ctx);
    } catch (error) {
      if (error instanceof TransportFailedError) {
        outcome = {
          status: "transport-failed",
          content: null,
          usage: null,
          latencyMs: null,
          providerResponseId: null,
        };
      } else {
        throw error;
      }
    }
    const row: OutcomeRow = {
      runId,
      benchmarkId: benchmark.meta.id,
      layer: benchmark.meta.layer,
      model,
      instanceId: unit.instance.id,
      epoch: unit.epoch,
      ...outcome,
    };
    rows.push(row);
    input.onOutcome?.(row);
  }

  let nextUnit = 0;
  let aborted = false;
  let dispatched = 0;
  let budgetStopped = false;
  async function worker(): Promise<void> {
    while (true) {
      if (controller.signal.aborted) return;
      if (nextUnit >= scheduled.length) return;
      if (input.budget?.exceeded) {
        budgetStopped = true;
        return;
      }
      const unit = scheduled[nextUnit]!;
      nextUnit++;
      dispatched++;
      const releaseGlobal = await globalLimiter.acquire();
      const releaseProvider = await providerLimiter.acquire();
      try {
        await runUnit(unit);
      } catch (error) {
        if (error instanceof AbortRunError) {
          aborted = true;
          controller.abort();
          return;
        }
        // Unexpected errors are benchmark bugs: systemic, so stop scheduling
        // before rejecting.
        aborted = true;
        controller.abort();
        throw error;
      } finally {
        releaseProvider();
        releaseGlobal();
      }
    }
  }

  const workerCount = Math.min(concurrency, scheduled.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const configSnapshot: ConfigSnapshot = {
    benchmarkId: benchmark.meta.id,
    layer: benchmark.meta.layer,
    model,
    temperature: benchmark.meta.temperature,
    gitSha: input.gitSha ?? null,
    params: {
      epochs,
      concurrency,
      start: input.start ?? null,
      end: input.end ?? null,
      limit: input.limit ?? null,
      artifactDir: input.artifactDir ?? null,
      resumeId: input.resumeId ?? null,
    },
    priceTableRef: input.priceTableRef ?? null,
    taskConfiguration: null,
  };

  return {
    runId,
    configSnapshot,
    rows,
    status: aborted ? "aborted" : budgetStopped ? "budget-reached" : "completed",
    skippedCompleted,
    budgetRefused: budgetStopped ? scheduled.length - dispatched : 0,
  };
}
