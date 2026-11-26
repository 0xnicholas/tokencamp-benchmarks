import { isModelInMatrix } from "./core/matrix";
import { TokencampResolver } from "./core/adapters/tokencamp";
import { AttemptLedger } from "./core/attempts";
import { RunBudget } from "./core/budget";
import { RunArtifactStore } from "./core/artifacts";
import { loadPriceTable, type PriceTable } from "./core/prices";
import { allBenchmarks, benchmarkIds, getBenchmark } from "./core/registry";
import { runBenchmark } from "./core/runner";
import type { GenerationResolver, OutcomeRow } from "./core/types";

const DEFAULT_PRICE_TABLE_PATH = "prices/prices.json";

const USAGE = `Usage: bun run bench -- --benchmark <id> --model <model-id> [options]

Options:
  --benchmark <id>       Benchmark id from the registry (required unless --list)
  --model <model-id>     Model id from the pinned matrix (models/matrix.json)
  --limit <n>            Max instances to run
  --start <n>            0-based inclusive instance index to start from
  --end <n>              Exclusive end instance index
  --epochs <n>           Epochs per instance (default: benchmark's defaultEpochs)
  --concurrency <n>      Global concurrency cap (default 8)
  --artifact-dir <path>  Run artifact directory: <path>/<runId>/ holds manifest.json,
                         results.jsonl, and summary.json (ADR-0002)
  --resume-id <id>       Reopen run <id> in --artifact-dir: refuses on configHash mismatch,
                         skips completed instances, appends new rows (ADR-0002/0006)
  --max-spend-usd <usd>  Refuse new attempts once settled spend reaches this budget (ADR-0006)
  --list                 List registered benchmarks and exit
`;

const VALUE_FLAGS = new Set([
  "--benchmark",
  "--model",
  "--limit",
  "--start",
  "--end",
  "--epochs",
  "--concurrency",
  "--artifact-dir",
  "--resume-id",
  "--max-spend-usd",
]);

const NUMERIC_FLAGS = new Set([
  "--limit",
  "--start",
  "--end",
  "--epochs",
  "--concurrency",
  "--max-spend-usd",
]);

interface CliArgs {
  benchmark?: string;
  model?: string;
  limit?: number;
  start?: number;
  end?: number;
  epochs?: number;
  concurrency?: number;
  artifactDir?: string;
  resumeId?: string;
  maxSpendUsd?: number;
  list: boolean;
}

type ParseOutcome = { ok: true; args: CliArgs } | { ok: false; error: string };

function parsePositiveInt(flag: string, raw: string): number | string {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    return `${flag} expects a positive integer, got "${raw}"`;
  }
  return value;
}

function parsePositiveNumber(flag: string, raw: string): number | string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return `${flag} expects a positive number, got "${raw}"`;
  }
  return value;
}

function parseNonNegativeInt(flag: string, raw: string): number | string {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return `${flag} expects a non-negative integer, got "${raw}"`;
  }
  return value;
}

function parseArgs(argv: readonly string[]): ParseOutcome {
  const args: CliArgs = { list: false };
  let index = 0;
  while (index < argv.length) {
    const flag = argv[index]!;
    if (!VALUE_FLAGS.has(flag)) {
      if (flag === "--list") {
        args.list = true;
        index++;
        continue;
      }
      return { ok: false, error: `unknown flag "${flag}"` };
    }
    const rawValue = argv[index + 1];
    if (rawValue === undefined) {
      return { ok: false, error: `${flag} expects a value` };
    }
    if (NUMERIC_FLAGS.has(flag)) {
      const parsed =
        flag === "--start" || flag === "--end"
          ? parseNonNegativeInt(flag, rawValue)
          : flag === "--max-spend-usd"
            ? parsePositiveNumber(flag, rawValue)
            : parsePositiveInt(flag, rawValue);
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      switch (flag) {
        case "--limit":
          args.limit = parsed;
          break;
        case "--start":
          args.start = parsed;
          break;
        case "--end":
          args.end = parsed;
          break;
        case "--epochs":
          args.epochs = parsed;
          break;
        case "--concurrency":
          args.concurrency = parsed;
          break;
        case "--max-spend-usd":
          args.maxSpendUsd = parsed;
          break;
      }
    } else {
      switch (flag) {
        case "--benchmark":
          args.benchmark = rawValue;
          break;
        case "--model":
          args.model = rawValue;
          break;
        case "--artifact-dir":
          args.artifactDir = rawValue;
          break;
        case "--resume-id":
          args.resumeId = rawValue;
          break;
      }
    }
    index += 2;
  }
  return { ok: true, args };
}

function printList(): void {
  const benchmarks = allBenchmarks();
  if (benchmarks.length === 0) {
    console.log("no benchmarks registered yet");
    return;
  }
  console.log("id\tlayer\tepochs\ttemperature");
  for (const benchmark of benchmarks) {
    const { meta } = benchmark;
    console.log(`${meta.id}\t${meta.layer}\t${meta.defaultEpochs}\t${meta.temperature}`);
  }
}

function resolveGitSha(): string | null {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"]);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.toString().trim();
}

function printOutcome(row: OutcomeRow): void {
  const latency = row.latencyMs === null ? "-" : `${Math.round(row.latencyMs)}ms`;
  console.error(`${row.status} ${row.instanceId} epoch=${row.epoch} (${latency})`);
}

async function run(args: CliArgs): Promise<number> {
  const benchmarkId = args.benchmark;
  if (benchmarkId === undefined) {
    console.error("--benchmark is required (use --list to see registered benchmarks)");
    return 2;
  }
  const benchmark = getBenchmark(benchmarkId);
  if (benchmark === undefined) {
    console.error(
      `unknown benchmark "${benchmarkId}" (registered: ${benchmarkIds().join(", ") || "none"})`,
    );
    return 2;
  }

  const model = args.model;
  if (model === undefined) {
    console.error("--model is required");
    return 2;
  }
  if (!isModelInMatrix(model)) {
    console.error(
      `model "${model}" is not in the pinned matrix (models/matrix.json) — nothing outside the matrix runs (ADR-0004)`,
    );
    return 2;
  }

  const { start, end } = args;
  if (start !== undefined && end !== undefined && end < start) {
    console.error(`--end (${end}) must be >= --start (${start})`);
    return 2;
  }

  const runId = args.resumeId ?? crypto.randomUUID();

  // Cost discipline (ADR-0006): the price table loads and validates at startup —
  // an unknown model refuses to run, because a score without cost violates the
  // destination.
  let priceTable: PriceTable;
  let catalogSnapshotSha256: string;
  try {
    const loaded = await loadPriceTable();
    priceTable = loaded.table;
    catalogSnapshotSha256 = loaded.sha256;
  } catch (error) {
    console.error(
      `${error instanceof Error ? error.message : String(error)}\n\nthe pinned price table must load before anything runs (ADR-0006)`,
    );
    return 2;
  }
  if (!priceTable.hasModel(model)) {
    console.error(
      `model "${model}" is not in the pinned price table (prices/prices.json) — a score without cost violates the destination (ADR-0006)`,
    );
    return 2;
  }
  if (args.resumeId !== undefined && args.artifactDir === undefined) {
    console.error("--resume-id requires --artifact-dir (the run directory to reopen)");
    return 2;
  }

  const priceTableRef = `${DEFAULT_PRICE_TABLE_PATH}@sha256:${catalogSnapshotSha256}`;
  const tokencampVersion = process.env.TOKENCAMP_VERSION ?? null;
  const epochs = args.epochs ?? benchmark.meta.defaultEpochs;
  const concurrency = args.concurrency ?? 8;
  const params = {
    epochs,
    concurrency,
    start: args.start ?? null,
    end: args.end ?? null,
    limit: args.limit ?? null,
    artifactDir: args.artifactDir ?? null,
    resumeId: args.resumeId ?? null,
  };

  const budget =
    args.maxSpendUsd !== undefined ? new RunBudget({ maxSpendUsd: args.maxSpendUsd }) : null;

  // The artifact store streams cost-enriched attempt rows to results.jsonl and
  // refuses a resume whose configHash (or price-table pin) drifted.
  let store: RunArtifactStore | null = null;
  if (args.artifactDir !== undefined) {
    try {
      store = await RunArtifactStore.init({
        artifactDir: args.artifactDir,
        runId,
        config: {
          configSnapshot: {
            benchmarkId: benchmark.meta.id,
            layer: benchmark.meta.layer,
            model,
            temperature: benchmark.meta.temperature,
            gitSha: resolveGitSha(),
            params,
            priceTableRef,
            taskConfiguration: null,
          },
          tokencampVersion,
          catalogSnapshotSha256,
        },
        priceTable,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 2;
    }
  }

  const ledger = new AttemptLedger({
    onAttempt: (record) => {
      const row = store?.appendAttempt(record);
      // The guard's ledger fills from actual attempt spend — settled headline
      // (ADR-0006). In-flight attempts finish; only new ones are refused.
      if (row !== undefined) {
        budget?.record(row.cost.headlineUsd);
      }
    },
  });

  let resolver: GenerationResolver;
  try {
    // Env validation happens at construction — fail before spending anything.
    resolver = TokencampResolver.fromEnv(process.env, { ledger });
  } catch (error) {
    console.error(
      `${error instanceof Error ? error.message : String(error)}\n\nset TOKENCAMP_API_KEY and TOKENCAMP_BASE_URL (v1 routes every benchmark call through the tokencamp API, ADR-0004)`,
    );
    return 2;
  }
  const result = await runBenchmark({
    benchmark,
    resolver,
    model,
    runId,
    epochs: args.epochs,
    concurrency: args.concurrency,
    start,
    end,
    limit: args.limit,
    artifactDir: args.artifactDir ?? null,
    resumeId: args.resumeId ?? null,
    priceTableRef,
    completedUnits: store?.completedUnits(),
    budget: budget ?? undefined,
    gitSha: resolveGitSha(),
    onOutcome: printOutcome,
  });

  if (store !== null) {
    await store.writeSummary();
    console.log(`artifacts: ${store.runDir} (manifest.json, results.jsonl, summary.json)`);
  }

  const okCount = result.rows.filter((row) => row.status === "ok").length;
  const transportFailedCount = result.rows.length - okCount;
  const budgetLine =
    budget !== null
      ? `, spend $${budget.spentUsd.toFixed(4)} / cap $${args.maxSpendUsd?.toFixed(2)}`
      : "";
  console.log(
    `run ${result.runId} ${result.status}: ${result.rows.length} outcomes (ok: ${okCount}, transport-failed: ${transportFailedCount})${budgetLine}` +
      (result.skippedCompleted > 0 ? `, resumed: ${result.skippedCompleted} skipped` : "") +
      (result.budgetRefused > 0 ? `, budget-refused: ${result.budgetRefused}` : ""),
  );
  return result.status === "completed" ? 0 : 1;
}

const parsed = parseArgs(Bun.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.error}\n\n${USAGE}`);
  process.exit(2);
}

if (parsed.args.list) {
  printList();
  process.exit(0);
}

run(parsed.args)
  .then((exitCode) => process.exit(exitCode))
  .catch((error: unknown) => {
    console.error(`run failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
