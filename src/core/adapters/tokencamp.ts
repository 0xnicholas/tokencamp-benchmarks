import { AttemptLedger, attemptScopeKey } from "../attempts";
import { AbortRunError, ResolverConfigError, TransportFailedError } from "../errors";
import type {
  AttemptRawCall,
  AttemptScope,
  ChatMessage,
  GenerateCall,
  GenerateResult,
  GenerationResolver,
  ToolCallRequest,
  Usage,
} from "../types";

const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  reasoningTokens: 0,
};

const DEFAULTS = {
  maxAttempts: 3,
  backoffBaseMs: 1_000,
  backoffCapMs: 60_000,
  requestTimeoutMs: 120_000,
  settleTimeoutMs: 10_000,
  appName: "tokencamp-benchmarks",
  appUrl: "https://github.com/0xnicholas/tokencamp-benchmarks",
} as const;

type StatusClass = "ok" | "transport" | "systemic";

/**
 * Retry policy (#4, carried into #12): 429 / 5xx / 408 timeout / connection
 * errors are transport (retry); every other 4xx is systemic (abort the run).
 */
function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) {
    return "ok";
  }
  if (status === 429 || status === 408 || status >= 500) {
    return "transport";
  }
  return "systemic";
}

function headerOr(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  return value !== null && value.length > 0 ? value : null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeUsage(raw: unknown): Usage {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const direct = (...keys: string[]): number => {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
      }
    }
    return 0;
  };
  const nested = (containerKeys: string[], valueKeys: string[]): number => {
    for (const containerKey of containerKeys) {
      const container = obj[containerKey];
      if (container !== null && typeof container === "object") {
        for (const valueKey of valueKeys) {
          const value = (container as Record<string, unknown>)[valueKey];
          if (typeof value === "number" && Number.isFinite(value)) {
            return value;
          }
        }
      }
    }
    return 0;
  };
  return {
    inputTokens: direct("inputTokens", "input_tokens", "prompt_tokens"),
    outputTokens: direct("outputTokens", "output_tokens", "completion_tokens"),
    cacheReadInputTokens:
      direct("cacheReadInputTokens", "cache_read_input_tokens") ||
      nested(["prompt_tokens_details", "promptTokensDetails"], ["cached_tokens", "cachedTokens"]),
    cacheWriteInputTokens: direct("cacheWriteInputTokens", "cache_write_input_tokens"),
    reasoningTokens:
      direct("reasoningTokens", "reasoning_tokens") ||
      nested(
        ["completion_tokens_details", "completionTokensDetails"],
        ["reasoning_tokens", "reasoningTokens"],
      ),
  };
}

interface ChatCompletionResponse {
  readonly id?: unknown;
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: unknown;
      readonly tool_calls?: ReadonlyArray<{
        readonly id?: unknown;
        readonly function?: { readonly name?: unknown; readonly arguments?: unknown };
      }>;
    };
    readonly finish_reason?: unknown;
  }>;
  readonly usage?: unknown;
}

function normalizeToolCalls(response: ChatCompletionResponse): readonly ToolCallRequest[] {
  const rawCalls = response.choices?.[0]?.message?.tool_calls ?? [];
  return rawCalls.map((rawCall, index) => ({
    id: typeof rawCall.id === "string" ? rawCall.id : `tool-call-${index}`,
    name: typeof rawCall.function?.name === "string" ? rawCall.function.name : "",
    arguments: typeof rawCall.function?.arguments === "string" ? rawCall.function.arguments : "",
  }));
}

/**
 * Virtual routing ids (ADR-0004 matrix discipline) never reach the wire. The
 * CLI's matrix gate is the startup ban; this re-check keeps library callers
 * honest before any spend.
 */
const VIRTUAL_ID_PATTERNS: ReadonlyArray<RegExp> = [/^tokencamp\//, /^forge\//];

function assertNoVirtualRouting(modelId: string): void {
  if (VIRTUAL_ID_PATTERNS.some((pattern) => pattern.test(modelId))) {
    throw new ResolverConfigError(
      `model "${modelId}" is a virtual routing id — virtual routing (tokencamp/*, forge/*) is banned; use a catalog id from models/matrix.json (ADR-0004)`,
    );
  }
}

export interface TokencampResolverOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetchFn?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly randomFn?: () => number;
  readonly ledger?: AttemptLedger;
  readonly maxAttempts?: number;
  readonly backoffBaseMs?: number;
  readonly backoffCapMs?: number;
  readonly requestTimeoutMs?: number;
  readonly settleTimeoutMs?: number;
  readonly appName?: string;
  readonly appUrl?: string | null;
}

export class TokencampResolver implements GenerationResolver {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetchFn: typeof fetch;
  readonly #sleepFn: (ms: number) => Promise<void>;
  readonly #randomFn: () => number;
  readonly #ledger: AttemptLedger;
  readonly #maxAttempts: number;
  readonly #backoffBaseMs: number;
  readonly #backoffCapMs: number;
  readonly #requestTimeoutMs: number;
  readonly #settleTimeoutMs: number;
  readonly #appName: string;
  readonly #appUrl: string | null;
  readonly #openScopes = new Map<
    string,
    AttemptScope & { recordCall: (rawCall: AttemptRawCall) => void }
  >();

  constructor(options: TokencampResolverOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new ResolverConfigError(
        "TOKENCAMP_API_KEY is empty — set the workspace key before running (fail before spending anything)",
      );
    }
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl.trim());
    } catch {
      throw new ResolverConfigError(`TOKENCAMP_BASE_URL "${options.baseUrl}" is not a valid URL`);
    }
    if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
      throw new ResolverConfigError(
        `TOKENCAMP_BASE_URL "${options.baseUrl}" must be an http(s) URL`,
      );
    }
    if (options.maxAttempts !== undefined && options.maxAttempts < 1) {
      throw new ResolverConfigError("maxAttempts must be at least 1");
    }
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.origin + baseUrl.pathname.replace(/\/+$/, "");
    this.#fetchFn = options.fetchFn ?? fetch;
    this.#sleepFn =
      options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#randomFn = options.randomFn ?? Math.random;
    this.#ledger = options.ledger ?? new AttemptLedger();
    this.#maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    this.#backoffBaseMs = options.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
    this.#backoffCapMs = options.backoffCapMs ?? DEFAULTS.backoffCapMs;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
    this.#settleTimeoutMs = options.settleTimeoutMs ?? DEFAULTS.settleTimeoutMs;
    this.#appName = options.appName ?? DEFAULTS.appName;
    this.#appUrl = options.appUrl === undefined ? DEFAULTS.appUrl : options.appUrl;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): TokencampResolver {
    return new TokencampResolver({
      apiKey: env.TOKENCAMP_API_KEY ?? "",
      baseUrl: env.TOKENCAMP_BASE_URL ?? "",
    });
  }

  providerFor(_modelId: string): string {
    return "tokencamp";
  }

  /**
   * Opens the per-epoch attempt scope the agentic loop works inside (ADR-0007):
   * while open, this epoch's generate() calls accumulate into one attempt row's
   * rawCalls instead of standalone rows. The loop calls finish() when the epoch
   * ends — budgets exhausted or model stopped.
   */
  beginAttempt(key: {
    runId: string;
    benchmarkId: string;
    model: string;
    instanceId: string;
    epoch: number;
  }): AttemptScope {
    const scope = this.#ledger.beginAttempt(key);
    this.#openScopes.set(attemptScopeKey(key.instanceId, key.epoch), scope);
    return {
      finish: (summary) => {
        this.#openScopes.delete(attemptScopeKey(key.instanceId, key.epoch));
        scope.finish(summary);
      },
    };
  }

  /**
   * The authoritative settle fetch (ADR-0004): GET /v1/generation/{id} returns
   * the customer-paid cost, latency, and served model. Non-fatal on failure —
   * the cost module (#13) can refetch later using the captured generation id.
   */
  async fetchGeneration(generationId: string): Promise<unknown | null> {
    try {
      const response = await this.#fetchFn(
        `${this.#baseUrl}/v1/generation/${encodeURIComponent(generationId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${this.#apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.#settleTimeoutMs),
        },
      );
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  }

  async generate(call: GenerateCall): Promise<GenerateResult> {
    assertNoVirtualRouting(call.model);
    const body = JSON.stringify(this.#buildRequestBody(call));
    let lastError = "";

    for (let tryIndex = 1; tryIndex <= this.#maxAttempts; tryIndex++) {
      if (call.signal.aborted) {
        throw new AbortRunError(
          `run aborted before tokencamp request (${call.instanceId} epoch ${call.epoch})`,
          call.instanceId,
          call.epoch,
        );
      }
      // Every physical call gets its own 4-part trace id so each retry is
      // findable in the provider's logs (ticket #4 trace discipline).
      const traceId = this.#ledger.nextTraceId(call.runId, call.epoch, call.instanceId);
      const startedAt = performance.now();
      try {
        const response = await this.#fetchFn(`${this.#baseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: this.#requestHeaders(traceId),
          body,
          signal: AbortSignal.any([call.signal, AbortSignal.timeout(this.#requestTimeoutMs)]),
        });
        const classification = classifyStatus(response.status);
        if (classification === "ok") {
          return await this.#handleSuccess(call, traceId, response, startedAt);
        }
        const detail = await response.text().catch(() => "");
        const snippet = detail.slice(0, 200);
        const httpError = `HTTP ${response.status}: ${snippet}`;
        if (classification === "systemic") {
          this.#recordTry(
            call,
            {
              traceId,
              status: "systemic-error",
              generationId: null,
              usage: ZERO_USAGE,
              latencyMs: performance.now() - startedAt,
              cfRay: headerOr(response.headers, "cf-ray"),
              xRequestId: headerOr(response.headers, "x-request-id"),
              settledGeneration: null,
              error: httpError,
            },
            null,
          );
          throw new AbortRunError(
            `tokencamp returned HTTP ${response.status} for ${call.instanceId} epoch ${call.epoch} — systemic, aborting the run: ${snippet}`,
            call.instanceId,
            call.epoch,
          );
        }
        this.#recordTry(
          call,
          {
            traceId,
            status: "transport-failed",
            generationId: null,
            usage: ZERO_USAGE,
            latencyMs: performance.now() - startedAt,
            cfRay: headerOr(response.headers, "cf-ray"),
            xRequestId: headerOr(response.headers, "x-request-id"),
            settledGeneration: null,
            error: httpError,
          },
          null,
        );
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        if (error instanceof AbortRunError) {
          throw error;
        }
        this.#recordTry(
          call,
          {
            traceId,
            status: "transport-failed",
            generationId: null,
            usage: ZERO_USAGE,
            latencyMs: performance.now() - startedAt,
            cfRay: null,
            xRequestId: null,
            settledGeneration: null,
            error: describeError(error),
          },
          null,
        );
        if (call.signal.aborted) {
          throw new AbortRunError(
            `run aborted during tokencamp request (${call.instanceId} epoch ${call.epoch}): ${describeError(error)}`,
            call.instanceId,
            call.epoch,
          );
        }
        lastError = describeError(error);
      }
      if (tryIndex < this.#maxAttempts) {
        await this.#backoff(tryIndex, call);
      }
    }

    throw new TransportFailedError(
      `tokencamp transport exhausted after ${this.#maxAttempts} attempts (${call.instanceId} epoch ${call.epoch}): ${lastError}`,
      call.instanceId,
      call.epoch,
    );
  }

  #requestHeaders(traceId: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      "Content-Type": "application/json",
      "X-Tokencamp-Trace": traceId,
      "X-Title": this.#appName,
    };
    if (this.#appUrl !== null) {
      headers["HTTP-Referer"] = this.#appUrl;
    }
    return headers;
  }

  #buildRequestBody(call: GenerateCall): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: call.model,
      messages: call.messages.map((message: ChatMessage) => this.#toWireMessage(message)),
      temperature: call.temperature,
      stream: false,
    };
    if (call.tools !== undefined) {
      body.tools = call.tools;
    }
    return body;
  }

  #toWireMessage(message: ChatMessage): Record<string, unknown> {
    if (message.role === "assistant" && message.toolCalls !== undefined) {
      return {
        role: "assistant",
        content: message.content.length > 0 ? message.content : null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: { name: toolCall.name, arguments: toolCall.arguments },
        })),
      };
    }
    if (message.role === "tool") {
      return { role: "tool", tool_call_id: message.toolCallId ?? "", content: message.content };
    }
    return { role: message.role, content: message.content };
  }

  async #handleSuccess(
    call: GenerateCall,
    traceId: string,
    response: Response,
    startedAt: number,
  ): Promise<GenerateResult> {
    const cfRay = headerOr(response.headers, "cf-ray");
    const xRequestId = headerOr(response.headers, "x-request-id");
    let parsed: ChatCompletionResponse;
    try {
      parsed = (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      throw new Error(
        `tokencamp returned unparseable JSON for ${call.instanceId} epoch ${call.epoch}: ${describeError(error)}`,
      );
    }
    const choice = parsed.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const toolCalls = normalizeToolCalls(parsed);
    const usage = normalizeUsage(parsed.usage);
    const headerGenerationId = headerOr(response.headers, "x-tokencamp-generation-id");
    const generationId =
      headerGenerationId ??
      (typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null);
    const settledGeneration =
      generationId !== null && !call.signal.aborted
        ? await this.fetchGeneration(generationId)
        : null;
    const latencyMs = performance.now() - startedAt;
    const rawCall: AttemptRawCall = {
      traceId,
      status: "ok",
      generationId,
      usage,
      latencyMs,
      cfRay,
      xRequestId,
      settledGeneration,
      error: null,
    };
    this.#recordTry(call, rawCall, content);
    return {
      content,
      usage,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown",
      latencyMs,
      providerResponseId: generationId,
      traceId,
      taskId: headerOr(response.headers, "x-tokencamp-task-id"),
      costAttribution: settledGeneration,
      toolCalls,
    };
  }

  #recordTry(call: GenerateCall, rawCall: AttemptRawCall, output: string | null): void {
    const scope = this.#openScopes.get(attemptScopeKey(call.instanceId, call.epoch));
    if (scope !== undefined) {
      scope.recordCall(rawCall);
      return;
    }
    this.#ledger.recordStandalone(
      {
        runId: call.runId,
        benchmarkId: call.benchmarkId,
        model: call.model,
        instanceId: call.instanceId,
        epoch: call.epoch,
      },
      rawCall,
      output,
    );
  }

  /** Equal-jitter exponential backoff: base 1s ×2, cap 60s (retry policy, ticket #4). */
  async #backoff(tryIndex: number, call: GenerateCall): Promise<void> {
    const raw = Math.min(this.#backoffCapMs, this.#backoffBaseMs * 2 ** (tryIndex - 1));
    const delay = Math.round(raw * (0.5 + 0.5 * this.#randomFn()));
    const abortMessage = `run aborted during backoff (${call.instanceId} epoch ${call.epoch})`;
    let onAbort: (() => void) | null = null;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new AbortRunError(abortMessage, call.instanceId, call.epoch));
      if (call.signal.aborted) {
        onAbort();
        return;
      }
      call.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([this.#sleepFn(delay), aborted]);
    } finally {
      if (onAbort && !call.signal.aborted) {
        call.signal.removeEventListener("abort", onAbort);
      }
    }
  }
}
