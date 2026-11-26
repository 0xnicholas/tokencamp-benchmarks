import type {
  ArtifactAttemptRow,
  HarnessOverhead,
  VerificationAggregate,
  MoneyAggregate,
  SettleFlag,
} from "./types";

const SUMMARY_FORMAT_VERSION = 1;

export type GroupKey = string;

export interface SummaryGroup {
  readonly attempts: number;
  readonly quality: VerificationAggregate | null;
  readonly money: MoneyAggregate;
}

export interface TypeLedgerEntry {
  readonly totalSpendUsd: number;
  readonly effectiveTasks: number;
  readonly cpetUsd: number | null;
  readonly wasteShare: number | null;
}

export interface RunSummary {
  readonly format_version: number;
  readonly runId: string;
  readonly configHash: string;
  readonly generatedAt: string;
  readonly coverage: {
    readonly attempts: number;
    readonly instances: number;
    readonly verifiedAttempts: number;
    readonly instancesWithVerification: number;
  };
  /** Money per ADR-0006; quality per ADR-0005 (verified rows only). */
  readonly quality: VerificationAggregate | null;
  readonly money: MoneyAggregate;
  /** Aggregates per Task Configuration (benchmark × model × temperature). */
  readonly configs: Readonly<Record<GroupKey, SummaryGroup>>;
  /** Aggregates per task type — never merged across types (ADR-0005/0006). */
  readonly byTaskType: Readonly<Record<GroupKey, SummaryGroup>>;
  /** Aggregates per difficulty tier (ADR-0003 tiers from the frozen dataset). */
  readonly byDifficultyTier: Readonly<Record<GroupKey, SummaryGroup>>;
  /** Run-level ledger: totals + per-type tables; no cross-type CPET claim. */
  readonly ledger: {
    readonly totalSpendUsd: number;
    readonly tokenSpendUsd: { readonly settled: number; readonly computed: number };
    readonly toolSpendUsd: number;
    readonly settleCoverage: Readonly<Record<SettleFlag, number>>;
    readonly perType: Readonly<Record<GroupKey, TypeLedgerEntry>>;
  };
  /** Benchmark-side cost, disclosed but excluded from the CPET numerator (ADR-0006). */
  readonly harnessOverhead: HarnessOverhead & { readonly totalUsd: number; readonly note: string };
}

function groupBy(
  rows: readonly ArtifactAttemptRow[],
  keyOf: (row: ArtifactAttemptRow) => string | null,
): Map<GroupKey, ArtifactAttemptRow[]> {
  const groups = new Map<GroupKey, ArtifactAttemptRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) {
      continue;
    }
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [row]);
    } else {
      bucket.push(row);
    }
  }
  return groups;
}

/**
 * Money per ADR-0006 over a set of attempt rows:
 * - CPET = total spend ÷ effective tasks (gate-passed attempts); null when no
 *   attempt is verified effective — never an invented number;
 * - waste share = verified-failed spend ÷ total spend, with unverified spend
 *   disclosed separately;
 * - headline spend = settled token cost (computed fallback per missing settle)
 *   + Tool Cost.
 */
function aggregateMoney(rows: readonly ArtifactAttemptRow[]): MoneyAggregate {
  let totalSpendUsd = 0;
  let effectiveTasks = 0;
  let failedSpendUsd = 0;
  let unverifiedSpendUsd = 0;
  let settledTokens = 0;
  let computedTokens = 0;
  let toolSpendUsd = 0;
  const settleCoverage: Record<SettleFlag, number> = { settled: 0, missing: 0, unbilled: 0 };

  for (const row of rows) {
    totalSpendUsd += row.cost.headlineUsd;
    settledTokens += row.cost.settledTokenUsd;
    computedTokens += row.cost.computedTokenUsd;
    toolSpendUsd += row.cost.toolCostUsd;
    settleCoverage[row.cost.settle]++;
    if (row.verification === null) {
      unverifiedSpendUsd += row.cost.headlineUsd;
    } else if (row.verification.gate) {
      effectiveTasks++;
    } else {
      failedSpendUsd += row.cost.headlineUsd;
    }
  }

  return {
    attempts: rows.length,
    totalSpendUsd,
    effectiveTasks,
    cpetUsd: effectiveTasks > 0 ? totalSpendUsd / effectiveTasks : null,
    wasteShare: totalSpendUsd > 0 ? failedSpendUsd / totalSpendUsd : null,
    unverifiedSpendUsd,
    tokenSpendUsd: { settled: settledTokens, computed: computedTokens },
    toolSpendUsd,
    settleCoverage,
  };
}

/**
 * Quality per ADR-0005 over verified attempt outcomes only: Quality Score
 * (mean), Task Success Rate (mean gate), Reliability (mean over instances of
 * gate-passing epochs / verified epochs). Rows without a verification verdict
 * never enter the quality aggregates.
 */
function aggregateQuality(rows: readonly ArtifactAttemptRow[]): VerificationAggregate | null {
  const verified = rows.filter((row) => row.verification !== null);
  if (verified.length === 0) {
    return null;
  }
  let gateSum = 0;
  let scoreSum = 0;
  const instances = new Map<string, { passed: number; total: number }>();
  for (const row of verified) {
    const verification = row.verification!;
    gateSum += verification.gate ? 1 : 0;
    scoreSum += verification.score;
    const instance = instances.get(row.instanceId) ?? { passed: 0, total: 0 };
    instance.total++;
    if (verification.gate) {
      instance.passed++;
    }
    instances.set(row.instanceId, instance);
  }
  let reliabilitySum = 0;
  for (const instance of instances.values()) {
    reliabilitySum += instance.passed / instance.total;
  }
  return {
    verifiedAttempts: verified.length,
    taskSuccessRate: gateSum / verified.length,
    meanQualityScore: scoreSum / verified.length,
    reliability: reliabilitySum / instances.size,
    instancesWithVerification: instances.size,
  };
}

function summarizeGroup(rows: readonly ArtifactAttemptRow[]): SummaryGroup {
  return {
    attempts: rows.length,
    quality: aggregateQuality(rows),
    money: aggregateMoney(rows),
  };
}

/**
 * The summary.json assembler (ADR-0005 quality, ADR-0006 money). Pure over the
 * artifact rows — the report layer and future assemblers consume the same
 * shapes without re-deriving the accounting.
 */
export function assembleSummary(input: {
  readonly runId: string;
  readonly configHash: string;
  readonly rows: readonly ArtifactAttemptRow[];
  readonly overhead: HarnessOverhead;
  readonly generatedAt: string;
}): RunSummary {
  const { rows, overhead, runId, configHash, generatedAt } = input;

  const configGroups = groupBy(rows, (row) => `${row.benchmarkId}|${row.model}`);
  const typeGroups = groupBy(rows, (row) => row.benchmarkId);
  const tierGroups = groupBy(rows, (row) => row.difficultyTier);

  const runMoney = aggregateMoney(rows);
  const perType: Record<GroupKey, TypeLedgerEntry> = {};
  for (const [type, typeRows] of typeGroups) {
    const money = aggregateMoney(typeRows);
    perType[type] = {
      totalSpendUsd: money.totalSpendUsd,
      effectiveTasks: money.effectiveTasks,
      cpetUsd: money.cpetUsd,
      wasteShare: money.wasteShare,
    };
  }

  const totalOverheadUsd = overhead.verifierExecutionUsd + overhead.sandboxStartupUsd;

  return {
    format_version: SUMMARY_FORMAT_VERSION,
    runId,
    configHash,
    generatedAt,
    coverage: {
      attempts: rows.length,
      instances: new Set(rows.map((row) => row.instanceId)).size,
      verifiedAttempts: rows.filter((row) => row.verification !== null).length,
      instancesWithVerification: new Set(
        rows.filter((row) => row.verification !== null).map((row) => row.instanceId),
      ).size,
    },
    quality: aggregateQuality(rows),
    money: runMoney,
    configs: Object.fromEntries(
      [...configGroups].map(([key, groupRows]) => [key, summarizeGroup(groupRows)]),
    ),
    byTaskType: Object.fromEntries(
      [...typeGroups].map(([key, groupRows]) => [key, summarizeGroup(groupRows)]),
    ),
    byDifficultyTier: Object.fromEntries(
      [...tierGroups].map(([key, groupRows]) => [key, summarizeGroup(groupRows)]),
    ),
    ledger: {
      totalSpendUsd: runMoney.totalSpendUsd,
      tokenSpendUsd: runMoney.tokenSpendUsd,
      toolSpendUsd: runMoney.toolSpendUsd,
      settleCoverage: runMoney.settleCoverage,
      perType,
    },
    harnessOverhead: {
      verifierExecutionUsd: overhead.verifierExecutionUsd,
      sandboxStartupUsd: overhead.sandboxStartupUsd,
      totalUsd: totalOverheadUsd,
      note: "benchmark-side execution cost (verifier runs, sandbox startup) — excluded from CPET (ADR-0006)",
    },
  };
}
