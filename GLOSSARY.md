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
