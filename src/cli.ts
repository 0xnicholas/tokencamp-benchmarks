import { isModelInMatrix } from "./core/matrix";
import { allBenchmarks, benchmarkIds, getBenchmark } from "./core/registry";
import { StubGenerationResolver } from "./core/resolver";
import { runBenchmark } from "./core/runner";
import type { OutcomeRow } from "./core/types";

const USAGE = `Usage: bun run bench -- --benchmark <id> --model <model-id> [options]

Options:
  --benchmark <id>       Benchmark id from the registry (required unless --list)
  --model <model-id>     Model id from the pinned matrix (models/matrix.json)
  --limit <n>            Max instances to run
  --start <n>            0-based inclusive instance index to start from
  --end <n>              Exclusive end instance index
  --epochs <n>           Epochs per instance (default: benchmark's defaultEpochs)
  --concurrency <n>      Global concurrency cap (default 8)
  --artifact-dir <path>  Run artifact directory (wired up by the artifacts ticket)
  --resume-id <id>       Resume run id (wired up by the artifacts ticket)
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
]);

const NUMERIC_FLAGS = new Set(["--limit", "--start", "--end", "--epochs", "--concurrency"]);

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
  const result = await runBenchmark({
    benchmark,
    resolver: new StubGenerationResolver(),
    model,
    runId,
    epochs: args.epochs,
    concurrency: args.concurrency,
    start,
    end,
    limit: args.limit,
    artifactDir: args.artifactDir ?? null,
    resumeId: args.resumeId ?? null,
    gitSha: resolveGitSha(),
    onOutcome: printOutcome,
  });

  const okCount = result.rows.filter((row) => row.status === "ok").length;
  const transportFailedCount = result.rows.length - okCount;
  console.log(
    `run ${result.runId} ${result.status}: ${result.rows.length} outcomes (ok: ${okCount}, transport-failed: ${transportFailedCount})`,
  );
  return result.status === "aborted" ? 1 : 0;
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
