import type { GenerateCall, GenerateResult, GenerationResolver } from "./types";

const STUB_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: 0,
  reasoningTokens: 0,
} as const;

/**
 * Placeholder resolver so the harness core runs end to end before the real
 * tokencamp adapter lands (generation-resolver ticket). It never talks to a
 * provider, costs nothing, and follows the trace-id convention the real
 * adapters must keep: `<runId>.<epoch>.<instanceId>.<attempt>`.
 */
export class StubGenerationResolver implements GenerationResolver {
  readonly #attempts = new Map<string, number>();

  providerFor(_modelId: string): string {
    return "stub";
  }

  async generate(call: GenerateCall): Promise<GenerateResult> {
    const key = `${call.instanceId}#${call.epoch}`;
    const attempt = (this.#attempts.get(key) ?? 0) + 1;
    this.#attempts.set(key, attempt);

    const startedAt = performance.now();
    return {
      content: `stub response for ${call.benchmarkId}/${call.instanceId} epoch ${call.epoch}`,
      usage: STUB_USAGE,
      finishReason: "stop",
      latencyMs: performance.now() - startedAt,
      providerResponseId: `stub-${attempt}`,
      traceId: `${call.runId}.${call.epoch}.${call.instanceId}.${attempt}`,
      taskId: null,
      costAttribution: null,
    };
  }
}
