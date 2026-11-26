# Benchmarks API: public static JSON on GitHub Pages, not a backend service

The Task Economics Report renders on tokencamp-www's benchmarks page; this repo ships the machine-readable layer that page renders from. Resolved through grilling (issue #17); the report assembler and CI pipeline build tickets implement it. The API is public, read-only, unauthenticated, and served as static JSON from GitHub Pages — a versioned `report.json` contract, not harness internals — with every published run retained forever.

## Contract

- `/runs.json` — append-only runs index (`runId`, `date`, `gitSha`, `configHash`, `reportUrl`) plus a `latest` pointer. Never rewritten; new runs append.
- `/runs/<runId>/report.json` — the Report Payload, schema versioned by `format_version`: header KPI facts (headline CPET, effective tasks, waste share, frontier configs, per-type CPET range), model layer (quality / value / speed per matrix model, tier badges), task layer (per type: Pareto frontier, cost ranking, efficiency diagnosis, optimization suggestions), every score carrying ⚙/$/⧉ evidence refs to the run's artifacts.
- `/runs/<runId>/manifest.json`, `/runs/<runId>/summary.json`, `/runs/<runId>/results.jsonl` — public, immutable evidence records linked from scores.
- Consumers depend on `report.json` alone; `summary.json` stays a harness-shaped artifact exposed as evidence, free to evolve internally.

## Origin

Default origin `0xnicholas.github.io/tokencamp-benchmarks/`; a custom `benchmarks.<tokencamp domain>` lands once the tokencamp domain decision is made — an origin swap with paths unchanged, so published links survive.

## Considered options

- tokencamp-pro-hosted `/feed/benchmarks` — rejected for v1: real backend work (storage, upload API, endpoint) for no public-access gain; revisit if the portal wants to surface CPET.
- Raw artifact passthrough (`summary.json` as the contract) — rejected: harness internals become a breaking API; `report.json` is the stable seam (#13's assembler).
- Object storage (R2/S3) behind the same domain — the scale-out path if evidence files outgrow Pages; URL contract identical.
- Gated access — rejected: the feeds and the www site are public; auth would force the tokencamp-pro option.

## Consequences

- #8's standalone HTML artifact is retired; its agreed format becomes tokencamp-www's design spec (prototype branch `prototype/task-economics-report-format` is the reference).
- The report assembler consumes `summary.json` + manifest and emits `report.json` + the runs index (build ticket, blocked by the cost-module and evaluation-engine builds).
- The CI pipeline build ticket (run + publish to Pages) graduates the map's CI-infrastructure fog; runner requirements per ADR-0007.
- GLOSSARY: Benchmarks API and Report Payload added.
