# Chinese LLM providers and models — fact sheet for the v1 model matrix

> Throwaway research capture on branch `research/model-matrix-landscape-cn`. Never merged.

**Captured:** 2026-11-24 (Asia/Shanghai). **Scope:** domestic Chinese providers, direct API only (no OpenRouter). Facts only — prices, ids, compatibility, licences. No selection or recommendation.

**FX:** 1 USD = **6.679299 CNY**, rate from `open.er-api.com` as of 2026-11-24 00:02 UTC. USD columns are computed at that rate unless a provider publishes its own USD list (DeepSeek does; noted inline).

**Method.** Each price below is from the provider's own pricing or model page, fetched today, except where the note says otherwise (PPIO / SiliconFlow resale boards are used only for models whose first-party page could not be retrieved, and are flagged). Every base URL marked "probed" was verified live by POSTing to `/chat/completions` with a deliberately invalid key and reading the 401 body — a 401 from that path is evidence the endpoint exists and speaks the OpenAI chat shape.

**Reading the ids.** Three kinds of id appear: (a) a stable alias the vendor intends you to call (`deepseek-flash`, `glm-5.3`, `kimi-k3.1-pro`); (b) a dated snapshot that pins behaviour (`qwen3.7-max-2026-06-08`, `doubao-seed-2-1-pro-260915`); (c) a retiring legacy id still routed to a newer model (`deepseek-v4-flash` → `DeepSeek-V4.1-Flash-1017`). Where a vendor publishes both, both are listed. Pinning a dated snapshot is the only way to make a benchmark reproducible across weeks.

---

## 1. Summary table — frontier tier

Vendor's top callable text model as of capture. CNY per 1M tokens, list price, mainland-China region.

| Display name | Exact API model id (+ dated snapshot) | Provider | In ¥/1M | Out ¥/1M | Cache read ¥/1M | In $/1M | Out $/1M | Source | Notes |
|---|---|---|---|---|---|---|---|---|---|
| DeepSeek V4 Pro | `deepseek-v4-pro` (model version `DeepSeek-V4-Pro-0813`) | DeepSeek | 4.50 off-peak / 9.00 peak | 13.50 / 27.00 | 0.15 / 0.30 | 0.67 / 1.35 | 2.02 / 4.04 | [pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) | 1M ctx, 384K max output. Vendor USD list is 0.66/1.98 off-peak, 1.32/3.96 peak — they use ~6.82, not the 6.6793 rate |
| Qwen4 Max | `qwen4-max` | Alibaba Model Studio (百炼) | 10 | 30 | cache hit 10% of input; cache write 125% | 1.50 | 4.49 | [pricing](https://help.aliyun.com/zh/model-studio/model-pricing) | ≤1M input, single tier. Beijing region. Batch = 50% |
| Qwen3.8 Max | `qwen3.8-max`, snapshot `qwen3.8-max-0902` | Alibaba Model Studio | 12 | 36 | as above | 1.80 | 5.39 | [pricing](https://help.aliyun.com/zh/model-studio/model-pricing) | Previous flagship, still callable |
| Kimi K3.1 Pro | `kimi-k3.1-pro` (highspeed variant `kimi-k3.1-pro-highspeed`) | Moonshot / Kimi | 13 | 68 | 1.30 (write 13 for 5 min, 26 for 1 h) | 1.95 | 10.18 | [pricing](https://platform.kimi.com/docs/pricing/chat) | 1,048,576 ctx, 3T-class, native vision. Highspeed: 26/136, write 26/52 |
| GLM-5.3 | `glm-5.3` | Zhipu / bigmodel.cn | 8 | 28 | 2 | 1.20 | 4.19 | [pricing](https://docs.bigmodel.cn/cn/guide/start/pricing) | 1M ctx. GLM-5.4 is announced but **API not yet open** (pending safety eval) — 5.3 is the top callable id |
| Doubao Seed 2.1 Pro | `doubao-seed-2.1-pro`; dated form `doubao-seed-2-1-pro-260915` | ByteDance / Volcengine Ark | 6 | 30 | 1.20 | 0.90 | 4.49 | [pricing](https://www.volcengine.com/docs/82379/1544106), [id sample](https://www.volcengine.com/docs/82379/1099522) | ≤1024K input. Also `doubao-seed-evolving` at the same 6/30 |
| MiniMax-M3 | `MiniMax-M3` | MiniMax | 2.10 (list 4.20, "永久五折") | 8.40 (list 16.80) | 0.42 | 0.31 | 1.26 | [pricing](https://platform.minimaxi.com/document/price) | 1M ctx, 428B total / 23B active, open weights. Priority tier = 1.5× |
| Hunyuan Hy4 | `Hy4` | Tencent (TokenHub) | 6 | 18 | 0.30 | 0.90 | 2.70 | [TokenHub price list](https://cloud.tencent.com/product/tokenhub) | Hunyuan API is migrating to TokenHub; legacy `api.hunyuan.cloud.tencent.com/v1` still probed live |
| ERNIE-5.5-Flash-Preview | `ERNIE-5.5-Flash-Preview` | Baidu Qianfan | 1 (08:00–22:00) | 4 (08:00–22:00) | 0.10 | 0.15 | 0.60 | [product page](https://cloud.baidu.com/product/qianfan) | Named "Flash" but carded as 自研旗舰. Time-of-day pricing; night rate not captured |
| Step 5 Preview | `Step 5 Preview` (id casing unconfirmed) | StepFun | 7 | 20 | 0.70 | 1.05 | 2.99 | [PPIO resale board](https://ppio.com/pricing) — **first-party page not retrieved** | 1M ctx; open weights under "StepFun Model License 1.0" (see §4) |
| Spark Ultra / X1.5 | `4.0Ultra` domain, WS protocol | iFlytek | price not retrieved | — | — | — | — | [WS API doc](https://www.xfyun.cn/doc/spark/Web.html) | Ultra upgraded to X1.5 快思考; Max package sunsets 2026-03-10 |

## 2. Summary table — mid tier

| Display name | Exact API model id | Provider | In ¥/1M | Out ¥/1M | Cache read ¥/1M | In $/1M | Out $/1M | Source | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Kimi K3 | `kimi-k3` | Moonshot | 20 | 100 | 2.00 (write 20/40) | 2.99 | 14.97 | [pricing](https://platform.kimi.com/docs/pricing/chat) | 2.8T, open weights, 1M ctx. Batch 60% of list |
| Qwen3.7 Plus | `qwen3.7-plus`, snapshot `qwen3.7-plus-2026-05-26` | Alibaba | 2.00 (promo 1.60) ≤256K; 6.00 (4.80) ≤1M | 8.00 (6.40); 24.00 (19.20) | 10% hit / 125% write | 0.30 | 1.20 | [pricing](https://help.aliyun.com/zh/model-studio/model-pricing) | 限时8折 is live today |
| Qwen3.6 Plus | `qwen3.6-plus`, `-2026-04-02` | Alibaba | 2.00 ≤256K; 8.00 ≤1M | 12.00; 48.00 | as above | 0.30 | 1.80 | same | |
| GLM-5.1 | `glm-5.1` | Zhipu | 6 (<32K); 8 (≥32K) | 24; 28 | 1.3; 2 | 0.90 | 3.59 | [pricing](https://docs.bigmodel.cn/cn/guide/start/pricing) | |
| GLM-5 | `glm-5` | Zhipu | 4 (<32K); 6 (≥32K) | 18; 22 | 1.0; 1.5 | 0.60 | 2.70 | same | Apache-2.0 weights |
| Doubao Seed 2.1 Turbo | `doubao-seed-2.1-turbo` | Volcengine | 3.00 ≤256K | 15.00 | 0.60 | 0.45 | 2.25 | [pricing](https://www.volcengine.com/docs/82379/1544106) | |
| Doubao Seed 2.0 Pro | `doubao-seed-2.0-pro` | Volcengine | 3.2 ≤32K; 4.8 ≤128K; 9.6 ≤256K | 16; 24; 48 | 0.64 / 0.96 / 1.92 | 0.48 | 2.40 | same | Length-tiered |
| Hy3 | `Hy3` | Tencent | 1 | 4 | 0.25 | 0.15 | 0.60 | [TokenHub](https://cloud.tencent.com/product/tokenhub) | |
| DeepSeek V4.1 Flash | `deepseek-flash` (version `DeepSeek-V4.1-Flash-1017`) | DeepSeek | 1.00 off-peak / 2.00 peak | 4.00 / 8.00 | 0.02 / 0.04 | 0.15 / 0.30 | 0.60 / 1.20 | [pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) | 1M ctx, vision, 384K out. Legacy ids `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` still accepted and route here |
| Kimi K2.6 | `kimi-k2.6` | Moonshot | 6.50 | 27.00 | 1.10 | 0.97 | 4.04 | [pricing](https://platform.kimi.com/docs/pricing/chat) | 262K ctx. **New sign-ups closed 2026-10-31; all K2 retired end of Dec 2026** — not safe to pin |
| MiniMax-M3 (long ctx) | `MiniMax-M3` >512K input | MiniMax | 4.20 (list 8.40) | 16.80 (33.60) | 0.84 | 0.63 | 2.52 | [pricing](https://platform.minimaxi.com/document/price) | Same id, length-tiered |

## 3. Summary table — cheap tier

| Display name | Exact API model id | Provider | In ¥/1M | Out ¥/1M | Cache read ¥/1M | In $/1M | Out $/1M | Source | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Qwen3.8 Flash | `qwen3.8-flash` | Alibaba | 0.80 | 2.70 | 10% hit / 125% write | 0.12 | 0.40 | [pricing](https://help.aliyun.com/zh/model-studio/model-pricing) | ≤1M, one tier — best price/context ratio in the table |
| Qwen3.7 Flash | `qwen3.7-flash`, `-2026-07-15` | Alibaba | 0.20 ≤32K; 0.60 ≤256K; 1.20 ≤1M | 0.80; 2.40; 4.80 | as above | 0.03 | 0.12 | same | |
| Qwen Flash | `qwen-flash`, `-2025-07-28` | Alibaba | 0.15 ≤128K; 0.60; 1.20 | 1.50; 6.00; 12.00 | as above | 0.02 | 0.22 | same | Oldest id still listed and priced |
| GLM-5.3-Flash | `glm-5.3-flash` | Zhipu | 0.80 | 2.80 | 0.23 | 0.12 | 0.42 | [pricing](https://docs.bigmodel.cn/cn/guide/start/pricing) | Multimodal input (image/video/file) |
| GLM-4.7-Flash | `glm-4.7-flash` | Zhipu | free | free | free | 0 | 0 | same | 200K ctx, free tier |
| Doubao Seed 2.1 Lite | `doubao-seed-2.1-lite` | Volcengine | 0.80 (audio in 12.00) | 2.70 | 0.16 | 0.12 | 0.40 | [pricing](https://www.volcengine.com/docs/82379/1544106) | ≤1024K |
| Doubao Seed 2.0 Mini | `doubao-seed-2.0-mini` | Volcengine | 0.20 ≤32K; 0.40; 0.80 | 2.00; 4.00; 8.00 | 0.04 / 0.08 / 0.16 | 0.03 | 0.30 | same | |
| MiniMax-M3.1-Flash | `MiniMax-M3.1-Flash` | MiniMax | 1.00 | 4.00 | 0.10 | 0.15 | 0.60 | [pricing](https://platform.minimaxi.com/document/price) | Released 2026-10-19 |
| Hy4 flash | `Hy4 flash` | Tencent | 0.50 | 2.00 | 0.02 | 0.07 | 0.30 | [TokenHub](https://cloud.tencent.com/product/tokenhub) | Third-party models on the same gateway: `MiMo-V2.6-Pro` 3/6 (cache 0.025), `GLM-5.3-Flash` 0.8/2.8, `MiniMax-M3.1-Flash` 1/4 |
| ERNIE-Light-DT-1.0 | `ERNIE-Light-DT-1.0` | Baidu Qianfan | 8 | 28 | 0.0008 (unit inconsistent on page — likely ¥0.8) | 1.20 | 4.19 | [product page](https://cloud.baidu.com/product/qianfan) | Not actually cheap; listed because it is Baidu's only other priced text model captured |
| Step 3.7 Flash | id unconfirmed | StepFun | not retrieved | — | — | — | — | — | Apache-2.0 weights exist (repo `stepfun-ai/Step-3.7-Flash`) |

---

## 4. Per-provider detail

### DeepSeek (深度求索)

- **Base URL:** `https://api.deepseek.com` (OpenAI format) and `https://api.deepseek.com/anthropic` (Anthropic Messages format). Probed: 401 `Authentication Fails`.
- **Models:** `deepseek-flash` = DeepSeek-V4.1-Flash-1017; `deepseek-v4-pro` = DeepSeek-V4-Pro-0813. Context 1M, max output 384K, JSON output, tool calls, FIM and chat-prefix completion (beta), Anthropic API and Responses API both supported. Vision on Flash only.
- **Pricing shape:** peak/off-peak. Peak = Beijing 09:00–12:00 and 14:00–18:00, Mon–Fri excluding Chinese public holidays; everything else (weekends, holidays, nights) is half price. Off-peak is the price you get for an overnight batch run, and it is exactly 50% of peak.
- **Cache:** context caching on by default, cache-hit input is 2% of miss price (0.02 vs 1.00 CNY). No cache-write premium published.
- **Open weights:** **no V4 weights repo exists.** `deepseek-ai` org's newest model repo is `DeepSeek-V3.2-Exp` (MIT). The V4 family appears API-only. Treat "DeepSeek = open weights" as a 2025 fact, not a 2026 one.
- **International:** yes — same endpoint, USD billing published side-by-side, no separate console needed.
- **Dated facts:** V4-Pro-0813 (2026-08-13), V4.1-Flash-1017 (2026-10-17) from the version strings. Server-side web search/fetch tool calls stopped being billed separately at 12:00 Beijing on 2026-11-18; results now bill as model input tokens.

### Alibaba Qwen / Model Studio / DashScope (阿里通义千问)

- **Base URL:** **changed in 2026.** Per-workspace domains: `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` (Beijing), `…us-east-1…`, `…ap-southeast-1…`, `…ap-northeast-1…`. Legacy `https://dashscope.aliyuncs.com/compatible-mode/v1` and `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` still work (both probed: 401 `Incorrect API key`). API keys are region-bound; a Beijing key against the Singapore host returns 401.
- **OpenAI compatibility:** yes, Chat Completions; DashScope native protocol also exists. `Qwen-Audio` is **not** OpenAI-compatible (DashScope protocol only).
- **Model ladder:** `qwen4-max` (10/30) → `qwen3.8-max` (12/36) → `qwen3.7-max` (12/36) → `qwen3.7-plus` (2/8) → `qwen3.8-flash` (0.8/2.7) → `qwen-flash` (0.15/1.5). Dated snapshots are listed and priced individually, so older versions remain callable.
- **Cache:** explicit cache creation bills at 125% of the input price; cache hits bill at 10%. Implicit cache also exists. Batch = 50%, but batch and cache discount cannot stack.
- **Tiering:** length-tiered per request; a 100K request bills entirely at the 128K band, not progressively.
- **Open weights:** `QwenLM/Qwen3.8` is Apache-2.0 (27B and 2.4T-A95B variants appear on resale boards at exactly `qwen3.8-max` list price, which suggests the max id serves the 2.4T-A95B release — **inference, not confirmed**). No `Qwen4` repo: Qwen4 appears closed.
- **International:** yes — separate regions (Virginia, Singapore, Tokyo, Frankfurt, HK) with their own CNY price lists and API keys, plus Alibaba Cloud international billing.

### Moonshot Kimi (月之暗面)

- **Base URLs:** `https://api.moonshot.cn/v1` (CN, probed) and `https://api.moonshot.ai/v1` (intl, probed). Docs moved from `platform.moonshot.cn` to `platform.kimi.com`.
- **Models:** `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed`, `kimi-k3`, with `kimi-k2.7-code`, `kimi-k2.6` retiring. Context 1,048,576 for K3 family, 262,144 for K2. `max_completion_tokens` up to 1,048,576. Reasoning is always on for K3 (`reasoning_effort` low/high/max, default max) — there is no non-thinking mode, which matters for cost modelling: every call emits thinking tokens.
- **Cache:** automatic prefix cache; cache write billed by TTL (5 min vs 1 h), hit billed at 10% of input (1.3 vs 13 on K3.1 Pro).
- **Open weights:** `MoonshotAI/Kimi-K3` — "Kimi K3 License", an MIT-style permissive grant with a custom title (GitHub reports NOASSERTION). `Kimi-K2.5` also public. K3.1 Pro has no repo.
- **International:** yes, dual endpoints and separate console (`platform.kimi.com`), USD billing available.
- **Dated facts:** K3 repo pushed 2026-08-06; K3.1 Pro shipping by 2026-11-12 (pricing page lastModified) with a site-wide launch banner; K2 closed to new registrations 2026-10-31 (pricing page says 10-31, model list says 11-01) and fully retired end of Dec 2026.

### Zhipu GLM / bigmodel.cn (智谱)

- **Base URL:** `https://open.bigmodel.cn/api/paas/v4` (probed: 401 `令牌已过期或验证不正确`). International twin: `https://api.z.ai/api/paas/v4` (probed). Both OpenAI-compatible; Claude-API and Responses-API compatibility layers also documented.
- **Models:** `glm-5.3` (8/28), `glm-5.3-flash` (0.8/2.8), `glm-5.3-flashx` (2/7), `glm-5.2` (8/28), `glm-5.1` (6/24 then 8/28), `glm-5-turbo`, `glm-5`, `glm-4.7` (2/8 → 3/14 → 4/16 by length), `glm-4.7-flash` (free), `glm-4.5-air`. All 1M ctx at the 5.x tier.
- **GLM-5.4 caveat:** the model overview says GLM-5.4 is open to GLM Coding Plan users but **"模型 API 将在完成安全评估后开放"** — the API id is not callable today. Do not put `glm-5.4` in a matrix yet.
- **Cache:** cache storage listed as 限时免费 (temporarily free); cache-hit price is ~25% of input (2 vs 8).
- **Open weights:** `zai-org/GLM-5` is Apache-2.0. No GLM-5.2 or 5.3 repo — the 5.3 release is explicitly "same base model as GLM-5.2, all gains from post-training", so the licence does not extend to the 5.3 id.
- **International:** yes, `api.z.ai` + USD pricing on the international console.
- **Dated facts:** GLM-5.3 shipped with a 50% coding-benchmark gain over 5.2 and SOTA claims on Terminal Bench 3.0 / CyberGym; GLM-5.4 is announced but gated.

### ByteDance Doubao / Volcengine Ark (字节豆包·火山引擎)

- **Base URL:** `https://ark.cn-beijing.volces.com/api/v3` (probed: 401 `AuthenticationError`). OpenAI-compatible (`arkruntime` SDK is an OpenAI fork); Responses API also supported.
- **Model ids:** Ark now lets you call a **Model ID directly** without creating an endpoint (`预置推理接入点`), e.g. `doubao-seed-2-1-pro-260915`. Custom endpoints (`ep-…`) are only needed for fine-tunes/LoRA. Pricing page uses dot-form display names (`doubao-seed-2.1-pro`) — the hyphen-dated form is what the API sample shows, and I did not find a table mapping every display name to its dated id.
- **Ladder:** `doubao-seed-evolving` and `doubao-seed-2.1-pro` (6/30) → `doubao-seed-2.1-turbo` (3/15) → `doubao-seed-2.1-lite` (0.8/2.7) → `doubao-seed-2.0-pro/lite/mini` (length-tiered). Third-party models resold on the same base URL at identical prices: `kimi-k3.1-pro` 13/68, `glm-5.2` 8/28, `glm-5.3-flash` 0.8/2.8, `deepseek-v4-pro` 9/27, `deepseek-v4-1-flash` 1/4 off-peak.
- **Cache:** implicit prefix cache; hit price ~20% of input; **cache storage billed at 0.017 元/M tokens/hour** — the only vendor here that charges for cache residency by the hour.
- **Open weights:** no Doubao weights. ByteDance's open releases (Seed-OSS etc.) are separate from the `doubao-seed` API line.
- **International:** Volcengine is a mainland cloud; there is no international console for Ark in the material I could retrieve. Treat as CN-only.
- **Dated facts:** `doubao-seed-2-1-pro-260915` pins 2026-09-15.

### MiniMax

- **Base URLs:** `https://api.minimaxi.com/v1` (CN, probed) and `https://api.minimax.io/v1` (intl, probed). OpenAI-compatible chat completions.
- **Models:** `MiniMax-M3` (1M ctx, 428B total / 23B active, native multimodal) and `MiniMax-M3.1-Flash` (cheap daily driver, released 2026-10-19). M3 is permanently 50% off list ("永久五折"): 2.10/8.40 under 512K, 4.20/16.80 above. Priority service tier = 1.5× standard, enabled with `service_tier: priority`.
- **Open weights:** `MiniMax-AI/MiniMax-M3` repo, 428B/23B, licence file lives on Hugging Face (`MiniMaxAI/MiniMax-M3/LICENSE`) and could not be retrieved here — GitHub reports no SPDX licence. Do not state the licence until it is read.
- **International:** yes, `api.minimax.io` + USD billing.
- **Dated facts:** M2 2025-10-27, M2.1 2025-12-22, M2.5 2026-02, M2.7 2026-03-18, M3 2026-06-01, M3.1 Flash 2026-10-19, H3 Image 2026-11-10. Music models went offline 2026-08-20.

### Baidu ERNIE / Qianfan (百度文心)

- **Base URL:** `https://qianfan.baidubce.com/v2` (probed: 401 `invalid_iam_token`), OpenAI-compatible.
- **Models captured:** `ERNIE-5.5-Flash-Preview` (flagship card, 1/4 with 0.10 cache hit, time-window pricing 08:00–22:00), `ERNIE-Light-DT-1.0` (8/28, long-context "DT" line built on BSA sparse attention), plus third-party `DeepSeek-V4.1-Flash-1017` (2/8 day, 1/4 night) and `GLM-5.3` (8/28) resold on Qianfan. Product page also references `ERNIE-5.1` as a selectable model.
- **Gap:** Baidu's doc site is a JS shell — every `cloud.baidu.com/doc/...` URL returned the same landing text, so the full model/price table and the exact `ERNIE-5.1` price were not retrievable in this pass.
- **Open weights:** closed.
- **International:** Baidu's international cloud does not carry Qianfan in the same form; treat as CN-only.

### Tencent Hunyuan (腾讯混元)

- **Base URL:** legacy `https://api.hunyuan.cloud.tencent.com/v1` (probed: 401, OpenAI-compatible). **Tencent is migrating Hunyuan off the legacy platform onto TokenHub**; the legacy price page states the old platform "将不再新增模型能力，并停止支持新购模型服务".
- **Models:** `Hy4` (6/18, cache 0.3), `Hy4 flash` (0.5/2, cache 0.02), `Hy3` (1/4, cache 0.25), plus resold `Kimi K3.1 Pro` 13/68, `MiniMax-M3.1-Flash` 1/4, `DeepSeek-V4.1-Flash-1017` 1/4 off-peak, `MiMo-V2.6-Pro` 3/6, `GLM-5.3-Flash` 0.8/2.8.
- **Legacy Hunyuan ids still priced:** `Hunyuan-a13b` 0.5/2, `Hunyuan-role-latest` 2.4/9.6, `Hunyuan-translation` 1.2/3.6, `Hunyuan-turbos-vision` 3/9.
- **Open weights:** Hy4 has no public weights repo.
- **International:** Tencent Cloud International exists but the TokenHub catalogue is a mainland product; treat as CN-only unless verified.

### iFlytek Spark (讯飞星火)

- **Base URL:** `https://spark-api-open.xf-yun.com/v1` (probed: 401 `HMAC signature cannot be verified: apikey not found`) — OpenAI-compatible. The **native** interface is a WebSocket protocol (`wss://spark-api.xf-yun.com/...`) with `app_id` + `api_key` + `api_secret` HMAC auth and a `domain` parameter (`lite`, `generalv3`, `pro-128k`, `generalv3.5`, `max-32k`, `4.0Ultra`, `kjwx`), not a REST chat API. Anything that only speaks OpenAI REST needs the compat endpoint.
- **Models:** Ultra (upgraded to **X1.5 快思考**), Max / Max-32K, Pro / Pro-128K, Lite. Max package retires 2026-03-10, with quota merged into Ultra.
- **Gap:** no price was retrievable — the product/pricing pages 404 or require console login. Do not quote Spark prices without a first-party number.
- **Open weights:** closed.
- **International:** iFlytek has an international site but the Spark API is provisioned through the CN console; treat as CN-only.

### StepFun (阶跃星辰)

- **Base URL:** `https://api.stepfun.com/v1` (probed: 401 `Incorrect API key provided`), OpenAI SDK example on the homepage.
- **Models:** `Step 5 Preview` is the current flagship ("面向真实任务的新一代旗舰基模"), 1M ctx. `Step-3.7-Flash` and `Step-3.5-Flash` are the efficient line.
- **Pricing:** first-party pricing page not retrievable (all `/docs/...pricing` paths 404). PPIO's resale board lists Step 5 Preview at 7/20 with 0.7 cache read — **resale price, may not equal StepFun list**.
- **Open weights:** `stepfun-ai/Step-5-Preview` under **"StepFun Model License 1.0"** — a custom licence (perpetual, worldwide, royalty-free, sublicensable, with termination clauses). `Step-3.7-Flash` and `Step-3.5-Flash` are Apache-2.0.
- **International:** `platform.stepfun.com` serves both; international card payment not verified.

### 01.AI Yi (零一万物)

- **Status: discontinued.** `GET https://api.lingyiwanwu.com/v1/models` returns **HTTP 410** `{"code":"model_service_closed","message":"Model service has been discontinued"}` as of 2026-11-24. `platform.01.ai` renders only a legacy shell (Documentation / Playground / Contact Us).
- **Implication:** Yi cannot be a v1 matrix row. This is a change from 2025, when `yi-lightning` was a standard cheap-tier option.

### Other Chinese providers that surfaced in Nov 2026

| Provider | Evidence | Price if published |
|---|---|---|
| Xiaomi MiMo (小米) | Listed on Tencent TokenHub (`MiMo-V2.6-Pro` 3/6, cache 0.025) and PPIO (`MiMo V2.6 Pro` 3/6/0.025, `MiMo V2.6 Flash` 1/2/0.02) | 3/6 and 1/2 CNY |
| Ant Group inclusionAI Ling (蚂蚁 Ling) | `Ling 3.1 Flash 1019` on PPIO, 1M ctx; SiliconFlow lists an `inclusionAI` vendor row | 2/6, cache 0.4 |
| Meituan LongCat (美团) | SiliconFlow vendor row `meituan-longcat` | 5/20, cache 0.1 |
| China Telecom (telecom LLM) | SiliconFlow lists `ChinaTelecom` models as free | free |
| Baidu "Unlimited-OCR-2" | Qianfan product card | 0.001/0.004 per 1K tokens |

None of these has a documented first-party OpenAI-compatible endpoint that I verified; they are reachable today mainly through aggregators.

---

## 5. OpenAI-compatibility matrix

| Provider | Base URL | OpenAI chat-compatible | Verified how | Native protocol if not |
|---|---|---|---|---|
| DeepSeek | `https://api.deepseek.com` | yes | docs + probe | also Anthropic Messages at `/anthropic` |
| Alibaba Model Studio | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`; legacy `https://dashscope.aliyuncs.com/compatible-mode/v1`; intl `…ap-southeast-1…` / `dashscope-intl` | yes | docs + probe | DashScope native; `Qwen-Audio` is DashScope-only |
| Moonshot Kimi | `https://api.moonshot.cn/v1`; intl `https://api.moonshot.ai/v1` | yes | docs + probe | — |
| Zhipu | `https://open.bigmodel.cn/api/paas/v4`; intl `https://api.z.ai/api/paas/v4` | yes | docs + probe | also Claude-API and Responses-API compat |
| Volcengine Ark | `https://ark.cn-beijing.volces.com/api/v3` | yes | docs + probe | Responses API also |
| MiniMax | `https://api.minimaxi.com/v1`; intl `https://api.minimax.io/v1` | yes | probe | — |
| Baidu Qianfan | `https://qianfan.baidubce.com/v2` | yes | probe | — |
| Tencent | `https://api.hunyuan.cloud.tencent.com/v1` (legacy); TokenHub base not resolved | yes on legacy | probe | Tencent Cloud API 3.0 for some products |
| iFlytek Spark | `https://spark-api-open.xf-yun.com/v1` (compat) | yes, via compat endpoint | probe | native = WebSocket + HMAC (`app_id`/`api_key`/`api_secret`, `domain` param) |
| StepFun | `https://api.stepfun.com/v1` | yes | docs + probe | — |
| 01.AI | `https://api.lingyiwanwu.com/v1` | **no — 410 discontinued** | probe | — |
| SiliconFlow | `https://api.siliconflow.cn/v1` | yes | probe | — |
| ModelScope API-Inference | `https://api-inference.modelscope.cn/v1` | yes | probe | model ids are `org/model` form |
| PPIO | `https://api.ppio.com/openai/v1`; legacy `https://api.ppinfra.com/v3/openai` | yes | probe | — |

**Practical note for the harness:** every live direct provider except iFlytek's native socket can be driven by one OpenAI client with a per-provider base URL. iFlytek needs either its compat endpoint or a WS adapter. Alibaba needs a workspace id in the hostname or the legacy host.

---

## 6. Open-weight summary

| Family | Current open release | Licence | Maps to API id? |
|---|---|---|---|
| DeepSeek | `DeepSeek-V3.2-Exp` (2025-era); no V4 repo | MIT | **No** — `deepseek-v4-pro` / `deepseek-flash` are API-only |
| Qwen | `Qwen3.8` series (27B, 2.4T-A95B), `Qwen3.8-Flash-Next` | Apache-2.0 | Probably — the 2.4T-A95B is priced identically to `qwen3.8-max` (inference) |
| Kimi | `Kimi-K3` (2.8T), `Kimi-K2.5` | "Kimi K3 License" (MIT-style custom) | Yes for `kimi-k3`; no for `kimi-k3.1-pro` |
| Zhipu GLM | `GLM-5` | Apache-2.0 | No for `glm-5.3` (5.3 is a post-train of 5.2; no 5.2/5.3 repo) |
| MiniMax | `MiniMax-M3` (428B/23B) | licence file on HF, unread | Yes for `MiniMax-M3` |
| StepFun | `Step-5-Preview`; `Step-3.7-Flash`, `Step-3.5-Flash` | "StepFun Model License 1.0" (custom); Apache-2.0 for Flash | Yes for Step 5 Preview |
| Xiaomi | `MiMo-V2-Flash` | Apache-2.0 | Unknown for V2.6 |
| Ant inclusionAI | Ling series | not checked | Unknown |

---

## 7. Would anything block a ~12k single-shot run?

- **Context windows:** no. Every frontier id is ≥1M or 256K; MMLU-Pro items are ~100 tokens. Not a constraint.
- **Concurrency:** DeepSeek publishes 2500 concurrent for `deepseek-flash` and 500 for `deepseek-v4-pro` — comfortably above what a 12k-call sweep needs. The others publish rate limits on console pages that this pass did not capture.
- **Cost shape that matters at 12k calls:** DeepSeek's 50% off-peak window, Alibaba's 125%/10% cache rule, Kimi's mandatory thinking tokens on K3 (output is 5× input price, and thinking inflates `completion_tokens`), Volcengine's per-hour cache storage, and MiniMax's 1.5× priority tier are the five mechanisms that can move a bill by more than the raw price table suggests.
- **Retirement risk in the window:** Kimi K2 fully retires end of Dec 2026; GLM-5.4 is announced but gated; 01.AI is already gone. Pin dated snapshots for anything that must be reproducible past December.

---

## 8. 2025→2026 timeline (provider-published dates only)

| Date | Event |
|---|---|
| 2025-06-16 | MiniMax-M1 (80K CoT × 1M input) |
| 2025-10-27 | MiniMax-M2 |
| 2025-12-22 | MiniMax-M2.1 |
| 2026-02 | MiniMax-M2.5 |
| 2026-02-15 | Qwen3.5-Plus snapshot |
| 2026-03-10 | iFlytek Spark Max package retired, quota merged into Ultra |
| 2026-03-18 | MiniMax-M2.7 |
| 2026-04-02 | Qwen3.6-Plus snapshot |
| 2026-05-17 / 05-20 / 06-08 | Qwen3.7-Max preview and snapshots |
| 2026-06-01 | MiniMax-M3 (1M ctx, 428B/23B, open weights) |
| 2026-07-15 | Qwen3.7-Flash snapshot |
| 2026-08-06 | `MoonshotAI/Kimi-K3` repo pushed (2.8T, open) |
| 2026-08-13 | DeepSeek-V4-Pro-0813 |
| 2026-08-17 | `QwenLM/Qwen3.8` repo pushed (Apache-2.0) |
| 2026-08-20 | MiniMax music models offline |
| 2026-09-02 | Qwen3.8-Max snapshot `-0902` |
| 2026-09-15 | Doubao Seed 2.1 Pro snapshot `doubao-seed-2-1-pro-260915` |
| 2026-10-17 | DeepSeek-V4.1-Flash-1017 |
| 2026-10-19 | MiniMax-M3.1-Flash |
| 2026-10-31 | Kimi K2 closed to new registrations |
| 2026-11-10 | MiniMax-H3-Image (open-weight image model) |
| 2026-11-12 | Kimi K3.1 Pro pricing page revision (launch window) |
| 2026-11-18 | DeepSeek stops billing server-side search/fetch tool calls separately |
| 2026-12-31 (planned) | Kimi K2 series fully retired |

**What actually reshaped tiers (facts, not narrative):** every vendor now sells a 1M-context flagship in the 6–13 CNY input band and a flash/lite tier at 0.15–1 CNY. DeepSeek's peak/off-peak structure is the only surviving time-of-day pricing at a major lab. Open weights have moved *down* the stack: DeepSeek and Zhipu's newest flagships (V4, GLM-5.3) are closed even though their predecessors were open, while Kimi, MiniMax, Qwen3.8 and StepFun still ship open frontier-class weights.

---

## Appendix A — Chinese aggregators / gateways

Not OpenRouter, mainland-hosted. Useful if the human wants one key for many vendors; harmful for a benchmark that wants to pin a first-party snapshot.

| Gateway | Base URL (probed) | What it resells | Price signal |
|---|---|---|---|
| SiliconFlow (硅基流动) | `https://api.siliconflow.cn/v1` | DeepSeek, Qwen, Zhipu, Kimi, Hunyuan, Baidu, Meituan-LongCat, inclusionAI, ChinaTelecom | DeepSeek V4.1 Flash 2/8 with 0.04 cache; GLM-5.3 8/28/2; Kimi K2.6 6.5/27/1.1; Hy4 6/18/0.3 |
| ModelScope API-Inference (魔搭) | `https://api-inference.modelscope.cn/v1` | Open-weight models, `org/model` ids | Free tier historically; not priced in this pass |
| PPIO (派欧云) | `https://api.ppio.com/openai/v1` (legacy `https://api.ppinfra.com/v3/openai`) | Broad: DeepSeek, GLM, Qwen incl. open 27B/2.4T, MiniMax, Kimi, Hy4, Step 5, MiMo, Ling | Full board with context + cache write/read per model — the single best cross-vendor price page found today |

Caveat: aggregator prices are resale prices. They can be below list (Qwen3.7 Max at 6/18 vs 12/36 first-party), and their model ids are not the vendor's ids. For a benchmark that must be reproducible and attributable, call the vendor.

## Appendix B — gaps and confidence

| Item | Status |
|---|---|
| iFlytek Spark prices | **Not retrieved.** Product pages 404/login-gated. Do not quote. |
| StepFun first-party prices | **Not retrieved.** PPIO resale numbers used and labelled. |
| Baidu full model table | **Partial.** Doc site is a JS shell; only product-page cards captured. |
| Tencent TokenHub base URL | **Not resolved.** Legacy Hunyuan endpoint verified. |
| MiniMax M3 licence text | **Not read.** GitHub has no SPDX licence; HF fetch blocked. |
| Volcengine display-name → dated-id map | **Partial.** One dated id confirmed by doc sample (`doubao-seed-2-1-pro-260915`). |
| Xiaomi / Ant / Meituan first-party APIs | **Not verified.** Only aggregator listings. |
| GLM-5.4, Qwen4 weights, Kimi K3.1 weights | Do not exist / not callable / not open, respectively, as of capture. |

## Appendix C — source list

Primary (fetched 2026-11-24):
[DeepSeek pricing EN](https://api-docs.deepseek.com/quick_start/pricing) · [DeepSeek pricing ZH](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) · [Kimi pricing](https://platform.kimi.com/docs/pricing/chat) · [Kimi model list](https://platform.kimi.com/docs/models) · [Kimi chat API](https://platform.kimi.com/docs/api/chat) · [Zhipu pricing](https://docs.bigmodel.cn/cn/guide/start/pricing) · [Zhipu model overview](https://docs.bigmodel.cn/cn/guide/start/model-overview) · [Zhipu OpenAI compat](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) · [Alibaba model pricing](https://help.aliyun.com/zh/model-studio/model-pricing) · [Alibaba OpenAI compat](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) · [Volcengine Ark pricing](https://www.volcengine.com/docs/82379/1544106) · [Volcengine Ark inference](https://www.volcengine.com/docs/82379/1099522) · [MiniMax pricing](https://platform.minimaxi.com/document/price) · [MiniMax release notes](https://platform.minimaxi.com/document/Models) · [Tencent TokenHub](https://cloud.tencent.com/product/tokenhub) · [Tencent Hunyuan billing](https://cloud.tencent.com/document/product/1729/97731) · [Baidu Qianfan product](https://cloud.baidu.com/product/qianfan) · [iFlytek Spark WS API](https://www.xfyun.cn/doc/spark/Web.html) · [StepFun platform](https://platform.stepfun.com/)

Resale / cross-check: [PPIO pricing](https://ppio.com/pricing) · [SiliconFlow pricing](https://siliconflow.cn/pricing)

Repository metadata (licences): GitHub API `repos/{MoonshotAI/Kimi-K3, MiniMax-AI/MiniMax-M3, zai-org/GLM-5, QwenLM/Qwen3.8, stepfun-ai/Step-5-Preview, deepseek-ai/*}`, plus raw `LICENSE` files where retrievable.

FX: [open.er-api.com USD→CNY](https://open.er-api.com/v6/latest/USD), 2026-11-24.
