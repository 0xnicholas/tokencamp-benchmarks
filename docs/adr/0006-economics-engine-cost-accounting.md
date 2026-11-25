# Economics engine: settled-cost headline, tokens + tools spend, waste share

The economics engine turns attempt-level usage and settle data into the money of Task Economics: CPET and its decomposition. Resolved through grilling (issue #9); the cost-module build ticket (#13) implements it, and the agentic sandbox ticket (#10) supplies its tool-cost input.

## Spend model (per attempt row, USD)

- **Token cost** = normalized usage × the pinned price table (`prices/prices.json`; cacheRead/cacheWrite default to the input price — ADR-0002, #13).
- **Tool cost** = billed sandbox wall-clock time × a pinned machine rate, stored in `prices.json`'s `sandbox_rates` section with the same per-row provenance (catalog snapshot + pinned date). Zero for tool-free configurations; concrete rate values land with the sandbox decision (#10) and the cost-module build (#13). A per-call flat fee was considered and rejected — a `run_tests` call (minutes) vs a file read (milliseconds) are orders of magnitude apart, and "free" would understate the agentic type's real business cost, which is the whole point of that showcase type.
- **No third category**: agent cost = tokens + tools. The platform margin is whatever settled − computed shows, disclosed as a reconciliation line, not modeled — with settled cost as the headline, it is already inside every number.
- **Human cost is out of v1** (user call during the grilling; overrides the charting note "configurable modeled cost, default off"). Spend has exactly two components.
- **Harness overhead**: verifier execution (hidden tests, final test suites) is benchmark-side work — excluded from the CPET numerator and disclosed as a separate line in `summary.json`. The agent's own in-loop test runs are tool spend, not overhead.

## CPET accounting

- **Headline cost = the settled cost** — tokencamp's per-request settle (`GET /v1/generation/{id}`), the customer's actual bill. The computed cost (usage × pinned prices) is kept per attempt as the reproducible anchor and for diagnosis. Settle missing (API outage): fall back to computed, flagged `settle: "missing"`; no usage captured either: $0, flagged.
- **Retry folding**: transport-level retries (429/5xx) fold into the attempt's cost; the attempt row keeps `rawCalls: [{generationId, usage, settledCost}]` and cost is their sum. Epoch retries need nothing special — every attempt row already counts.
- **Effective tasks** = attempt rows whose gate passed (each attempt is one task outcome; an instance passing 2 of 3 epochs contributes 2).
- **Waste share** = spend on gate-failed attempts ÷ total spend, computed at every aggregation level.

## Aggregation

Money aggregates at four levels: **per configuration, per task type, per difficulty tier, and a run-level ledger** (total spend, per-type tables). **No cross-type CPET claim** — mixing $0.87 extraction with $28.40 agentic is meaningless, matching ADR-0005's no-cross-type stance for quality. Quality/Reliability aggregation remains ADR-0005's; this ADR owns only the money.

## Price-table versioning

`prices.json` is git-versioned in-repo with per-row provenance (catalog snapshot + pinned date). **Re-pinning is allowed between runs** (new pinned date, new commit, new sha — cross-run comparability rides on recorded provenance, not one frozen price) and **never mid-run**: the manifest pins the table at run start, and resume refuses on mismatch, same discipline as `configHash`. Unknown model id or unknown sandbox spec ⇒ refuse to run (a score without cost violates the destination).

## Budget

A `--max-spend-usd` run guard graduates into the cost-module build ticket (#13): refuse new attempts once actual spend reaches the budget. This clears the "per-run cost budget" half of the map's CI-infrastructure fog; artifact storage location stays in fog.

## Considered options

- Per-call tool fee — rejected (see spend model).
- Computed cost as headline — rejected: the destination asks what a customer actually pays; computed stays the reproducibility anchor.
- Platform-fee cost category — rejected: double-counts once settled is the headline.
- Human cost default-off modeling — dropped from v1 entirely by user call.

## Consequences

- #13 (cost module build) body amended: `sandbox_rates` section, `rawCalls` per attempt, `--max-spend-usd`, harness-overhead line, money-aggregation seam pointed here.
- #10 (agentic sandbox) body amended: its output contract must report billed wall-clock time per tool call (this ADR's tool-cost input).
- GLOSSARY: Tool Cost, Waste Share, Settled Cost, Computed Cost, Harness Overhead added; CPET and Pinned Price Table sharpened.
- The report prototype's KPI fields (headline CPET, waste share, per-type strip, tier-level diagnosis) are exactly the aggregates this ADR produces.
