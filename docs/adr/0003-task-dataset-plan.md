# Task dataset plan: seeds, derivation rules, contamination policy

The v1 task layer runs against a frozen, in-repo Task Dataset: MBPP for code generation (500), a stratified DROP sample for corpus Q&A (300), SWE-bench Lite for the agentic repo task (all 300 adopted, 50 pinned for the first report), and a synthetic generator plus an ExtractBench real slice for structured extraction (150 + 100). Kleister is rejected outright (no license on either repo, official test labels never released, 2021-era contamination). Difficulty is derived post-hoc from a Calibration Run's baseline pass rate — three tiers per task type — and contamination is handled by mandatory per-dataset disclosure, not by dataset selection.

## Seeds and instance counts

| Task type | Seed | License | Instances |
|---|---|---|---|
| Code generation | MBPP, test split (IDs 11–510), pinned commit | Apache-2.0 | 500 |
| Corpus Q&A | DROP dev, stratified by answer type (span / number / date), fixed random seed | CC BY-SA 4.0 | 300 |
| Agentic repo task | SWE-bench Lite — all 300 adopted; a pinned 50-instance subset runs the first report | MIT | 300 / 50 |
| Structured extraction | In-house synthetic generator + ExtractBench (LlamaIndex) exact-match slice | in-house + Apache-2.0 | 150 + 100 |

## Derivation rules

- **Initial State**: codegen = prompt + function signature; Q&A = paragraph + question; agentic = repo at `base_commit` + `problem_statement`; extraction = document text + key list.
- **Expected Outcome** (Golden Answer): codegen = hidden tests (3 per MBPP problem); Q&A = gold answer(s); agentic = `test_patch` / FAIL_TO_PASS; extraction = golden key→value JSON (exact-match fields only on the ExtractBench slice).
- **Difficulty**: no adopted seed labels difficulty per instance, so it is derived from a Calibration Run — the cheapest pinned configuration × 3 attempts per instance (models pinned in the model-matrix ticket). Tiers per task type by baseline pass rate: hard < ⅓ ≤ medium ≤ ⅔ < easy. Difficulty is a reported attribute, not a selection gate; it ships null and is filled post-calibration.

## Contamination policy

All public seeds are pre-2023 and heavily trained on, except the ExtractBench slice. v1 accepts this (reproducibility over novelty) and mandates disclosure: every published score and every report carries per-dataset contamination disclosure. Contamination-controlled datasets (LiveCodeBench-class) are post-v1.

## Vendoring and schema

- Frozen JSONL in-repo: `datasets/<type>/<seed>/instances.jsonl`, with `datasets/pins.json` (per-file sha256, source commit, license) and a reproducible fetch script. The repo is public, so every vendored dataset's license must permit redistribution (it does: Apache-2.0 / CC BY-SA with attribution / MIT).
- Task Instance envelope — the "A. Task Dataset" block, first defined here: `id`, `task_type`, `seed {name, version, license, source_url}`, `initial_state`, `expected_outcome`, `verifier {name, params}` (semantics fixed in ADR-0005; here only a pointer), `difficulty {tier, baseline_pass_rate, calibrated_at}` (null pre-calibration), `contamination {disclosed, notes}`. Run-level reproducibility rides on the harness configHash (ADR-0002).
- SWE-bench repo snapshots are not vendored; the harness clones at `base_commit` inside the sandbox.

## Considered options

- **Kleister (NDA + Charity) for extraction** — the canonical KIE benchmark, but rejected: neither repo declares a license (default all rights reserved), the official test labels were never released, and the data is 2021-era. Other extraction candidates: SROIE (license unverifiable at source), FUNSD (non-commercial terms), CORD (CC BY 4.0 but OCR image input), KVP10k (CDLA-Permissive-2.0 but image input + free key discovery, wrong shape), FieldBench (heterogeneous document licenses), ContextualAI extract-bench (MIT, too small). ExtractBench won the real-document slice on license + freshness + text-derivable input.
- **Full-size agentic set for the first report** — rejected for cost; Lite is adopted in full, but the first report runs a pinned 50-instance subset.
- **Contamination-controlled dataset selection** — rejected for v1: only LiveCodeBench offers it (codegen only), and it trades away reproducibility by being a moving target.

## Consequences

- The mechanical work — fetching, pinning, deriving, writing JSONL, the schema file, and the calibration run — lives in the "Freeze and vendor the v1 task datasets" task ticket; the calibration phase waits on the model matrix and the harness core.
- DROP's CC BY-SA requires attribution and share-alike: the vendored slice keeps its license notice in `pins.json`.
- Published scores before calibration carry no difficulty; after calibration they carry tiers and baseline pass rates.
