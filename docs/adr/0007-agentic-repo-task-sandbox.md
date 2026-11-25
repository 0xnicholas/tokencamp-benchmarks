# Agentic repo task: Docker sandbox on SWE-bench eval images, fixed OpenAI-tools loop

The agentic repo task runs inside a Docker sandbox built from SWE-bench's official per-instance eval images (network off, no host mounts), driven by a fixed harness loop over the OpenAI tool-calling protocol with a five-tool allowlist and hard budgets; each epoch is one attempt row whose `toolCalls` block carries the billed wall-clock the economics engine prices as Tool Cost. Docker over E2B/Firecracker for zero-dependency local + CI operation; the eval image is the repo snapshot, superseding ADR-0003's clone-inside-sandbox wording.

## Sandbox

- **Runtime**: Docker via plain `docker` CLI subprocesses (no SDK); podman stays viable because the CLI surface is compatible. Containers are ephemeral (`--rm`), resource-limited (`--cpus`, `--memory`), non-privileged, and have **no host volume mounts** — the harness talks to the sandbox only through exec and stdin/stdout.
- **Image = repo snapshot**: SWE-bench publishes per-instance eval images (`swebench/sweb.eval.{x86_64,arm64}.{instance_id}`) with the repo checked out at `base_commit` and dependencies installed. The instance's `initial_state` carries the image tag **and digest** (pinned in the frozen dataset; pull by tag@digest); the repo lives at `/testbed` inside the image. This supersedes ADR-0003's "the harness clones at `base_commit` inside the sandbox" — no clone happens at run time. A configurable registry-prefix env var covers Docker Hub mirrors (required for runs in mainland China).
- **Network policy**: off for the task phase and off for verification. Environments are self-contained; dependency installation is frozen into the image, never done at run time.
- **Wall-clock metering**: the harness measures each tool call from exec start to exit (ms). Container startup and image pulls are harness overhead (disclosed, excluded from CPET), not tool cost — Tool Cost is billed tool-call time only (ADR-0006).
- **Machine rate**: one v1 spec `docker:4cpu:16gb` at **$0.20/hour**, provenance = public cloud list price for a comparable VM (e.g. AWS m7i.xlarge ≈ $0.20/h), pinned with date, stored in `prices.json`'s `sandbox_rates` (cost-module ticket). One spec, one rate in v1.

## The fixed agent loop

- **Protocol**: OpenAI tool-calling through the tokencamp adapter's non-streaming `generate()` (the resolver gains a `tools` passthrough and returns `toolCalls`). The harness drives the loop. Models that cannot tool-call, or emit invalid tool calls, fail the epoch and pay their spend — a measured capability gap, never special-cased.
- **Turn**: one model call plus sequential execution of the tool calls it requests, results fed back as tool messages. Budgets (all CLI-overridable): turn cap **30**; per-tool-call wall-clock timeout **600s**; epoch wall-clock cap **1800s**; tool-call count cap **100**; no token cap (token spend is what CPET measures; the run-level `--max-spend-usd` guard covers cost). Budget exhaustion ends the loop but the epoch still verifies, with a status flag on the attempt row — consistent with ADR-0005's never-drop-a-row policy.
- **Tool allowlist (5)**: `list_files` (directory tree), `read_file` (optional line range), `write_file` (create/overwrite), `search` (grep across the tree), `run_command` (arbitrary bash — tests run through it; discovering the test command is part of the task). Tool outputs are truncated (8KB tail) for both the model and the artifact. The sandbox, not a path allowlist, is the confinement boundary.
- **Prompt**: one default system prompt template — role + instructions + `problem_statement` verbatim, no SWE-bench hints — shared by all nine matrix models; part of the pinned configuration (configHash covers it). Per-model prompt tuning is post-v1.

## Outcome, verification, and the attempt row

- **Outcome artifact**: for the full loop, the working-tree diff of `/testbed` vs `base_commit` (including untracked files); for the degenerate single-shot form, the patch the model emits as text, applied to a clean base. Both normalize to one patch, one verifier. The single-shot form runs only in the calibration run in v1; the first report runs full-loop configs only, and a loop-vs-single-shot comparison is post-v1 fog.
- **Verification**: a fresh container from the same instance image, network off — apply the model patch (`git apply`), apply `test_patch`, run each FAIL_TO_PASS and PASS_TO_PASS test individually (per-test timeout **120s**, suite total **1800s**), producing per-test results in SWE-bench report format, consumed by the `swebench_test_suite` verifier. Verification sandbox time is harness overhead, not tool cost.
- **Attempt shape**: one epoch = one attempt row (amends the Attempt glossary term). `rawCalls` holds the loop's model calls (summed usage); a new `toolCalls` block holds per-call `{toolName, wallClockMs, exitCode, stdoutTail, stderrTail}` — the ADR-0006 Tool Cost input. Verification-phase test runs are not tool calls.

## Considered options

- **E2B / Firecracker / podman** — E2B rejected: hosted cloud dependency, network round-trips, not locally reproducible. Firecracker rejected: real ops burden (kernel/rootfs per instance), overkill for benchmark workloads. podman kept as a fallback only; Docker won on ubiquity and SWE-bench's Docker-native tooling.
- **Generic python image + clone + per-repo install spec** — rejected: re-implements SWE-bench's install specs and inherits their reproducibility problems; 300 pinned official images beat ~10 self-built ones for fidelity to the benchmark.
- **Network on in the sandbox** — rejected: pip-install drift, nondeterminism, and an escape surface; the images are self-contained.
- **Hand-rolled text protocol** (XML/JSON tags in model output) — rejected: fragile parsing and prompt-sensitive; the OpenAI tools API is available through tokencamp for the matrix models.
- **One combined build ticket** — rejected: the sandbox driver's output contract (tool metering, patch application, per-test results) is consumed by the verifier and cost-module tickets, so it earns its own ticket and unblocks them early.

## Consequences

- Two build tickets: "Build the sandbox driver: containers, tool execution, metering, patch application" and "Build the agentic benchmark: fixed loop, tools, and single-shot form" — the latter blocked by the former, the harness core, the resolver, and the dataset freeze.
- The resolver ticket gains the `tools`/`toolCalls` seam; the cost-module ticket pins the machine rate, the `toolCalls` block, and the overhead exclusions; the dataset-freeze ticket vendors image tag+digest, `test_patch`, F2P/P2P lists, and the pinned verifier params; the evaluation-engine ticket consumes the sandbox driver's per-test results.
- GLOSSARY: Attempt redefined (one outcome-producing evaluation); Agent Loop, Sandbox, Tool Call, Turn added.
- Map fog: CI runners must support Docker with a configurable registry mirror; agentic loop-vs-single-shot comparison runs noted post-v1.
