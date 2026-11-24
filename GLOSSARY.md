# tokencamp-benchmarks

A benchmark platform measuring two economics of intelligence resources: what they cost to procure (Token Economics) and how efficiently they turn into business results (Task Economics).

## Language

**Token Economics** (代币经济学):
The economics of procuring intelligence resources: how much capability a model delivers per unit of spend. Measured by Model Benchmarks.
_Avoid_: Inference cost alone, per-token pricing

**Task Economics** (任务经济学):
The economics of converting intelligence resources into business results: how much it costs to get a task actually done. Measured by Task Benchmarks.
_Avoid_: Business value analysis, ROI

**Model Benchmark**:
A benchmark that measures a single-shot model call (quality, cost, speed) against a capability dataset.
_Avoid_: Capability eval, model eval

**Task Benchmark**:
A benchmark that measures Task Configurations (quality, reliability, cost) against a task dataset.
_Avoid_: Agent eval, end-to-end eval

**Task Configuration**:
The complete stack that completes a task: model, prompt/context, tools, agent loop, and runtime. A single-shot model call is the degenerate form (no tools, no loop).
_Avoid_: Agent setup, eval config

**Task Type** (任务类型):
A category of tasks sharing a verification method (e.g., code generation, structured extraction, corpus Q&A).
_Avoid_: Benchmark family

**Task Instance**:
One concrete task with an initial state and an expected outcome, belonging to a Task Type.

**Quality Gate** (质量门):
The binary pass/fail verdict (Task Success) for a task outcome, produced by the Evaluation Engine.
_Avoid_: Acceptance criteria

**Quality Score**:
A 0–1 score for a task outcome, comparable within a Task Type.

**Reliability** (可靠性):
The pass rate of a Task Configuration over repeated runs of the same Task Instance.

**Effective Task** (有效任务):
A task outcome that passes the Quality Gate.

**CPET** (Cost Per Effective Task):
Total spend across all attempts of a task (including failures and retries) divided by the number of Effective Tasks. The headline metric of Task Economics.
_Avoid_: Cost per task, average cost

**Task Economics Report** (任务经济学报告):
The published output of a benchmark run: task cost ranking, efficiency diagnosis, optimization suggestions, and the quality–CPET Pareto frontier.

**Benchmark Run**:
One dated, reproducible execution of a benchmark layer against a pinned set of configurations, producing artifacts that every published score links back to.

**Attempt** (尝试):
One call to a model made by a Task Configuration while completing a Task Instance. Every attempt's spend counts toward CPET.
_Avoid_: Confusing with Epoch — one attempt is not one evaluation.

**Epoch** (轮次):
One repeated evaluation of a Task Instance by the same configuration. Repeated epochs yield Reliability and pass@k statistics.
_Avoid_: Confusing with Attempt.

**Trace ID** (追踪标识):
An identifier attached to each model call that links that call to its attempt in the Run Artifact.
_Avoid_: Session identifier, request number

**Generation Resolver** (生成解析器):
The harness piece that executes a model call: it takes a call request and returns the model output with normalized token usage.
_Avoid_: Provider SDK, provider client

**Pinned Price Table** (固定价格表):
A versioned mapping from model to per-token price, with provenance and pin date, used to convert usage into cost.
_Avoid_: Live price lookup, dynamic pricing

**Run Artifact** (运行产物):
The immutable record of a Benchmark Run — configuration, attempts, usage, cost, and scores — the evidence every published score links to.
_Avoid_: Logs, report

**Task Dataset** (任务数据集):
The frozen, versioned collection of Task Instances and their Golden Answers that a Task Benchmark runs against.
_Avoid_: Raw benchmark data, test set

**Seed Dataset** (源数据集):
The upstream source — a public dataset, or an in-house generator — from which a Task Dataset's instances are derived.
_Avoid_: Raw corpus, source data

**Golden Answer** (标准答案):
The expected-outcome artifact attached to a Task Instance — hidden tests, golden key-values, gold answer, or golden patch — that the verifier checks the produced outcome against.
_Avoid_: Ground truth label, reference solution

**Difficulty** (难度):
A per-Task-Instance attribute derived post-hoc from Baseline Pass Rate, in three tiers (easy / medium / hard) computed per Task Type.
_Avoid_: Human-rated difficulty, hardness label

**Baseline Pass Rate** (基线通过率):
The pass rate of a pinned reference configuration over repeated runs of a Task Instance, produced by a Calibration Run. The basis for Difficulty.
_Avoid_: Score, ranking

**Calibration Run** (校准跑):
A pinned, low-cost Benchmark Run that derives Baseline Pass Rates and fills in Difficulty before the first official report run.
_Avoid_: Warm-up run, smoke test
