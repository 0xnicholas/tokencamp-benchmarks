import { describe, expect, test } from "bun:test";
import { AttemptLedger } from "../attempts";
import { TokencampResolver } from "./tokencamp";
import { AbortRunError, TransportFailedError } from "../errors";
import type { AttemptRecord, GenerateCall, ToolDefinition, Usage } from "../types";

function makeCall(overrides: Partial<GenerateCall> = {}): GenerateCall {
  return {
    runId: "run",
    benchmarkId: "fake",
    instanceId: "inst",
    epoch: 1,
    model: "zhipu/glm-5.3-flash",
    temperature: 0,
    messages: [{ role: "user", content: "hi" }],
    signal: new AbortController().signal,
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(queue: Array<() => Promise<Response>>, calls: FetchCall[]): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = queue.shift();
    if (!next) {
      throw new Error(`unexpected fetch #${calls.length}: ${String(url)}`);
    }
    return next();
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const SETTLE_BODY = {
  id: "gen-1",
  cost_usd: 0.002,
  latency_ms: 42,
  served_model: "zhipu/glm-5.3-flash",
};

function completionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "chatcmpl-1",
    model: "zhipu/glm-5.3-flash",
    choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    ...overrides,
  };
}

function completionResponse(
  body: Record<string, unknown> = completionBody(),
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(body, 200, {
    "x-tokencamp-generation-id": "gen-1",
    "x-tokencamp-task-id": "task-9",
    "cf-ray": "ray-1",
    "x-request-id": "req-1",
    ...headers,
  });
}

function okRun(
  body: Record<string, unknown> = completionBody(),
  responseHeaders: Record<string, string> = {},
): Array<() => Promise<Response>> {
  return [
    () => Promise.resolve(completionResponse(body, responseHeaders)),
    () => Promise.resolve(jsonResponse(SETTLE_BODY)),
  ];
}

function setup(
  queue: Array<() => Promise<Response>>,
  overrides: Partial<ConstructorParameters<typeof TokencampResolver>[0]> = {},
): {
  resolver: TokencampResolver;
  calls: FetchCall[];
  ledger: AttemptLedger;
  rows: AttemptRecord[];
} {
  const calls: FetchCall[] = [];
  const rows: AttemptRecord[] = [];
  const ledger = new AttemptLedger({ onAttempt: (record) => rows.push(record) });
  const resolver = new TokencampResolver({
    apiKey: "test-key",
    baseUrl: "https://gateway.test",
    fetchFn: fakeFetch(queue, calls),
    sleepFn: () => Promise.resolve(),
    randomFn: () => 0,
    ledger,
    ...overrides,
  });
  return { resolver, calls, ledger, rows };
}

function makeResolver(
  overrides: Partial<ConstructorParameters<typeof TokencampResolver>[0]> = {},
): TokencampResolver {
  return setup([], overrides).resolver;
}

describe("TokencampResolver startup validation", () => {
  test("fromEnv throws before anything runs when TOKENCAMP_API_KEY is missing", () => {
    expect(() => TokencampResolver.fromEnv({})).toThrow(/TOKENCAMP_API_KEY/);
  });

  test("fromEnv throws before anything runs when TOKENCAMP_BASE_URL is missing", () => {
    expect(() => TokencampResolver.fromEnv({ TOKENCAMP_API_KEY: "k" })).toThrow(
      /TOKENCAMP_BASE_URL/,
    );
  });

  test("fromEnv rejects a non-URL base url", () => {
    expect(() =>
      TokencampResolver.fromEnv({ TOKENCAMP_API_KEY: "k", TOKENCAMP_BASE_URL: "not a url" }),
    ).toThrow(/TOKENCAMP_BASE_URL/);
  });

  test("fromEnv accepts a valid environment and trims the base url", () => {
    const resolver = TokencampResolver.fromEnv({
      TOKENCAMP_API_KEY: "k",
      TOKENCAMP_BASE_URL: "https://gateway.test/",
    });
    expect(resolver).toBeInstanceOf(TokencampResolver);
  });

  test("the constructor refuses an empty api key", () => {
    expect(() => makeResolver({ apiKey: "" })).toThrow(/TOKENCAMP_API_KEY/);
  });

  test("virtual routing ids are banned before any request is made", async () => {
    const resolver = makeResolver();
    for (const model of ["tokencamp/auto", "forge/custom-route"]) {
      await expect(resolver.generate(makeCall({ model }))).rejects.toThrow(/virtual routing/i);
    }
  });

  test("providerFor is always tokencamp — one adapter routes every matrix model", () => {
    expect(makeResolver().providerFor("zhipu/glm-5.3-flash")).toBe("tokencamp");
  });
});

describe("TokencampResolver.generate happy path", () => {
  test("sends the OpenAI-compatible request with catalog id passthrough, trace, and app-identity headers", async () => {
    const { resolver, calls } = setup(okRun());
    await resolver.generate(makeCall());

    expect(calls).toHaveLength(2);
    const [completion, settle] = calls;
    expect(completion!.url).toBe("https://gateway.test/v1/chat/completions");
    expect(completion!.init.method).toBe("POST");
    const headers = completion!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Tokencamp-Trace"]).toBe("run.1.inst.1");
    expect(headers["X-Title"]).toBe("tokencamp-benchmarks");
    expect(headers["HTTP-Referer"]).toBe("https://github.com/0xnicholas/tokencamp-benchmarks");
    expect(completion!.init.signal).toBeInstanceOf(AbortSignal);
    expect(completion!.init.body).toEqual(
      JSON.stringify({
        model: "zhipu/glm-5.3-flash",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0,
        stream: false,
      }),
    );
    expect(settle!.url).toBe("https://gateway.test/v1/generation/gen-1");
    expect(settle!.init.method).toBe("GET");
    expect((settle!.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  test("maps the completion response onto the resolver result", async () => {
    const { resolver } = setup(okRun());
    const result = await resolver.generate(makeCall());

    expect(result.content).toBe("hello");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
    });
    expect(result.providerResponseId).toBe("gen-1");
    expect(result.taskId).toBe("task-9");
    expect(result.traceId).toBe("run.1.inst.1");
    expect(result.toolCalls).toEqual([]);
    expect(result.costAttribution).toEqual(SETTLE_BODY);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("falls back to the body id for the generation id when no header exists", async () => {
    const { resolver } = setup([
      () =>
        Promise.resolve(completionResponse(completionBody(), { "x-tokencamp-generation-id": "" })),
      () => Promise.resolve(jsonResponse(SETTLE_BODY)),
    ]);
    const result = await resolver.generate(makeCall());
    expect(result.providerResponseId).toBe("chatcmpl-1");
  });

  test("leaves taskId null when the gateway sends none", async () => {
    const { resolver } = setup([
      () => Promise.resolve(completionResponse(completionBody(), { "x-tokencamp-task-id": "" })),
      () => Promise.resolve(jsonResponse(SETTLE_BODY)),
    ]);
    const result = await resolver.generate(makeCall());
    expect(result.taskId).toBeNull();
  });

  test("captures cf-ray, x-request-id, and the settle record into the attempt row's raw call", async () => {
    const { resolver, rows } = setup(okRun());
    await resolver.generate(makeCall());

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe("ok");
    expect(row.output).toBe("hello");
    expect(row.attempt).toBe(1);
    expect(row.traceId).toBe("run.1.inst.1");
    expect(row.rawCalls).toHaveLength(1);
    const rawCall = row.rawCalls[0]!;
    expect(rawCall.generationId).toBe("gen-1");
    expect(rawCall.cfRay).toBe("ray-1");
    expect(rawCall.xRequestId).toBe("req-1");
    expect(rawCall.settledGeneration).toEqual(SETTLE_BODY);
    expect(rawCall.error).toBeNull();
  });

  test("normalizes camelCase usage", async () => {
    const { resolver } = setup(
      okRun(
        completionBody({
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            cacheReadInputTokens: 3,
            cacheWriteInputTokens: 2,
            reasoningTokens: 4,
          },
        }),
      ),
    );
    const result = await resolver.generate(makeCall());
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadInputTokens: 3,
      cacheWriteInputTokens: 2,
      reasoningTokens: 4,
    } satisfies Usage);
  });

  test("normalizes snake_case usage", async () => {
    const { resolver } = setup(
      okRun(
        completionBody({
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            cache_read_input_tokens: 3,
            cache_write_input_tokens: 2,
            reasoning_tokens: 4,
          },
        }),
      ),
    );
    const result = await resolver.generate(makeCall());
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadInputTokens: 3,
      cacheWriteInputTokens: 2,
      reasoningTokens: 4,
    } satisfies Usage);
  });

  test("normalizes OpenAI-style prompt/completion token details", async () => {
    const { resolver } = setup(
      okRun(
        completionBody({
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 3 },
            completion_tokens_details: { reasoning_tokens: 4 },
          },
        }),
      ),
    );
    const result = await resolver.generate(makeCall());
    expect(result.usage).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      cacheReadInputTokens: 3,
      cacheWriteInputTokens: 0,
      reasoningTokens: 4,
    } satisfies Usage);
  });

  test("defaults missing usage fields to zero", async () => {
    const { resolver } = setup(okRun(completionBody({ usage: {} })));
    const result = await resolver.generate(makeCall());
    expect(result.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
    } satisfies Usage);
  });
});

describe("TokencampResolver retry and abort policy", () => {
  test("retries a 429 with equal-jitter backoff, one attempt row per try", async () => {
    const sleeps: number[] = [];
    const { resolver, calls, rows } = setup(
      [() => Promise.resolve(new Response("rate limited", { status: 429 })), ...okRun()],
      {
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    const result = await resolver.generate(makeCall());

    expect(result.content).toBe("hello");
    expect(calls).toHaveLength(3); // 429 + completion + settle
    expect(sleeps).toEqual([500]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe("transport-failed");
    expect(rows[0]!.traceId).toBe("run.1.inst.1");
    expect(rows[0]!.rawCalls[0]!.error).toBe("HTTP 429: rate limited");
    expect(rows[1]!.status).toBe("ok");
    expect(rows[1]!.traceId).toBe("run.1.inst.2");
    expect(result.traceId).toBe("run.1.inst.2");
  });

  test("exhausts retries on persistent 429 and throws TransportFailedError", async () => {
    const sleeps: number[] = [];
    const { resolver, rows } = setup(
      [
        () => Promise.resolve(new Response("rate limited", { status: 429 })),
        () => Promise.resolve(new Response("rate limited", { status: 429 })),
        () => Promise.resolve(new Response("rate limited", { status: 429 })),
      ],
      {
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    await expect(resolver.generate(makeCall())).rejects.toThrow(TransportFailedError);
    expect(sleeps).toEqual([500, 1000]);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.status === "transport-failed")).toBe(true);
  });

  test("retries 5xx and 408 responses as transport errors", async () => {
    for (const status of [500, 408]) {
      const { resolver, calls } = setup([
        () => Promise.resolve(new Response("upstream", { status })),
        ...okRun(),
      ]);
      const result = await resolver.generate(makeCall());
      expect(result.content).toBe("hello");
      expect(calls).toHaveLength(3);
    }
  });

  test("caps the backoff delay at backoffCapMs", async () => {
    const sleeps: number[] = [];
    const { resolver } = setup(
      [
        () => Promise.resolve(new Response("rate limited", { status: 429 })),
        () => Promise.resolve(new Response("rate limited", { status: 429 })),
        () => Promise.resolve(new Response("rate limited", { status: 429 })),
      ],
      {
        backoffBaseMs: 1000,
        backoffCapMs: 1000,
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
      },
    );
    await expect(resolver.generate(makeCall())).rejects.toThrow(TransportFailedError);
    expect(sleeps).toEqual([500, 500]);
  });

  test("aborts the run without retrying on systemic 4xx responses", async () => {
    for (const status of [400, 401, 403, 404, 402]) {
      const { resolver, calls, rows } = setup([
        () => Promise.resolve(new Response("bad request", { status })),
      ]);
      await expect(resolver.generate(makeCall())).rejects.toThrow(AbortRunError);
      expect(calls).toHaveLength(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("systemic-error");
      expect(rows[0]!.rawCalls[0]!.error).toBe(`HTTP ${status}: bad request`);
    }
  });

  test("treats a request timeout as transport and retries", async () => {
    const calls: FetchCall[] = [];
    let requests = 0;
    const fetchFn: typeof fetch = (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      requests++;
      if (requests === 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if ((init?.signal as AbortSignal | undefined)?.aborted) {
          throw new Error("The operation was aborted");
        }
        return jsonResponse(completionBody());
      }
      return completionResponse();
    }) as typeof fetch;
    const { resolver, rows } = setup([], { fetchFn, requestTimeoutMs: 10 });
    const result = await resolver.generate(makeCall());

    expect(result.content).toBe("hello");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe("transport-failed");
    expect(rows[1]!.status).toBe("ok");
  });

  test("aborts during backoff when the run is cancelled", async () => {
    const controller = new AbortController();
    const { resolver, calls, rows } = setup(
      [() => Promise.resolve(new Response("rate limited", { status: 429 }))],
      { sleepFn: async () => controller.abort() },
    );
    await expect(resolver.generate(makeCall({ signal: controller.signal }))).rejects.toThrow(
      AbortRunError,
    );
    expect(calls).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  test("aborts before any request when the caller signal is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { resolver, calls, rows } = setup([]);
    await expect(resolver.generate(makeCall({ signal: controller.signal }))).rejects.toThrow(
      AbortRunError,
    );
    expect(calls).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });
});

describe("TokencampResolver agentic tool seam", () => {
  const TOOLS = [
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List the repo tree",
        parameters: { type: "object", properties: {} },
      },
    },
  ] satisfies readonly ToolDefinition[];

  test("passes tools through and maps returned tool_calls onto the result", async () => {
    const { resolver, calls } = setup(
      okRun(
        completionBody({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: { name: "list_files", arguments: '{"path":"."}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
      ),
    );
    const result = await resolver.generate(makeCall({ tools: TOOLS }));

    expect(JSON.parse(calls[0]!.init.body as string).tools).toEqual(TOOLS);
    expect(result.toolCalls).toEqual([
      { id: "call-1", name: "list_files", arguments: '{"path":"."}' },
    ]);
    expect(result.content).toBe("");
    expect(result.finishReason).toBe("tool_calls");
  });

  test("maps assistant tool_calls and tool results onto the wire format", async () => {
    const { resolver, calls } = setup(okRun());
    await resolver.generate(
      makeCall({
        messages: [
          { role: "user", content: "fix the bug" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call-1", name: "list_files", arguments: "{}" }],
          },
          { role: "tool", content: "src/a.ts", toolCallId: "call-1" },
        ],
      }),
    );
    expect(JSON.parse(calls[0]!.init.body as string).messages).toEqual([
      { role: "user", content: "fix the bug" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "list_files", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "src/a.ts" },
    ]);
  });

  test("accumulates an open epoch scope's calls into one attempt row (agentic)", async () => {
    const { resolver, ledger } = setup([...okRun(), ...okRun()]);
    const scope = resolver.beginAttempt({
      runId: "run",
      benchmarkId: "fake",
      model: "zhipu/glm-5.3-flash",
      instanceId: "inst",
      epoch: 1,
    });
    await resolver.generate(makeCall());
    await resolver.generate(makeCall());
    expect(ledger.snapshot()).toHaveLength(0);

    scope.finish({
      status: "ok",
      output: "patch-diff",
      usage: {
        inputTokens: 20,
        outputTokens: 10,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
        reasoningTokens: 0,
      },
      latencyMs: 100,
      providerResponseId: "gen-1",
    });

    const rows = ledger.snapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attempt).toBe(1);
    expect(rows[0]!.status).toBe("ok");
    expect(rows[0]!.output).toBe("patch-diff");
    expect(rows[0]!.traceId).toBe("run.1.inst.1");
    expect(rows[0]!.rawCalls.map((rawCall) => rawCall.traceId)).toEqual([
      "run.1.inst.1",
      "run.1.inst.2",
    ]);
    expect(rows[0]!.rawCalls.every((rawCall) => rawCall.generationId === "gen-1")).toBe(true);
  });

  test("returns to standalone rows once the scope finishes", async () => {
    const { resolver, ledger } = setup([...okRun(), ...okRun()]);
    const scope = resolver.beginAttempt({
      runId: "run",
      benchmarkId: "fake",
      model: "zhipu/glm-5.3-flash",
      instanceId: "inst",
      epoch: 1,
    });
    await resolver.generate(makeCall());
    scope.finish({ status: "ok" });
    await resolver.generate(makeCall());

    const rows = ledger.snapshot();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.rawCalls).toHaveLength(1);
    expect(rows[1]!.attempt).toBe(2);
    expect(rows[1]!.traceId).toBe("run.1.inst.2");
  });
});

describe("TokencampResolver settle reconciliation", () => {
  test("a settle fetch failure is non-fatal and leaves the settle fields null", async () => {
    const { resolver, rows } = setup([
      () => Promise.resolve(completionResponse()),
      () => Promise.reject(new Error("settle endpoint down")),
    ]);
    const result = await resolver.generate(makeCall());
    expect(result.content).toBe("hello");
    expect(result.costAttribution).toBeNull();
    expect(rows[0]!.rawCalls[0]!.settledGeneration).toBeNull();
    expect(rows[0]!.rawCalls[0]!.generationId).toBe("gen-1");
  });

  test("a non-ok settle response also leaves the fields null", async () => {
    const { resolver, rows } = setup([
      () => Promise.resolve(completionResponse()),
      () => Promise.resolve(new Response("gone", { status: 404 })),
    ]);
    const result = await resolver.generate(makeCall());
    expect(result.costAttribution).toBeNull();
    expect(rows[0]!.rawCalls[0]!.settledGeneration).toBeNull();
  });

  test("falls back to the body id for the settle URL when no generation header exists", async () => {
    const { resolver, calls } = setup([
      () =>
        Promise.resolve(completionResponse(completionBody(), { "x-tokencamp-generation-id": "" })),
      () => Promise.resolve(jsonResponse(SETTLE_BODY)),
    ]);
    await resolver.generate(makeCall());
    expect(calls[1]!.url).toBe("https://gateway.test/v1/generation/chatcmpl-1");
  });
});
