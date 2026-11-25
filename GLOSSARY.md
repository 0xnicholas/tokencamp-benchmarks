# tokencamp-benchmarks

A benchmark platform measuring two economics of intelligence resources: what they cost to procure (Token Economics) and how efficiently they turn into business results (Task Economics).

## Language

**Token Economics**:
The economics of procuring intelligence resources: how much capability a model delivers per unit of spend. Measured by Model Benchmarks.
_Avoid_: Inference cost alone, per-token pricing

**Task Economics** (任务经济学):
The economics of converting intelligence resources into business results: how much it costs to get a task actually done. Measured by Task Benchmarks.
_Avoid_: Business value analysis, ROI

**Model Benchmark**:
A benchmark that measures a single-shot model call (quality, cost, speed) against a capability dataset.
_Avoid_: Capability eval, model eval

**Model Matrix** (模型矩阵):
The pinned, versioned roster of models — tokencamp catalog id × upstream provider × Price Tier — that v1 runs through the tokencamp API: every matrix model runs the Model Benchmarks and is a legal model inside any Task Configuration. Nothing outside the matrix runs.
_Avoid_: Model list, supported models

**Task Benchmark**:
A benchmark that measures Task Configurations (quality, reliability, cost) against a task dataset.
_Avoid_: Agent eval, end-to-end eval

**Task Configuration**:
The complete stack that completes a task: model, prompt/context, tools, Agent Loop, and runtime. A single-shot model call is the degenerate form (no tools, no loop).
_Avoid_: Agent setup, eval config

**Agent Loop** (智能体循环):
The fixed, harness-driven loop a Task Configuration uses to complete an agentic task: repeated model calls, each possibly requesting tool executions, until the model stops or a budget is exhausted.
_Avoid_: Agent framework, workflow engine

**Sandbox** (沙箱):
The isolated container where a Task Configuration's tool calls execute; model-generated code and commands run only there, with no network.
_Avoid_: VM, jail

**Tool Call** (工具调用):
One tool invocation the model requests inside an Agent Loop; its billed wall-clock time feeds Tool Cost.
_Avoid_: Action, function call

**Turn** (回合):
One model call in an Agent Loop plus the execution of the tool calls it requested.
_Avoid_: Confusing with Epoch

**Task Type** (任务类型):
A category of tasks sharing a verification method (e.g., code generation, structured extraction, corpus Q&A).
_Avoid_: Benchmark family

**Task Instance**:
One concrete task with an initial state and an expected outcome, belonging to a Task Type.

**Evaluation Engine** (评估引擎):
The harness component that runs a Task Type's Verifier on each task outcome and records the Quality Gate verdict, Quality Score, and per-unit verification detail.

**Quality Gate** (质量门):
The binary pass/fail verdict (Task Success) for a task outcome, produced by the Evaluation Engine: an outcome passes when its Quality Score is exactly 1.0 (perfect completion of the expected outcome).
_Avoid_: Acceptance criteria

**Quality Score**:
A 0–1 score for a task outcome measuring progress toward the expected outcome, comparable within a Task Type; 1.0 is perfect completion and passes the Quality Gate.

**Reliability** (可靠性):
The fraction of Epochs of a Task Instance whose outcomes pass the Quality Gate; a Task Configuration's Reliability is the mean across Task Instances.

**Effective Task** (有效任务):
A task outcome that passes the Quality Gate.

**CPET** (Cost Per Effective Task):
Total settled spend across all attempts of a task (tokens + tools, including failures and retries) divided by the number of Effective Tasks. The headline metric of Task Economics.
_Avoid_: Cost per task, average cost

**Waste Share** (浪费占比):
Spend on gate-failed attempts divided by total spend, computed at every aggregation level.
_Avoid_: Failure rate, waste

**Task Economics Report** (任务经济学报告):
The published output of a benchmark run: task cost ranking, efficiency diagnosis, optimization suggestions, and the quality–CPET Pareto frontier.

**Benchmark Run**:
One dated, reproducible execution of a benchmark layer against a pinned set of configurations, producing artifacts that every published score links back to.

**Attempt** (尝试):
One outcome-producing evaluation of a Task Instance by a Task Configuration: a single model call for single-shot types, a full Agent Loop for the agentic repo task. Every attempt's spend counts toward CPET.
_Avoid_: Confusing with Epoch — an Epoch is the repeated evaluation of an instance; an Attempt is one evaluation's outcome.

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
A versioned mapping from model to per-token price, plus sandbox machine rates, with provenance and pin date, used to convert usage into cost.
_Avoid_: Live price lookup, dynamic pricing

**Settled Cost** (结算成本):
The customer-paid cost per attempt, from tokencamp's per-request settle. The headline cost source for CPET.
_Avoid_: Billed cost

**Computed Cost** (计算成本):
Usage multiplied by the Pinned Price Table. The reproducible cost anchor, kept per attempt for diagnosis.
_Avoid_: Estimated cost

**Tool Cost** (工具成本):
The spend a Task Configuration incurs for agent-invoked tool execution: billed sandbox wall-clock time multiplied by a pinned machine rate. Zero for tool-free configurations.
_Avoid_: Infrastructure cost, execution fee

**Harness Overhead** (工具链开销):
Benchmark-side execution cost (verifier runs), excluded from CPET and disclosed separately in the run summary.
_Avoid_: Hidden cost

**Price Tier** (价格档位):
One of three cost bands a matrix model belongs to — Budget (低成本), Standard (标准成本), Premium (高性能、高成本) — assigned from pinned price and capability position, used to slice quality-per-dollar and quality–CPET charts. A reporting attribute, not a selection gate.
_Avoid_: Frontier / mid / cheap

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

**Verifier** (验证器):
The deterministic check of a Task Type that compares a task outcome against the Golden Answer and produces the Quality Gate verdict and Quality Score.

**Difficulty** (难度):
A per-Task-Instance attribute derived post-hoc from Baseline Pass Rate, in three tiers (easy / medium / hard) computed per Task Type.
_Avoid_: Human-rated difficulty, hardness label

**Baseline Pass Rate** (基线通过率):
The pass rate of the Calibration Configuration over repeated runs of a Task Instance, produced by a Calibration Run. The basis for Difficulty.
_Avoid_: Score, ranking

**Calibration Run** (校准跑):
A pinned, low-cost Benchmark Run that derives Baseline Pass Rates and fills in Difficulty before the first official report run.
_Avoid_: Warm-up run, smoke test

**Calibration Configuration** (校准配置):
The pinned Task Configuration used by the Calibration Run — the cheapest Budget-tier matrix model, single-shot (no tools, no loop) — shared across all Task Types.
_Avoid_: Warm-up config, baseline config
