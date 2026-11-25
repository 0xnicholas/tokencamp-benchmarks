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
}

export interface GenerateResult {
  readonly content: string;
  readonly usage: Usage;
  readonly finishReason: string;
  readonly latencyMs: number;
  readonly providerResponseId: string | null;
  readonly traceId: string | null;
  readonly taskId: string | null;
  readonly costAttribution: unknown;
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
