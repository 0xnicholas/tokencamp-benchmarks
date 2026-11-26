# Task Dataset Survey — public datasets for the four v1 task types

> Convention note: this repo had no `docs/research/` yet; this file establishes it as the home for research findings. One file per research ticket, named `<topic>-survey.md`.

Survey for wayfinder research ticket #3 ("Which public datasets back the four task types?"). Every claim links to its primary source (canonical repo, paper, or dataset card). Scope: candidates must support **deterministic verification only** and be reproducible — the two v1 hard constraints.

## TL;DR recommendation

| Task type | Seed (primary) | License | Why | Fallback / flag |
|---|---|---|---|---|
| Code generation | [MBPP](https://github.com/google-research/google-research/tree/master/mbpp) (~1,000 problems) | Apache-2.0 | 3 hidden tests per problem, deterministic | [HumanEval](https://github.com/openai/human-eval) (MIT, but deprecated); [LiveCodeBench](https://github.com/LiveCodeBench/LiveCodeBench) (MIT, contamination-controlled) |
| Structured extraction | [Kleister NDA](https://github.com/applicaai/kleister-nda) + [Charity](https://github.com/applicaai/kleister-charity) | **none declared** ⚠️ | canonical key→value KIE, exact match | **Flag**: no license + PDF/OCR cost → licensing check or synthetic fallback |
| Corpus Q&A | [DROP](https://huggingface.co/datasets/ucinlp/drop) (96K QAs) | CC BY-SA 4.0 | EM/F1 over spans/numbers/dates, deterministic | [QuALITY](https://github.com/nyu-mll/quality) (MC, deterministic; license to confirm) |
| Agentic repo task | [SWE-bench Lite](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite) (300) / [Verified](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified) (500) | MIT | test-suite grading (FAIL_TO_PASS), deterministic | heavy infra (per-repo Docker), high contamination |

## 1. Code generation

### MBPP — Mostly Basic Python Problems
- **Source / license**: `google-research/google-research` monorepo, Apache-2.0 ([repo license](https://github.com/google-research/google-research)). README: [mbpp/README.md](https://github.com/google-research/google-research/blob/master/mbpp/README.md).
- **Size / difficulty**: "around 1,000 crowd-sourced Python programming problems … entry level programmers … Each problem consists of a task description, code solution and 3 automated test cases" ([README](https://github.com/google-research/google-research/blob/master/mbpp/README.md)). Test split = task IDs 11–510 (500 problems).
- **Deterministic grading**: yes — 3 automated test cases per problem; execution-based pass/fail.
- **Contamination**: high — 2021 dataset, heavily used in model training.

### HumanEval
- **Source / license**: `openai/human-eval`, MIT ([repo license](https://github.com/openai/human-eval)).
- **Size**: 164 hand-written problems ([README](https://github.com/openai/human-eval); the sample run of `164×200 = 32800` confirms the count).
- **Deterministic grading**: yes — `evaluate_functional_correctness` runs each completion against hidden test suites, reports `pass@k` ([README](https://github.com/openai/human-eval)).
- **Flag**: repository is **deprecated and unmaintained** — "provided for historical reference, without ongoing support" ([README](https://github.com/openai/human-eval)). Still a de-facto standard, but pin it.

### LiveCodeBench (contamination-controlled alternative)
- **Source / license**: `LiveCodeBench/LiveCodeBench`, MIT ([repo](https://github.com/LiveCodeBench/LiveCodeBench)). Built from recent competitive-programming problems specifically to avoid contamination ([paper](https://arxiv.org/abs/2403.07974)).
- **Trade-off**: fresher data (less contamination) but moving target (harder to pin a frozen v1 set).

## 2. Structured extraction

### Kleister (NDA + Charity)
- **Source**: `applicaai/kleister-nda` and `applicaai/kleister-charity` ([NDA](https://github.com/applicaai/kleister-nda), [Charity](https://github.com/applicaai/kleister-charity)); paper [arXiv 2105.05796](https://arxiv.org/abs/2105.05796).
- **Task shape**: "you are given keys (labels, attribute names) and you are expected to guess their respective values" ([NDA README](https://github.com/applicaai/kleister-nda)); charity variant extracts charity name/number/address/income/spending from PDF reports ([Charity README](https://github.com/applicaai/kleister-charity)).
- **Deterministic grading**: yes — golden key→value table, exact match.
- **Flags**: (1) **no license declared** on either repo (GitHub API reports `license: null`); (2) inputs are long **PDF documents** — extraction needs OCR/text layers (tesseract/textract/djvu text is provided, see `in-header.tsv`), which adds tool/vision cost to v1.

**Gap**: no clean-license, text-only, "messy text → JSON schema" benchmark found in primary sources. This is the weakest-covered task type; if Kleister's licensing can't be cleared, the fallback is a synthetic extraction set (a decision for the task dataset plan ticket).

## 3. Corpus Q&A (fixed corpus)

### DROP — Discrete Reasoning Over Paragraphs
- **Source / license**: AllenNLP DROP, **CC BY-SA 4.0** ([HF dataset card `ucinlp/drop` README](https://huggingface.co/datasets/ucinlp/drop/blob/main/README.md); [AWS Open Data registry](https://registry.opendata.aws/allenai-drop/) lists "License CC BY").
- **Size**: "96k QAs over 6.7K paragraphs", train 77K / dev 9.5K / hidden test 9.5K ([AWS registry](https://registry.opendata.aws/allenai-drop/)).
- **Deterministic grading**: yes — answers are spans / numbers / dates, scored with exact-match + F1 ([paper](https://arxiv.org/abs/1903.00161)).
- **Contamination**: high (2019, widely used). No per-instance difficulty label — difficulty must be derived post-hoc (baseline pass rate).

### QuALITY (long-document MC alternative)
- **Source**: `nyu-mll/quality` ([repo](https://github.com/nyu-mll/quality)); paper [arXiv 2112.08608](https://arxiv.org/abs/2112.08608).
- **Shape**: multiple-choice QA, 4 options, passages averaging ~5,000 tokens; `gold_label` = majority vote of annotators + writer (deterministic); a `difficult` binary flag marks the hard subset ([repo README data schema](https://github.com/nyu-mll/quality)).
- **Flags**: no repo-level license file; each article carries its own `license` field. License needs confirmation before redistribution. Test-set answers are **not released** (hidden leaderboard) — use the dev split for self-hosted evaluation.

## 4. Agentic repo task

### SWE-bench / SWE-bench Lite / SWE-bench Verified
- **Source / license**: `SWE-bench/SWE-bench`, MIT ([repo license](https://github.com/SWE-bench/SWE-bench)).
- **Size**: SWE-bench Lite = **300** instances from 11 popular Python repos ([swebench.com/lite](https://www.swebench.com/lite); [paper](https://arxiv.org/abs/2310.06770v3)); SWE-bench Verified = **500** human-confirmed-solvable problems ([repo README](https://github.com/SWE-bench/SWE-bench), [OpenAI report](https://openai.com/index/introducing-swe-bench-verified/)).
- **Deterministic grading**: yes — run each repo's test suite; a patch is graded on `FAIL_TO_PASS` (tests that must start passing) and `PASS_TO_PASS` (tests that must keep passing). Initial State = repo at `base_commit` + `problem_statement`; Expected Outcome = the golden `patch`/`test_patch` passing ([paper](https://arxiv.org/abs/2310.06770v3)).
- **Flags**: (1) heavy infrastructure — each instance needs its own Docker image; (2) high contamination (public repos); (3) no per-instance difficulty label (Lite was selected for cost/quality balance, not difficulty).

## Mechanical derivation of Task Instance fields

Per the GLOSSARY (`Task Instance` = one concrete task with an **initial state** and an **expected outcome**), the candidates map as follows:

- **Initial State**: codegen = prompt + signature (MBPP/HumanEval); extraction = document + key list (Kleister); Q&A = paragraph + question (DROP/QuALITY); agentic = repo @ `base_commit` + `problem_statement` (SWE-bench).
- **Expected Outcome**: codegen = hidden tests pass; extraction = golden key→value table; Q&A = gold answer(s) / `gold_label`; agentic = `test_patch` / `FAIL_TO_PASS` tests pass.
- **Difficulty**: **none of the primary candidates labels difficulty per instance** except QuALITY's `difficult` flag. Difficulty must be derived post-hoc (e.g., baseline pass rate), which the map's "Difficulty tiers" fog item already anticipates.

## Gaps flagged

1. **Structured extraction** has no clean-license, deterministic, text-only public source found — Kleister is the canonical KIE benchmark but is unlicensed and PDF-based. This is the one task type where **synthetic data may be the right call**.
2. All primary candidates are pre-2023 and heavily represented in frontier-model training data → **contamination** is the dominant threat to validity; LiveCodeBench is the only contamination-controlled option surfaced (codegen only).
