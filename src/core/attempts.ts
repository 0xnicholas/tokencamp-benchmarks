import type {
  AttemptRawCall,
  AttemptRecord,
  AttemptScope,
  AttemptStatus,
  ToolCallMetering,
  Usage,
} from "./types";

export interface AttemptLedgerOptions {
  /** Streams each attempt row as it is recorded — the append-only artifacts hook (#13). */
  readonly onAttempt?: (record: AttemptRecord) => void;
}

export interface AttemptKeyInput {
  readonly runId: string;
  readonly benchmarkId: string;
  readonly model: string;
  readonly instanceId: string;
  readonly epoch: number;
}

interface OpenAttemptScope extends AttemptScope {
  readonly recordCall: (rawCall: AttemptRawCall) => void;
}

function scopeKey(instanceId: string, epoch: number): string {
  return `${instanceId}\u0000${epoch}`;
}

/** Shared key format for per-(instance, epoch) attempt bookkeeping. */
export function attemptScopeKey(instanceId: string, epoch: number): string {
  return scopeKey(instanceId, epoch);
}

/**
 * The resolver-side attempt book (ADR-0002). The runner knows nothing about
 * attempts: every physical model call gets a unique 4-part trace id
 * (`<runId>.<epoch>.<instanceId>.<call>`), single-shot tries record one
 * attempt row each (retries never vanish from CPET), and an open agentic
 * scope folds the loop's calls into one row's rawCalls (ADR-0007).
 */
export class AttemptLedger {
  readonly #onAttempt: (record: AttemptRecord) => void;
  readonly #callCounters = new Map<string, number>();
  readonly #rowCounters = new Map<string, number>();
  readonly #openScopes = new Map<string, Array<AttemptRawCall>>();
  readonly #rows: AttemptRecord[] = [];

  constructor(options: AttemptLedgerOptions = {}) {
    this.#onAttempt = options.onAttempt ?? (() => {});
  }

  nextTraceId(runId: string, epoch: number, instanceId: string): string {
    const key = scopeKey(instanceId, epoch);
    const call = (this.#callCounters.get(key) ?? 0) + 1;
    this.#callCounters.set(key, call);
    return `${runId}.${epoch}.${instanceId}.${call}`;
  }

  recordStandalone(
    key: AttemptKeyInput,
    rawCall: AttemptRawCall,
    output: string | null,
  ): AttemptRecord {
    const record: AttemptRecord = {
      runId: key.runId,
      benchmarkId: key.benchmarkId,
      model: key.model,
      instanceId: key.instanceId,
      epoch: key.epoch,
      attempt: this.#nextRowNumber(key.instanceId, key.epoch),
      status: rawCall.status,
      output,
      usage: rawCall.usage,
      traceId: rawCall.traceId,
      latencyMs: rawCall.latencyMs,
      providerResponseId: rawCall.generationId,
      rawCalls: [rawCall],
      cost: null,
      toolCalls: [],
      sandboxSpec: null,
    };
    this.#rows.push(record);
    this.#onAttempt(record);
    return record;
  }

  beginAttempt(key: AttemptKeyInput): OpenAttemptScope {
    const bucket: AttemptRawCall[] = [];
    this.#openScopes.set(scopeKey(key.instanceId, key.epoch), bucket);
    return {
      recordCall: (rawCall: AttemptRawCall) => {
        bucket.push(rawCall);
      },
      finish: (summary: {
        status: AttemptStatus;
        output?: string | null;
        usage?: Usage | null;
        latencyMs?: number | null;
        providerResponseId?: string | null;
        toolCalls?: readonly ToolCallMetering[];
        sandboxSpec?: string | null;
      }) => {
        this.#openScopes.delete(scopeKey(key.instanceId, key.epoch));
        const record: AttemptRecord = {
          runId: key.runId,
          benchmarkId: key.benchmarkId,
          model: key.model,
          instanceId: key.instanceId,
          epoch: key.epoch,
          attempt: this.#nextRowNumber(key.instanceId, key.epoch),
          status: summary.status,
          output: summary.output ?? null,
          usage: summary.usage ?? null,
          traceId: bucket[0]?.traceId ?? null,
          latencyMs: summary.latencyMs ?? null,
          providerResponseId: summary.providerResponseId ?? null,
          rawCalls: [...bucket],
          cost: null,
          toolCalls: summary.toolCalls ?? [],
          sandboxSpec: summary.sandboxSpec ?? null,
        };
        this.#rows.push(record);
        this.#onAttempt(record);
      },
    };
  }

  snapshot(): readonly AttemptRecord[] {
    return [...this.#rows];
  }

  #nextRowNumber(instanceId: string, epoch: number): number {
    const key = scopeKey(instanceId, epoch);
    const attempt = (this.#rowCounters.get(key) ?? 0) + 1;
    this.#rowCounters.set(key, attempt);
    return attempt;
  }
}
