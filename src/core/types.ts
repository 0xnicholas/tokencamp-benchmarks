export type BenchmarkLayer = "model" | "task";

export interface BenchmarkMeta {
  readonly id: string;
  readonly layer: BenchmarkLayer;
  readonly defaultEpochs: number;
  readonly temperature: number;
}

export interface BenchmarkInstance {
  readonly id: string;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  /** Tool result id — required on role "tool" messages (OpenAI tool protocol). */
  readonly toolCallId?: string;
  /** Calls a prior assistant message requested — required on assistant messages that carry them. */
  readonly toolCalls?: readonly ToolCallRequest[];
}

/** A tool the caller offers the model (OpenAI tools format, passed through as-is). */
export interface ToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

/** One tool invocation the model requested back (OpenAI tool_calls). */
export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  /** Raw JSON arguments string, exactly as the model emitted it. */
  readonly arguments: string;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly reasoningTokens: number;
}

export interface GenerateCall {
  readonly runId: string;
  readonly benchmarkId: string;
  readonly instanceId: string;
  readonly epoch: number;
  readonly model: string;
  readonly temperature: number;
  readonly messages: readonly ChatMessage[];
  readonly signal: AbortSignal;
  /** Tools offered to the model for this call (agentic seam, ADR-0007). Omitted for single-shot. */
  readonly tools?: readonly ToolDefinition[];
}

export interface GenerateResult {
  readonly content: string;
  readonly usage: Usage;
  readonly finishReason: string;
  readonly latencyMs: number;
  readonly providerResponseId: string | null;
  readonly traceId: string | null;
  /** Real in v1 (ADR-0004): the tokencamp task id from the response, when the gateway sends one. */
  readonly taskId: string | null;
  /** Real in v1 (ADR-0004): the authoritative settle record fetched via GET /v1/generation/{id}. */
  readonly costAttribution: unknown;
  /** Tool invocations the model requested (agentic seam, ADR-0007). Empty for plain completions. */
  readonly toolCalls: readonly ToolCallRequest[];
}

export interface GenerationResolver {
  readonly providerFor: (modelId: string) => string;
  readonly generate: (call: GenerateCall) => Promise<GenerateResult>;
}

export interface InstanceContext {
  readonly runId: string;
  readonly epoch: number;
  readonly model: string;
  readonly temperature: number;
  readonly resolver: GenerationResolver;
  readonly signal: AbortSignal;
}

export type OutcomeStatus = "ok" | "transport-failed";

/** Anything that can refuse new attempts when the run's spend cap is reached (ADR-0006). */
export interface SpendGuard {
  readonly exceeded: boolean;
}

/** Status of one attempt: the resolver's granularity, finer than the runner's OutcomeStatus. */
export type AttemptStatus = "ok" | "transport-failed" | "systemic-error";

/**
 * One billed sandbox tool execution inside an Agent Loop epoch (ADR-0007):
 * the Tool Cost input the cost module prices at the pinned machine rate.
 * 8KB output tails keep the artifact row bounded.
 */
export interface ToolCallMetering {
  readonly toolName: string;
  readonly wallClockMs: number;
  readonly exitCode: number | null;
  readonly stdoutTail: string | null;
  readonly stderrTail: string | null;
}

/**
 * Per-raw-call cost, derived by the cost module (#13): settledCostUsd from the
 * settle record (null when missing/unparseable), computedCostUsd from the
 * pinned price table.
 */
export interface RawCallCost {
  readonly settledCostUsd: number | null;
  readonly computedCostUsd: number;
}

export type AttemptArtifactRawCall = AttemptRawCall & RawCallCost;

/** How much of an attempt's token spend carries a settle record (ADR-0006). */
export type SettleFlag = "settled" | "missing" | "unbilled";

/**
 * The ADR-0006 spend model for one attempt: tokens (settled headline,
 * computed anchor) + tools (pinned machine rate × billed wall-clock).
 * Headline = settledTokenUsd + toolCostUsd — the CPET numerator.
 */
export interface AttemptCost {
  readonly settle: SettleFlag;
  readonly headlineUsd: number;
  readonly settledTokenUsd: number;
  readonly computedTokenUsd: number;
  readonly toolCostUsd: number;
}

/**
 * The attempt row as written to results.jsonl: the resolver's record with the
 * cost block filled (#13), the dataset's difficulty tier, and a verification
 * seam (null until the Evaluation Engine's verifiers run, ADR-0005).
 */
export interface ArtifactAttemptRow extends Omit<AttemptRecord, "cost" | "rawCalls"> {
  readonly cost: AttemptCost;
  readonly rawCalls: readonly AttemptArtifactRawCall[];
  readonly difficultyTier: string | null;
  readonly verification: AttemptVerification | null;
}

/** Benchmark-side execution cost disclosed in summary.json, excluded from CPET (ADR-0006). */
export interface HarnessOverhead {
  readonly verifierExecutionUsd: number;
  readonly sandboxStartupUsd: number;
}

/** Quality aggregation per ADR-0005 — computed over verified attempt outcomes only. */
export interface VerificationAggregate {
  readonly verifiedAttempts: number;
  readonly taskSuccessRate: number | null;
  readonly meanQualityScore: number | null;
  readonly reliability: number | null;
  readonly instancesWithVerification: number;
}

/** Money aggregation per ADR-0006 over a set of attempt rows. */
export interface MoneyAggregate {
  readonly attempts: number;
  readonly totalSpendUsd: number;
  readonly effectiveTasks: number;
  /** null when no attempt is verified effective — never an invented number. */
  readonly cpetUsd: number | null;
  /** Verified-failed spend ÷ total spend; unverifiedSpendUsd discloses the gap. */
  readonly wasteShare: number | null;
  readonly unverifiedSpendUsd: number;
  readonly tokenSpendUsd: { readonly settled: number; readonly computed: number };
  readonly toolSpendUsd: number;
  readonly settleCoverage: Readonly<Record<SettleFlag, number>>;
}

/**
 * The Quality Gate + Quality Score verdict for one attempt (ADR-0005), written
 * by the Evaluation Engine's verifiers. `detail` is per-unit evidence (per-test
 * results, per-key matches, F1 parts, F2P/P2P lists) — typed per verifier.
 * Gate ⟺ score is exactly 1.0, the uniform rule across all task types.
 */
export interface AttemptVerification {
  readonly verifier: string;
  readonly gate: boolean;
  readonly score: number;
  readonly detail: unknown;
}

/**
 * One physical model call (including retries) issued through the resolver —
 * the Raw Call ledger the cost module (#13) reconciles settled cost against.
 */
export interface AttemptRawCall {
  readonly traceId: string;
  readonly status: AttemptStatus;
  /** The tokencamp generation id (request id) — the GET /v1/generation/{id} hook. */
  readonly generationId: string | null;
  readonly usage: Usage;
  readonly latencyMs: number | null;
  readonly cfRay: string | null;
  readonly xRequestId: string | null;
  /** Raw GET /v1/generation/{id} payload — authoritative cost/latency/served-model (ADR-0004). */
  readonly settledGeneration: unknown;
  /** Failure reason for non-ok tries; null on success. */
  readonly error: string | null;
}

/**
 * One attempt row (ADR-0002): the resolver's own record, one per logical call for
 * single-shot and one per epoch for the agentic loop (rawCalls accumulate, ADR-0007).
 * `cost` is the cost module's field (#13) — stubbed until that ticket lands.
 */
export interface AttemptRecord {
  readonly runId: string;
  readonly benchmarkId: string;
  readonly model: string;
  readonly instanceId: string;
  readonly epoch: number;
  /** Per-(instanceId, epoch) attempt-row counter, 1-based. */
  readonly attempt: number;
  readonly status: AttemptStatus;
  readonly output: string | null;
  readonly usage: Usage | null;
  readonly traceId: string | null;
  readonly latencyMs: number | null;
  readonly providerResponseId: string | null;
  readonly rawCalls: readonly AttemptRawCall[];
  readonly cost: null;
  /** Billed sandbox tool executions for this attempt (agentic rows, ADR-0007). */
  readonly toolCalls: readonly ToolCallMetering[];
  /** Which pinned sandbox spec priced this attempt's toolCalls; null = tool-free. */
  readonly sandboxSpec: string | null;
}

/**
 * Scope the agentic loop opens around an epoch so the loop's generate() calls
 * accumulate into one attempt row's rawCalls instead of standalone rows (ADR-0007).
 */
export interface AttemptScope {
  readonly finish: (summary: {
    readonly status: AttemptStatus;
    readonly output?: string | null;
    readonly usage?: Usage | null;
    readonly latencyMs?: number | null;
    readonly providerResponseId?: string | null;
    readonly toolCalls?: readonly ToolCallMetering[];
    readonly sandboxSpec?: string | null;
  }) => void;
}

export interface InstanceOutcome {
  readonly status: OutcomeStatus;
  readonly content: string | null;
  readonly usage: Usage | null;
  readonly latencyMs: number | null;
  readonly providerResponseId: string | null;
}

export interface OutcomeRow extends InstanceOutcome {
  readonly runId: string;
  readonly benchmarkId: string;
  readonly layer: BenchmarkLayer;
  readonly model: string;
  readonly instanceId: string;
  readonly epoch: number;
}

export interface RunLevelScore {
  readonly name: string;
  readonly metrics: Readonly<Record<string, { readonly value: number }>>;
}

export interface PrimaryScore {
  readonly value: number;
  readonly weight: number;
}

export interface Benchmark {
  readonly meta: BenchmarkMeta;
  readonly loadInstances: () => Promise<readonly BenchmarkInstance[]>;
  readonly runInstance: (
    instance: BenchmarkInstance,
    ctx: InstanceContext,
  ) => Promise<InstanceOutcome>;
  readonly runLevelScores?: (rows: readonly OutcomeRow[]) => readonly RunLevelScore[];
  readonly primaryScore?: (rows: readonly OutcomeRow[]) => PrimaryScore | undefined;
}

export interface RunParams {
  readonly epochs: number;
  readonly concurrency: number;
  readonly start: number | null;
  readonly end: number | null;
  readonly limit: number | null;
  readonly artifactDir: string | null;
  readonly resumeId: string | null;
}

export interface ConfigSnapshot {
  readonly benchmarkId: string;
  readonly layer: BenchmarkLayer;
  readonly model: string;
  readonly temperature: number;
  readonly gitSha: string | null;
  readonly params: RunParams;
  readonly priceTableRef: string | null;
  readonly taskConfiguration: null;
}
