# Deterministic quality scoring: gate = perfect, score = progress

v1 scoring is deterministic only (no LLM judge), and every task type resolves to a single uniform rule: **Quality Score (0–1) = fractional progress toward the expected outcome, and Quality Gate (Task Success) = Quality Score is exactly 1.0**. Each task type has one verifier implementing that rule against its Golden Answer. This ADR fixes the per-type gate and score formulas, the failure policy, and how Reliability and config-level quality aggregate.

## The uniform rule

- **Quality Score** = the task type's canonical progress measure, 0–1.
- **Quality Gate (Task Success)** = the binary verdict; an outcome passes iff its Quality Score is exactly 1.0 (perfect completion). "Effective task" therefore means *the task is actually done*: code that passes every hidden test, every field extracted, the exact answer, the issue resolved with no regressions.

## Per task type

| Task type | Verifier (`name` → `params`) | Quality Score | Gate |
|---|---|---|---|
| Code generation | `mbpp_unit_tests` → `{image: "python:3.12-slim", network: false, per_test_timeout_s: 10, total_timeout_s: 30}` | hidden tests passed / 3 | all 3 hidden tests pass |
| Structured extraction | `golden_fields_exact` → `{trim: true, case_sensitive: true, extra_keys: "ignored"}` | golden keys with exact value match / total keys | every golden key matches exactly |
| Corpus Q&A | `drop_em_f1` → `{normalization: "drop-canonical"}` | DROP F1 | DROP exact match (EM) |
| Agentic repo task | `swebench_test_suite` → semantics only (execution mechanics are the agentic sandbox ticket's) | mean(FAIL_TO_PASS fraction, PASS_TO_PASS fraction) | all F2P pass **and** all P2P pass (SWE-bench "FULL") |

### Code generation

The 3 hidden MBPP tests run one subprocess each in a pinned `python:3.12-slim` image with no network; per-test timeout 10s, per-submission 30s. A test that errors or times out counts as a failed test, never as "not evaluated". Score = passed / 3; gate = 3/3.

### Structured extraction

Each golden key's value is compared as a trimmed string, case-sensitive; numbers compare as strings. A missing or null value counts as wrong; extra keys the model emits are ignored (they neither help nor hurt). Score = matched keys / total keys; gate = every key matched.

### Corpus Q&A

The canonical DROP evaluation semantics are vendored verbatim from `allenai/allennlp` `allennlp/tools/drop_eval.py` (v2.9.1, identical normalization to the v0.9.0 leaderboard-era script): EM and F1 over token bags, max over the gold answer plus `validated_answers`, normalization = lowercase, strip articles, strip punctuation, collapse whitespace, number normalization (`"10"` ≡ `"10.0"`), date handling, and optimal multi-span alignment. The attempt's raw output string is scored as-is (whitespace-trimmed); answer formatting is the Task Configuration's job, not the verifier's. Gate = EM, score = F1 (rounded to 2dp by the canonical script).

### Agentic repo task

SWE-bench grading semantics: resolution status FULL = all FAIL_TO_PASS and all PASS_TO_PASS tests pass; PARTIAL = some but not all pass without regressions; NO otherwise. Gate = FULL; score = the mean of the f2p fraction and the p2p fraction, so `gate ⟺ score = 1.0` holds here too. Running the test suites (Docker, repo clone at `base_commit`) belongs to the agentic sandbox ticket; this ADR pins only the verdict semantics.

## Epochs and Reliability

- Epochs are a run-level parameter, **default 3** (matching the Calibration Run). Every epoch always runs — no early stop on pass — so Reliability is an honest pass rate. The economics engine may lower the default for a given run to save spend.
- **Reliability(Task Instance) = gate-passing epochs / total epochs; Reliability(Task Configuration) = mean over instances.**
- Pass@k-style statistics are out of v1.

## Aggregation (config level)

- **Quality(Task Configuration) = mean Quality Score over all attempt outcomes** (instances × epochs; failed attempts keep their partial score, they are not zeroed).
- **Task Success Rate = mean gate over all attempt outcomes.**
- Both computed per task type only. v1 makes no cross-type aggregation claim.

## Failure policy

A malformed or empty output scores 0, fails the gate, and the attempt is still counted — in Reliability, and in CPET's spend (the economics engine's domain). No attempt is ever excluded from scoring; a verifier that cannot run (infrastructure failure) is a failed outcome, not a dropped row.

## Artifact

Every attempt row in `results.jsonl` carries a `verification` block — gate verdict, score, and per-unit detail (per-test results, per-key matches, F1 parts, F2P/P2P test lists) — amending ADR-0002. `summary.json`'s assembler aggregates per this ADR. This is the evidence every published score links to.

## Considered options

- **Per-type gates at varying thresholds** (e.g. codegen passes at 2/3 tests, extraction at 80% of keys) — rejected: "effective task" means the task is done; a task with a wrong field or a failing test is not done, and threshold tuning per type would be arbitrary and incomparable.
- **Gate ≠ score in general, score = F2P fraction only for the agentic type** — rejected for v1: keeping `gate ⟺ score = 1.0` uniform across all four types gives the domain model one rule (difficulty tiers, CPET, and the report all inherit it) at the cost of a slightly non-canonical agentic score; the F2P fraction alone is still recorded in the per-unit detail.
- **Agentic gate on F2P only** (SWE-bench-style "resolution rate") — rejected: a patch that fixes the issue but breaks existing tests is not an effective task.
- **LLM-judge scoring** — out of v1 by the map (deterministic only); the fog entry for LLM-judge scoring of fuzzy tasks is unchanged.
- **Best-of-k quality** (best epoch per instance) — rejected: Reliability already captures repetition; Quality means over all attempt outcomes and is cheaper to reason about.

## Consequences

- The four verifier names and params above are what the dataset freeze ticket stores in each Task Instance's `verifier {name, params}` pointer, and what the Evaluation Engine build ticket implements.
- Published scores change if these semantics change — that is the point of recording them here; scoring versions are traceable through the configHash of each run.
- The agentic sandbox ticket must produce F2P/P2P per-test results (SWE-bench report format) as its output contract, since this ADR consumes exactly that shape.
- `defaultEpochs = 3` for task benchmarks supersedes the earlier `1` in the harness-core ticket's settled context; the first report may still run `--epochs 1` for spend reasons.
