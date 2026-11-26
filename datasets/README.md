# Frozen Task Dataset (v1)

The Task Dataset a Task Benchmark runs against (GLOSSARY: **Task Dataset**): frozen
Task Instances plus their Golden Answers, one JSONL file per (Task Type, Seed
Dataset). Plan: [`docs/adr/0003-task-dataset-plan.md`](../docs/adr/0003-task-dataset-plan.md),
amended for the agentic type by [`docs/adr/0007-agentic-repo-task-sandbox.md`](../docs/adr/0007-agentic-repo-task-sandbox.md).
Scoring semantics (what `verifier` points at): [`docs/adr/0005-deterministic-quality-scoring.md`](../docs/adr/0005-deterministic-quality-scoring.md).

```
datasets/
  schema/task-instance.schema.json          # the Task Instance envelope
  pins.json                                 # per-file sha256, source revision, license, derivation
  code_generation/mbpp-test/                # MBPP test split (500)
  corpus_qa/drop-dev-stratified/            # DROP dev, stratified (300)
  structured_extraction/extractbench-short-exact/   # ExtractBench exact-match slice (100)
  structured_extraction/synthetic-v1/       # in-house synthetic extraction (150)
  agentic_repo_task/swebench-lite/          # SWE-bench Lite, all adopted (300)
  agentic_repo_task/swebench-lite-first-report/     # pinned subset for the first report (50)
```

Every line is one Task Instance:

```jsonc
{
  "id": "mbpp-test-11",
  "task_type": "code_generation",
  "seed": { "name": "mbpp", "version": "google-research/google-research@<commit> (mbpp/mbpp.jsonl)", "license": "Apache-2.0", "source_url": "…" },
  "initial_state":  { /* the starting point handed to the model */ },
  "expected_outcome": { /* the Golden Answer the verifier checks */ },
  "verifier": { "name": "mbpp_unit_tests", "params": { /* ADR-0005 pointer */ } },
  "difficulty": null,          // filled by the Calibration Run (Phase 2)
  "contamination": { "disclosed": true, "notes": "…" }
}
```

`difficulty` ships `null` for every instance: tiers come from the Calibration Run
(cheapest pinned configuration × 3 attempts, hard < ⅓ ≤ medium ≤ ⅔ < easy per task
type), which needs the single-shot task benchmarks to exist first.

## Derivation rules

None of this is a selection of "interesting" examples — each rule is mechanical and
re-runnable, so a re-freeze against the same seed revisions reproduces the files byte
for byte. `pins.json` records the resulting sha256 of every file.

| Seed | Rule |
|---|---|
| MBPP | `mbpp.jsonl` task IDs 11–510 (the paper's test split: 500 problems, each with exactly 3 `test_list` asserts). `initial_state` = prompt + `test_setup_code` + the signature parsed off the reference solution's `def` line; the reference solution body is never vendored. |
| DROP dev | `drop_dataset_dev.json` (9,536 dev QA pairs, 582 paragraphs), stratified by answer type — `date` > `number` > `span`, because a DROP answer carries several types — with proportional largest-remainder allocation to 300 and a fixed sample seed (`20261126`). `expected_outcome` carries gold surfaces plus `validated_answers` (ADR-0005 takes the max over both). |
| ExtractBench | `short` then `medium` splits in id order. Candidate fields are the leaves of `expected_output` whose `field_rule` comparator is a string comparison (`exact`, `case_insensitive`, `enum`, `name`, `address`, `phone`); record lists (arrays) are out of the slice. A document is adopted when **at least 3** such golden values survive PDF text extraction (punctuation- and whitespace-insensitive check, `unpdf`), and only the answerable fields become `initial_state.keys`. `initial_state.document` is the normalized PDF text — the vendored input, not the PDF. |
| Synthetic | `scripts/seeds/synthetic-extraction.ts`: 5 document templates (invoice, purchase order, lab report, lease summary, support ticket) × 30 variants, seeded `mulberry32` per instance. Golden values are rendered verbatim into each document, so the input is self-contained. |
| SWE-bench Lite | All 300 Lite instances in id order. `initial_state` = per-arch eval image **tags** (`swebench/sweb.eval.{x86_64,arm64}.<instance_id>`), `repo`, `base_commit`, `problem_statement`; `expected_outcome` = `test_patch` + `FAIL_TO_PASS`/`PASS_TO_PASS`. The repo snapshot is the image (ADR-0007) — nothing is cloned or vendored. The gold `patch` is deliberately **not** vendored. 6 instances define no `PASS_TO_PASS` tests at all (upstream data) — an empty list is legal, and the agentic verifier's empty-P2P semantics belong to the Evaluation Engine. |
| First report | The 50-instance subset: every 6th instance of the 300 in id order (systematic sample), so all 11 Lite repos stay represented. Same envelope as the full set. |

Two deviations are recorded rather than hidden:

- **Image digests are unpinned in this freeze.** ADR-0007 asks for `tag@digest`, but
  Docker Hub is unreachable from the freeze environment, so `initial_state.image.digests`
  are `null` and `digest_status` is `"unpinned"` on all 300 instances (and
  `pins.json.agentic_images.digest_status` says so). `bun run datasets:pin-digests`
  resolves them where a registry is reachable (`SWEBENCH_REGISTRY` overrides the
  registry host, for mirrors).
- **The ExtractBench slice is text-only.** The benchmark's real inputs are PDFs with
  scanned pages, handwriting and bbox-level grounding. v1 grades deterministic
  exact-match values only, so the slice is restricted to documents whose text layer
  preserves the golden values; grounding, degradation and long-list challenges are
  out of v1 scope, not silently scored.

## Licenses

Redistribution is permitted by every adopted seed, which is why the repo can be
public with the data in it (ADR-0003).

| Seed | License | Attribution |
|---|---|---|
| MBPP | Apache-2.0 | Google Research, `google-research/google-research` |
| DROP | **CC BY-SA 4.0** | Allen Institute for AI — the vendored slice keeps the upstream share-alike terms |
| ExtractBench | Apache-2.0 | LlamaIndex, `llamaindex/ExtractBench` (source documents are public records) |
| Synthetic | MIT | in-house, this repository |
| SWE-bench Lite | MIT | Princeton NLP / SWE-bench team |

Contamination is disclosed per instance (`contamination.notes`) and per dataset
(ADR-0003 policy: disclose, don't mitigate). Every published score and report must
carry the disclosure.

## Re-freezing

```bash
bun run datasets:fetch            # fetch seeds into .cache/datasets, derive, rewrite JSONL + pins.json
bun run datasets:fetch --refresh  # re-download every seed artifact first
bun run datasets:pin-digests      # also resolve SWE-bench image digests (needs a reachable registry)
bun run datasets:validate         # CI gate: envelope + pins.json sha256/counts/licenses
```

Derived files are deterministic; if `datasets:validate` reports a sha256 mismatch
after a re-freeze, the seed moved or a derivation rule changed — re-pin deliberately
(and say so in the PR / ticket), never by overwriting the hash.

`bun test` runs the same validation plus the per-seed invariants
(`src/core/datasets.test.ts`), so the dataset is gated by the repo's normal check
command. The published-API CI workflow (`ci` pipeline ticket) has to run
`bun run datasets:validate` alongside `bun run check`.
