# Model matrix landscape — fact sheet

Snapshot date: **2026-11-24**. Facts only; no model picks. Ticket: *"Which models and providers does v1 benchmark?"*

Scope: the candidate landscape for a Matrix that runs MMLU-Pro-scale runs (≈12k single-shot calls per model) through the harness's three adapter families (`openrouter/`, `anthropic/`, `openai/`). Prices are USD per 1M tokens, list rates, no negotiated discounts.

## How to read this

**Source status.** Several vendor pricing pages could not be read from this network on 2026-11-24 and were substituted, never guessed:

| Source | Result | Used instead |
|---|---|---|
| `platform.claude.com/docs/en/about-claude/pricing` | region-blocked ("App unavailable in region") | Anthropic model launch posts (read directly) + OpenRouter catalog |
| `platform.openai.com/docs/pricing` | HTTP 403 | OpenAI launch post (read directly) + OpenRouter catalog |
| `ai.google.dev/gemini-api/docs/pricing`, `cloud.google.com/vertex-ai/...` | connection timeout | OpenRouter catalog only |
| `mistral.ai/pricing`, `docs.x.ai/docs/models` | connection reset / timeout | OpenRouter catalog only |
| `huggingface.co` (license + open-weight check) | connection timeout | OpenRouter `hugging_face_id` field only |

Read directly and treated as authoritative: Anthropic launch posts (`anthropic.com/news/*`), the OpenAI GPT-6.2 launch post, `api-docs.deepseek.com`, `aws.amazon.com/bedrock/pricing`, and the OpenRouter API (`openrouter.ai/api/v1/models`, 473 models, fetched 2026-11-24).

**Model ids.** Vendor ids and OpenRouter ids are *not* the same string for Anthropic. Anthropic's API uses hyphens (`claude-opus-5-5`); OpenRouter spells the same model with dots (`anthropic/claude-opus-5.5`). Rows below give the id for the route in the Family column.

**Dated snapshots.** OpenRouter's `canonical_slug` carries the snapshot date compacted (`claude-opus-5.5-20260921`, `gpt-6.2-astra-20261117`). Whether the vendor's own API accepts that exact string was not verifiable through a blocked docs site; Anthropic's historical convention is `claude-<family>-<ver>-YYYYMMDD` and OpenAI's is `<model>-YYYY-MM-DD`. Treat "dated id" as *catalog evidence of the snapshot*, and confirm the literal string against `GET /v1/models` before pinning.

## Summary table

### Frontier tier

| Display name | Exact API model id | Family | In $/1M | Out $/1M | Cache read $/1M | Provenance | Notes |
|---|---|---|---|---|---|---|---|
| Claude Fable 5.2 | `claude-fable-5-2` | anthropic | 8.00 | 40.00 | 0.20 | [anthropic.com/claude-fable-and-mythos-5-2](https://www.anthropic.com/claude-fable-and-mythos-5-2) | 2026-11-09. Anthropic's top model. 1M ctx, 128k max out. Cache write $10. Batch 50% ($4/$20). Fast mode $16/$80. `claude-mythos-5-2` is the same weights with fewer safeguards, gated (Bedrock: approval required). OR id `anthropic/claude-fable-5.2` ($8/$40, cache read $0.20). |
| Claude Opus 5.5 | `claude-opus-5-5` | anthropic | 4.00 | 20.00 | 0.20 | [anthropic.com/news/claude-opus-5-5](https://www.anthropic.com/news/claude-opus-5-5) | 2026-09-22. 20% below Opus 5 ($5/$25). 1M ctx. Cache write $5. Batch 50%. Fast mode $8/$40. OR lists a second Anthropic endpoint at 2× ($8/$40); the tier is unnamed, and Anthropic's 4.x precedent was a long-context surcharge. Snapshot suffix `20260921`. |
| GPT-6.2 Astra | `gpt-6.2-astra` | openai | 8.00 | 40.00 | 0.40 | [openai.com/index/introducing-gpt-6-2-astra-sol](https://openai.com/index/introducing-gpt-6-2-astra-sol/) | 2026-11-17. 1.05M ctx, 128k max out. "20% lower than GPT-6 Astra, 60% discount on cached input". Batch 50%. OR canonical `gpt-6.2-astra-20261117`. |
| Gemini 4 Argon | `google/gemini-4-argon` | openrouter | 2.00 | 10.00 | 0.10 | [openrouter.ai/models/google/gemini-4-argon](https://openrouter.ai/models/google/gemini-4-argon) | 2026-10-13. OR positioning: "Google's flagship reasoning model". 1.05M ctx, 943k max out. Batch 50%. Google-native id unverified. |
| Grok 4.7 | `x-ai/grok-4.7` | openrouter | 2.00 | 6.00 | 0.50 | [openrouter.ai/models/x-ai/grok-4.7](https://openrouter.ai/models/x-ai/grok-4.7) | 2026-09-21. 500k ctx, 450k max out. OR lists the provider as **SpaceXSI**; model prefix is still `x-ai/`. Batch 20% off ($1.60/$4.80). |
| Qwen4 Max | `qwen/qwen4-max` | openrouter | 1.425 | 4.275 | 0.0713 | [openrouter.ai/models/qwen/qwen4-max](https://openrouter.ai/models/qwen/qwen4-max) | 2026-11-16. 1M ctx, 131k max out. Proprietary (no HF id). Cache write $1.78. |
| Muse Wonder | `meta/muse-wonder` | openrouter | 4.00 | 20.00 | 0.20 | [openrouter.ai/models/meta/muse-wonder](https://openrouter.ai/models/meta/muse-wonder) | 2026-10-12. Meta's 2026 frontier line; 1M ctx. Open-weight status not confirmed. |
| DeepSeek V4 Pro | `deepseek-v4-pro` | openrouter (also direct) | 1.32 peak / 0.66 off-peak | 3.96 peak / 1.98 off-peak | 0.044 peak / 0.022 off-peak | [api-docs.deepseek.com/quick_start/pricing](https://api-docs.deepseek.com/quick_start/pricing) | Model version `DeepSeek-V4-Pro-0813`. 1M ctx, 384k max out, concurrency 500. Off-peak = half rate. OR route `deepseek/deepseek-v4-pro-0813` prices differently ($0.111/$4.44) — see OpenRouter section. |

### Mid tier

| Display name | Exact API model id | Family | In $/1M | Out $/1M | Cache read $/1M | Provenance | Notes |
|---|---|---|---|---|---|---|---|
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | anthropic | 2.00 | 10.00 | 0.10 | [anthropic.com/news/claude-sonnet-5-5](https://www.anthropic.com/news/claude-sonnet-5-5) | 2026-09-28. Cache read halved from $0.20 on 2026-10-07. Cache write $2.50. Batch 50%. 1M ctx. |
| GPT-6.2 Sol | `gpt-6.2-sol` | openai | 2.00 | 10.00 | 0.10 | [openai.com/index/introducing-gpt-6-2-astra-sol](https://openai.com/index/introducing-gpt-6-2-astra-sol/) | 2026-11-17. "Carries forward GPT-6.1 Sol's rates". 1.05M ctx. OR publishes 2× and 3× endpoints ($4/$20, $6/$30) for service tiers. |
| GPT-6.1 Terra | `gpt-6.1-terra` | openai | 1.00 | 5.00 | 0.05 | [openrouter.ai/models/openai/gpt-6.1-terra](https://openrouter.ai/models/openai/gpt-6.1-terra) | 2026-10-26. 1.05M ctx. One tier below Sol. |
| Gemini 4 Carbon | `google/gemini-4-carbon` | openrouter | 2.00 | 10.00 | 0.10 | [openrouter.ai/models/google/gemini-4-carbon](https://openrouter.ai/models/google/gemini-4-carbon) | 2026-11-10. "Frontier Gemini 4 model for coding, agentic and complex reasoning". 1.05M ctx. Batch 50%. |
| Gemini 4 Hydrogen | `google/gemini-4-hydrogen` | openrouter | 1.50 | 7.50 | 0.075 | [openrouter.ai/models/google/gemini-4-hydrogen](https://openrouter.ai/models/google/gemini-4-hydrogen) | 2026-11-12. OR positioning: "high-efficiency workhorse". 1.05M ctx. |
| Gemini 3.8 Flash | `google/gemini-3.8-flash` | openrouter | 0.825 | 4.125 | 0.0825 | [openrouter.ai/models/google/gemini-3.8-flash](https://openrouter.ai/models/google/gemini-3.8-flash) | 2026-09-02. Prior-generation Flash, still cheaper than Gemini 4 Hydrogen. 64k max out. |
| Kimi K3.1 Pro | `moonshotai/kimi-k3.1-pro` | openrouter | 0.2403 | 8.4023 | 0.20 | [openrouter.ai/models/moonshotai/kimi-k3.1-pro](https://openrouter.ai/models/moonshotai/kimi-k3.1-pro) | 2026-10-23. Open weight (HF `moonshotai/Kimi-K3.1-Pro`). 1M ctx. Asymmetric price: cheap in, expensive out. |
| Mistral Large 4 | `mistralai/mistral-large-4-0` | openrouter | 0.70 | 2.10 | 0.07 | [openrouter.ai/models/mistralai/mistral-large-4-0](https://openrouter.ai/models/mistralai/mistral-large-4-0) | 2026-10-06. Open weight (HF `mistralai/Mistral-Large-4-1T-A52B`, 1T total / 52B active). 1M ctx. License unverified (HF unreachable). |
| Muse Spark 1.3 | `meta/muse-spark-1.3` | openrouter | 1.25 | 4.25 | 0.15 | [openrouter.ai/models/meta/muse-spark-1.3](https://openrouter.ai/models/meta/muse-spark-1.3) | 2026-09-02. 1M ctx. `meta/muse-spark-open` (2026-10-15, 816B-A42B) is the explicitly open-weight sibling at the same price. |

### Cheap tier

| Display name | Exact API model id | Family | In $/1M | Out $/1M | Cache read $/1M | Provenance | Notes |
|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | `claude-haiku-5-5` | anthropic | 0.10 | 0.50 | 0.01 | [anthropic.com/news/claude-haiku-5-5](https://www.anthropic.com/news/claude-haiku-5-5) | 2026-10-07. **Price doubles above a 100k-token prompt** ($0.50/$2.50, cache read $0.05, cache write $0.625). Below 100k: cache write $0.125. Batch 50%. |
| GPT-6 Luna | `gpt-6-luna` | openai | 0.10 | 0.50 | 0.01 | [openrouter.ai/models/openai/gpt-6-luna](https://openrouter.ai/models/openai/gpt-6-luna) | 2026-09-22. 1.05M ctx. Cheapest current OpenAI tier. |
| Gemini 3.1 Flash Lite | `google/gemini-3.1-flash-lite` | openrouter | 0.25 | 1.50 | 0.025 | [openrouter.ai/models/google/gemini-3.1-flash-lite](https://openrouter.ai/models/google/gemini-3.1-flash-lite) | 2026-05-07. 1.05M ctx, 65k max out. |
| Gemini 3.5 Flash Lite | `google/gemini-3.5-flash-lite` | openrouter | 0.30 | 2.50 | 0.03 | [openrouter.ai/models/google/gemini-3.5-flash-lite](https://openrouter.ai/models/google/gemini-3.5-flash-lite) | 2026-07-21. Newer than 3.1 Lite but ~2× the output price. |
| DeepSeek V4.1 Flash | `deepseek-flash` | openrouter (also direct) | 0.30 peak / 0.15 off-peak | 1.20 peak / 0.60 off-peak | 0.006 peak / 0.003 off-peak | [api-docs.deepseek.com/quick_start/pricing](https://api-docs.deepseek.com/quick_start/pricing) | Version `DeepSeek-V4.1-Flash-1017`. 1M ctx, 384k max out, concurrency 2500. Legacy aliases `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` retired → served as this model. |
| Qwen3.8 Flash | `qwen/qwen3.8-flash` | openrouter | 0.15 | 0.47 | 0.016 | [openrouter.ai/models/qwen/qwen3.8-flash](https://openrouter.ai/models/qwen/qwen3.8-flash) | 2026-08-26. Open weight (HF `Qwen/Qwen3.8-Flash-Next`). 1M ctx. |
| Mistral Small 4 | `mistralai/mistral-small-2603` | openrouter | 0.15 | 0.60 | 0.015 | [openrouter.ai/models/mistralai/mistral-small-2603](https://openrouter.ai/models/mistralai/mistral-small-2603) | 2026-03-16. 262k ctx. Dated id embedded (`2603` = 2026-03). |
| Muse Ember | `meta/muse-ember` | openrouter | 0.10 | 0.50 | 0.004 | [openrouter.ai/models/meta/muse-ember](https://openrouter.ai/models/meta/muse-ember) | 2026-11-09. "Smallest and most efficient" Meta model; 1M ctx. |
| MiniMax M3.1 Flash | `minimax/minimax-m3.1-flash` | openrouter | 0.075 | 0.30 | 0.0075 | [openrouter.ai/models/minimax/minimax-m3.1-flash](https://openrouter.ai/models/minimax/minimax-m3.1-flash) | 2026-10-19. 1M ctx. |

Cheap-tier floor reference: `nvidia/nemotron-3.5-lightning` ($0.05/$0.20, 2026-08-11), `openai/gpt-oss-120b` ($0.05/$0.25, 2025-08-05, open weights via HF id).

## Provider sections

### Anthropic

Lineup (2026): **Fable** (top) → **Mythos** (same weights, gated) → **Opus** → **Sonnet** → **Haiku**.

| Date | Event | Price signal |
|---|---|---|
| 2026-06-09 | Claude Fable 5 appears in OR catalog (`anthropic/claude-5-fable-20260609`) | $10/$50 |
| 2026-06-30 | Claude Sonnet 5 | $2/$10 |
| 2026-07-24 | Claude Opus 5 | $5/$25 |
| 2026-09-01 | Claude Fable 5.1 | $10/$50 |
| 2026-09-22 | **Opus 5.5** — "requires less compute to serve than Opus 5"; 20% price cut | $4/$20, cache read $0.20, cache write $5 |
| 2026-09-28 | **Sonnet 5.5** — same price as Sonnet 5 | $2/$10, cache read $0.10 |
| 2026-10-07 | **Haiku 5.5** — ~90% cheaper than Haiku 4.5 for ≤100k prompts; same day, Sonnet 5.5 cache reads halved | $0.10/$0.50 |
| 2026-11-09 | **Fable 5.2 + Mythos 5.2** — "up to 30% faster", lower price than Fable 5.1 | $8/$40 |

Structural facts:
- Cache economics: cache write = 1.25× input for the 5-minute cache, 2× for the 1-hour cache; cache read = 5% of input on Fable/Opus/Sonnet 5.5, 10% on Haiku 5.5. 5m/1h write pairs: Fable 5.2 $10/$16, Opus 5.5 $5/$8, Sonnet 5.5 $2.50/$4, Haiku 5.5 $0.125/$0.20.
- Batch API: 50% on all four, mirrored by OR as `:batch` variants.
- Context: 1M on all current models; 128k max output.
- Fast mode (2.5× generation speed): Opus 5.5 $8/$40, Fable 5.2 $16/$80. Not useful for batch-style benchmarking except as a latency lever.
- Model id format is hyphenated (`claude-opus-5-5`). Anthropic's dated-snapshot convention from 4.x was `claude-<family>-<ver>-YYYYMMDD`; OR's canonical slugs for 5.x are compact (`claude-opus-5.5-20260921`), so the literal dated id needs confirmation from the API.
- Pricing page (`platform.claude.com/docs/en/about-claude/pricing`) was region-blocked; figures above come from the launch posts, which is why each row cites one.

### OpenAI

Naming changed twice in 2026: numeric family + a tier word (`Sol`, `Terra`, `Luna`) plus `-pro` variants, and a separate `Astra` prefix family at the top.

| Date | Event | Price signal |
|---|---|---|
| 2026-07-09 | GPT-5.6 family (Sol / Terra / Luna) | Sol $4/$20, Terra $2/$12, Luna $0.20/$1.20 |
| 2026-09-04 | GPT-6 Astra family | $10/$50, cached input $1.00 |
| 2026-09-22 | GPT-6 Sol / GPT-6 Luna | Sol $2/$10, Luna $0.10/$0.50 |
| 2026-09-29 | GPT-6.1 Sol | $2/$10 |
| 2026-10-26 | GPT-6.1 Terra | $1/$5 |
| 2026-11-17 | **GPT-6.2 Astra + GPT-6.2 Sol** | Astra $8/$40 (cached $0.40), Sol $2/$10 (cached $0.10) |

Structural facts:
- Launch post: "GPT-6.2 Astra's input and output token prices are 20% lower than GPT-6 Astra's, with a 60% discount on cached input ($8 for input, $0.40 for cached input, and $40 for output)."
- Cached input = 5% of input across the 6.x line ($0.40 on Astra, $0.10 on Sol, $0.05 on Terra, $0.01 on Luna).
- Context 1.05M on all 6.x; 128k max output. Batch 50% (OR `:batch` at exactly half).
- OR exposes several OpenAI endpoints per model at **0.5×/1×/2×/3×/6× list** (GPT-6 Astra: $5/$25, $10/$50, $20/$100, $60/$300; Sol: $2/$10, $4/$20, $6/$30). These are service tiers — the 6× one lines up with the "Ultrafast" mode the 6.2 launch post mentions. The catalog headline price is the 1× rate; the 0.5× endpoint is a real half-price lever if the harness can tolerate slower responses.
- **Deprecation gotcha:** OR expiry metadata puts `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `o3`, `o3-pro` at **2026-12-11**. Pinning any of them outlives the benchmark window by ~2 weeks.
- Docs pricing page returned 403; prices above are from the 6.2 launch post and the OR catalog.

### Google (Gemini)

Not reachable from any Google pricing domain; entire section is OR-catalog evidence.

| Date | Model | In/Out | Positioning (OR description) |
|---|---|---|---|
| 2026-05-07 | Gemini 3.1 Flash Lite | $0.25/$1.50 | cheap |
| 2026-07-21 | Gemini 3.5 Flash Lite | $0.30/$2.50 | cheap |
| 2026-09-02 | Gemini 3.8 Flash | $0.825/$4.125 | "most intelligent Flash model" |
| 2026-10-13 | **Gemini 4 Argon** | $2/$10 | "flagship reasoning model" |
| 2026-11-10 | Gemini 4 Carbon | $2/$10 | "frontier Gemini 4 for coding/agentic" |
| 2026-11-12 | Gemini 4 Hydrogen | $1.50/$7.50 | "high-efficiency workhorse" |
| 2026-11-18 | Gemini 4 Neon | $3/$15 | "fast, mid-priced" (pricier than Argon despite the label) |

All Gemini 4 entries: 1.05M ctx, 943k max out, cache read 5% of input, batch 50%. Gemini 3.x Flash tiers cap output at 65k.

### xAI

Grok 4.20 (2026-03-31, 2M ctx) → 4.3 (2026-04-30, $1.25/$2.50) → 4.5 (2026-07-08) → 4.6 (2026-08-12) → **4.7 (2026-09-21)** at $2/$6, 500k ctx, cache read $0.50 (25% of input — the highest absolute cache-read price in the shortlist). OR labels the provider **SpaceXSI** in both the provider field and descriptions; the id prefix remains `x-ai/`. Batch is 20% off, not 50%.

### DeepSeek (open weight)

- Current API surface is two models: `deepseek-flash` (= `DeepSeek-V4.1-Flash-1017`) and `deepseek-v4-pro` (= `DeepSeek-V4-Pro-0813`). Legacy names `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` are retired and re-served by V4.1 Flash at Flash prices.
- **Peak/off-peak pricing.** Peak = 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri. Off-peak = half price, everything else including weekends and Chinese public holidays. A 12k-call run scheduled in UTC off-peak halves the bill.
- Cache hit pricing is very low: $0.006 (flash, peak) / $0.044 (pro, peak) per 1M.
- Context 1M, max output 384k, **concurrency limit 2500 (flash) / 500 (pro)** — the only vendor in this set that publishes an explicit concurrency number.
- Direct API also exposes an Anthropic-format base URL (`https://api.deepseek.com/anthropic`).

### Alibaba Qwen

| Date | Model | In/Out | Open weight? |
|---|---|---|---|
| 2026-02 | Qwen3.5 family (9B → 397B-A17B) | $0.07–$0.45 in | Yes (HF ids) |
| 2026-05-21 | Qwen3.7 Max | $1.475/$4.425 | No |
| 2026-08-26 | Qwen3.8 Flash | $0.15/$0.47 | Yes (`Qwen/Qwen3.8-Flash-Next`) |
| 2026-09-03 | Qwen3.8 Max | $2/$6 | No |
| 2026-11-16 | **Qwen4 Max** | $1.425/$4.275 | No (no HF id) |

Qwen4 Max is cheaper per input token than Qwen3.8 Max and is the current flagship. All 1M ctx. Cache read 5% on Qwen4 Max, 12.5% on 3.8 Max.

### Mistral

| Date | Model | In/Out | Open weight? |
|---|---|---|---|
| 2025-12-01 | Mistral Large 3 2512 (`Mistral-Large-3-675B-Instruct-2512`) | $0.50/$1.50 | Yes (HF id) |
| 2026-03-16 | Mistral Small 4 (`Mistral-Small-4-119B-2603`) | $0.15/$0.60 | Yes (HF id) |
| 2026-04-30 | Mistral Medium 3.5 | $1.50/$7.50 | Expires in OR 2027-01-31 |
| 2026-10-06 | **Mistral Large 4** (`Mistral-Large-4-1T-A52B`) | $0.70/$2.10 | Yes (HF id present) |

Large 4 is 1T total / 52B active, 1M ctx, and is priced below Mistral Medium 3.5 — the mid/small tiers are now the expensive ones per token. License text unverified.

### Meta

Llama branding stops at **Llama 4** (Maverick/Scout, 2025-04-05); no Llama 5 appears in the catalog 19 months later. Meta's 2026 line ships under **Muse**:

| Date | Model | In/Out | HF id (open weight) |
|---|---|---|---|
| 2026-07-16 | Muse Spark 1.1 | $1.25/$4.25 | — |
| 2026-08-05 | Muse Spark 1.2 | $1.25/$4.25 | — |
| 2026-08-09 | Muse Glimmer 30B | $0.35/$1.50 | — |
| 2026-09-02 | Muse Spark 1.3 | $1.25/$4.25 | — |
| 2026-10-12 | **Muse Wonder** (frontier) | $4/$20 | — |
| 2026-10-15 | Muse Spark Open | $1.25/$4.25 | `meta-models/Muse-Spark-Open-816B-A42B` |
| 2026-11-09 | Muse Ember | $0.10/$0.50 | — |

`Muse Spark Open` is the only Muse variant with a Hugging Face id, i.e. the only one the catalog evidences as open-weight. The HF org is `meta-models`, not `meta-llama`. License unverified. Llama 4 remains routable via `meta-llama/llama-4-maverick` ($0.35/$1.00) and `meta-llama/llama-4-scout` ($0.10/$0.30).

### Other open-weight families that emerged in 2025–2026

| Family | Current model | OR id | In/Out | HF id |
|---|---|---|---|---|
| Moonshot | Kimi K3.1 Pro | `moonshotai/kimi-k3.1-pro` | $0.24/$8.40 | `moonshotai/Kimi-K3.1-Pro` |
| Z.ai | GLM-5.3 | `z-ai/glm-5.3` | $0.07/$1.40 | `zai-org/GLM-5.3` |
| MiniMax | M3.1 Flash | `minimax/minimax-m3.1-flash` | $0.075/$0.30 | `MiniMaxAI/MiniMax-M3.1-Flash` |
| NVIDIA | Nemotron 3.5 Lightning | `nvidia/nemotron-3.5-lightning` | $0.05/$0.20 | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16` |
| Tencent | Hy4 | `tencent/hy4` | $0.42/$1.25 | `tencent/Hy4` |
| ByteDance | Seed 2.1 Turbo | `bytedance-seed/seed-2-1-turbo` | $0.50/$2.50 | — |
| Baidu | ERNIE 5.5 Flash Preview | `baidu/ernie-5.5-flash-preview:free` | $0 (free tier only) | `baidu/ERNIE-5.5-Flash-Preview` |
| Thinking Machines | Inkling 2 Mini | `thinkingmachines/inkling-2-mini` | $0.075/$0.30 | `thinkingmachines/Inkling-2-Mini` |
| InclusionAI | Ling 3.2 Flash | `inclusionai/ling-3.2-flash:free` | $0 (free tier only) | `inclusionAI/Ling-3.2-flash` |

Redistribution licenses for all of the above were **not verifiable** (huggingface.co unreachable). What the catalog does establish is which models have published weights at all — the `hugging_face_id` column above.

## OpenRouter specifics

- **Catalog size**: 473 models, fetched 2026-11-24 from `https://openrouter.ai/api/v1/models`. Fields include `pricing.prompt`, `pricing.completion`, `pricing.input_cache_read`, `pricing.input_cache_write`, `pricing.input_cache_write_1h`, `context_length`, `canonical_slug`, `expiration_date`, `hugging_face_id`.
- **Fees**: 5.5% ($0.80 minimum) on credit purchases; 5% for crypto; BYOK free allowance measured in list-price spend, then a fee pegged to what the same model would cost on OpenRouter ([docs/faq](https://openrouter.ai/docs/faq)). List prices themselves are pass-through.
- **Price divergence vs direct** is real in both directions. DeepSeek V4.1 Flash is $0.03/$0.20 on OR vs $0.30/$1.20 at DeepSeek peak rates (10× cheaper); DeepSeek V4 Pro is $0.111/$4.44 on OR's `-0813` route vs $1.32/$3.96 direct peak (cheaper input, dearer output). Anthropic/OpenAI/Google rows match the vendors' list prices wherever a vendor page was readable.
- **Variant suffixes**: `:batch` (50% off on Anthropic, OpenAI, Google; 20% on xAI; inconsistent elsewhere), `:free` (rate-limited free tier, not viable at 12k calls), `-pro`, `-preview`, `-customtools`.
- **Id spelling differs from vendor ids**: `anthropic/claude-opus-5.5` (dots) vs `claude-opus-5-5` (hyphens); `openai/gpt-6.2-astra` keeps dots on both sides. Any harness that composes `openrouter/<vendor>/<id>` must take the id from OR, not from the vendor.
- **Expiry metadata** is exposed per model (`expiration_date`) — use it to reject short-lived pins at config-validation time.
- **Rate limits** are account-global and model-specific, not per-key ("making additional accounts or API keys will not affect your rate limits"); limits are credit-based ([docs/api-reference/limits](https://openrouter.ai/docs/api-reference/limits)). No published RPM floor was found.

## 2025–2026 developments that move the tiers

1. **Anthropic cut prices twice in seven weeks** (2026-09-22 Opus 5.5 −20%, 2026-10-07 Haiku 5.5 −90% vs Haiku 4.5) and cut cache reads to 5% (from 10%) on Sonnet 5.5 on 2026-10-07. Cheap-tier input pricing at $0.10/M is 10× below Haiku 4.5's $1.00/M, which is still in the catalog.
2. **Anthropic split one model into two products**: Fable and Mythos 5.2 are the same weights; Mythos is gated to vetted cyber/bio organizations. A benchmark that pins "the best Anthropic model" gets Fable; Mythos is not generally callable.
3. **OpenAI renamed its tiers twice in five months** (GPT-5.6 → GPT-6 Astra/Sol/Luna → GPT-6.1 Sol/Terra → GPT-6.2 Astra/Sol) and put the original GPT-5 SKUs (`gpt-5`, `-mini`, `-nano`, `-pro`, `o3`, `o3-pro`) on 2026-12-11 expiry.
4. **Google went from Gemini 3.x to a four-SKU Gemini 4 family** (Argon/Carbon/Hydrogen/Neon) in five weeks (2026-10-13 → 2026-11-18), with the newest SKU (Neon, $3/$15) priced above the flagship (Argon, $2/$10).
5. **Price-per-quality compression**: frontier output prices fell from ~$50–60/M (GPT-6 Astra, Fable 5.1) to $20–40/M while mid-tier held at $10/M. Most 2026 flagships (Opus 5.5, Sonnet 5.5, GPT-6.2) shipped a token-efficiency claim alongside the price change, so per-token price no longer tracks per-task cost.
6. **Meta abandoned the Llama name for frontier work** — Muse (Jul–Nov 2026) — and shipped only one open-weight variant (`Muse Spark Open`).
7. **DeepSeek moved to time-of-day pricing** (peak/off-peak, half rate off-peak) — a benchmark's wall-clock schedule now changes its cost by 2×.
8. **Open-weight catch-up**: Kimi K3.1 Pro, GLM-5.3, Qwen3.8 Flash, Mistral Large 4 and Muse Spark Open all publish weights and sit inside the mid/cheap price bands.
9. **Batch APIs are universal at 50%** on the three US labs; at 12k single-shot calls this is the single largest cost lever after model choice.
10. **xAI's provider identity in the catalog changed to "SpaceXSI"** while model ids stayed `x-ai/`.

## Operational gotchas that could bite a 12k-call run

| Gotcha | Detail | Blocks a run? |
|---|---|---|
| Anthropic Haiku 5.5 long-prompt pricing | >100k-token prompt doubles every rate ($0.10→$0.50 input, $0.50→$2.50 output) | No at MMLU-Pro prompt sizes; matters if few-shot packs grow |
| Anthropic Opus 5.5 2× endpoint | OR lists a second endpoint at $8/$40 vs $4/$20 | Only above whatever threshold that tier uses |
| OpenAI GPT-5 family expiry | 2026-12-11 | Yes, if pinned — pick 6.x |
| DeepSeek concurrency | 2500 (flash) / 500 (pro) concurrent requests | No; 12k calls fit |
| DeepSeek peak windows | 01:00–04:00 and 06:00–10:00 UTC Mon–Fri cost 2× | No, but 2× cost |
| Context windows | 262k (Mistral Small 4) to 1.05M; Grok 4.7 sits at 500k | No |
| Max output | 128k Anthropic/OpenAI, 384k DeepSeek, 65k on Gemini 3.x Flash tiers | No |
| OpenRouter fees | 5.5% on credit purchase, not per call | No, but budget +5.5% |
| Batch APIs | 50% off, asynchronous (results returned later, not inline) | Not for latency-sensitive runs |

## Run-cost arithmetic (derived, not quoted)

`cost = calls × (in_tokens/1e6 × price_in + out_tokens/1e6 × price_out)`, 12,000 calls, no cache hits, no batch discount:

| Model | 500 in / 500 out | 500 in / 4,000 out |
|---|---|---|
| Claude Fable 5.2 / GPT-6.2 Astra | $288 | $1,968 |
| Claude Opus 5.5 / Muse Wonder | $144 | $984 |
| Gemini 4 Argon / Claude Sonnet 5.5 / GPT-6.2 Sol | $72 | $492 |
| Gemini 4 Hydrogen | $54 | $369 |
| Kimi K3.1 Pro | $52 | $405 |
| Grok 4.7 | $48 | $300 |
| GPT-6.1 Terra | $36 | $246 |
| Qwen4 Max | $34 | $214 |
| Mistral Large 4 | $17 | $105 |
| Gemini 3.5 Flash Lite | $17 | $122 |
| Gemini 3.1 Flash Lite | $10.50 | $74 |
| DeepSeek V4.1 Flash (peak) | $9 | $59 |
| Claude Haiku 5.5 / GPT-6 Luna / Muse Ember | $3.60 | $25 |
| Qwen3.8 Flash | $3.72 | $23 |
| MiniMax M3.1 Flash | $2.25 | $15 |

Output tokens dominate: moving from a 500-token to a 4,000-token completion multiplies the bill by 4.5× for models priced 1:1 input:output, up to 6.9× where output is 5× input (Haiku 5.5). Cheap-tier ranks can reorder between those two profiles.

## What is still unverified

- Literal dated snapshot ids for Anthropic 5.x and OpenAI 6.x (`GET /v1/models` on each provider is the ground truth; both docs sites were blocked).
- Google's native model ids and Google's own prices — every Gemini figure here is OpenRouter's.
- Licenses for every open-weight model (Apache-2.0 vs community vs custom) — huggingface.co was unreachable; only "weights are published" is established, via `hugging_face_id`.
- Mistral and xAI direct prices — both sites unreachable; OR prices used.
- Anthropic/OpenAI rate-limit tiers — not published on any page reachable here.
- Whether "SpaceXSI" is a real provider rename or an OpenRouter labeling change.
