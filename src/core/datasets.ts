import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The frozen Task Dataset (ADR-0003, amended by ADR-0007): one Task Instance
 * envelope per line in `datasets/<task_type>/<seed>/instances.jsonl`, a JSON
 * Schema at `datasets/schema/task-instance.schema.json`, and `datasets/pins.json`
 * pinning every file's sha256, source revision, and license.
 *
 * This module is the single source of truth for the envelope, the four verifier
 * pointers (ADR-0005) and the validation CI runs. Re-freezing writes through
 * `scripts/fetch-datasets.ts`, which imports these same types.
 */

export const TASK_TYPES = [
  "code_generation",
  "corpus_qa",
  "structured_extraction",
  "agentic_repo_task",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export type VerifierName =
  | "mbpp_unit_tests"
  | "golden_fields_exact"
  | "drop_em_f1"
  | "swebench_test_suite";

/**
 * The four verifier pointers, verbatim from ADR-0005. Semantics live with the
 * Evaluation Engine; the dataset stores only the pointer, so any change here is
 * a scoring change and forces a re-freeze (validation asserts these exactly).
 */
export const VERIFIER_PARAMS: Readonly<Record<VerifierName, Readonly<Record<string, unknown>>>> = {
  mbpp_unit_tests: {
    image: "python:3.12-slim",
    network: false,
    per_test_timeout_s: 10,
    total_timeout_s: 30,
  },
  golden_fields_exact: { trim: true, case_sensitive: true, extra_keys: "ignored" },
  drop_em_f1: { normalization: "drop-canonical" },
  swebench_test_suite: { per_test_timeout_s: 120, total_timeout_s: 1800 },
};

/** One verifier per task type — the uniform rule of ADR-0005. */
export const TASK_TYPE_VERIFIER: Readonly<Record<TaskType, VerifierName>> = {
  code_generation: "mbpp_unit_tests",
  corpus_qa: "drop_em_f1",
  structured_extraction: "golden_fields_exact",
  agentic_repo_task: "swebench_test_suite",
};

export type DifficultyTier = "easy" | "medium" | "hard";

/** Filled by the Calibration Run (Phase 2 of the dataset freeze); null before it. */
export interface DifficultyRecord {
  readonly tier: DifficultyTier;
  readonly baseline_pass_rate: number;
  readonly calibrated_at: string;
}

export interface ContaminationDisclosure {
  readonly disclosed: boolean;
  readonly notes: string;
}

/** Provenance of the Seed Dataset a Task Instance was derived from. */
export interface SeedRef {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly source_url: string;
}

export interface VerifierRef {
  readonly name: VerifierName;
  readonly params: Readonly<Record<string, unknown>>;
}

/** Code generation (MBPP): prompt + signature in, hidden tests out. */
export interface CodegenInitialState {
  readonly prompt: string;
  readonly entry_point: string;
  readonly function_signature: string;
  /** Module-level setup MBPP's hidden tests expect (usually empty). */
  readonly test_setup_code: string;
}

export interface CodegenExpectedOutcome {
  /** The 3 hidden tests, verbatim assert statements (ADR-0005 runs one subprocess each). */
  readonly tests: readonly string[];
  readonly entry_point: string;
}

/** Corpus Q&A (DROP): paragraph + question in, gold + validated answers out. */
export interface CorpusQaInitialState {
  readonly passage: string;
  readonly question: string;
}

export interface CorpusQaExpectedOutcome {
  /** Gold answer surfaces: spans, or a number/date rendered as strings. */
  readonly answers: readonly string[];
  /** Human-validated alternates; DROP's canonical EM/F1 takes the max over these (ADR-0005). */
  readonly validated_answers: readonly (readonly string[])[];
  /** DROP answer types present in the gold answer: "span" | "number" | "date". */
  readonly answer_types: readonly ("span" | "number" | "date")[];
}

/** Structured extraction: document text + key list in, golden key→value JSON out. */
export interface ExtractionInitialState {
  readonly document: string;
  readonly keys: readonly string[];
}

export interface ExtractionExpectedOutcome {
  readonly fields: Readonly<Record<string, string>>;
}

/** Agentic repo task (SWE-bench Lite): a pinned eval image + the issue in, a test patch out. */
export interface AgenticImageRef {
  /** Per-arch image tags; ADR-0007 names `swebench/sweb.eval.{x86_64,arm64}.{instance_id}`. */
  readonly tags: Readonly<Record<"x86_64" | "arm64", string>>;
  /** Manifest digests, one per arch — null until `--pin-digests` can reach a registry. */
  readonly digests: Readonly<Record<"x86_64" | "arm64", string | null>>;
  readonly digest_status: "pinned" | "unpinned";
}

export interface AgenticInitialState {
  readonly image: AgenticImageRef;
  readonly repo: string;
  readonly base_commit: string;
  readonly problem_statement: string;
}

export interface AgenticExpectedOutcome {
  readonly test_patch: string;
  readonly fail_to_pass: readonly string[];
  readonly pass_to_pass: readonly string[];
}

interface InstanceEnvelope<TTaskType extends TaskType, TInitial, TExpected> {
  readonly id: string;
  readonly task_type: TTaskType;
  readonly seed: SeedRef;
  readonly initial_state: TInitial;
  readonly expected_outcome: TExpected;
  readonly verifier: VerifierRef;
  /** null pre-calibration (ADR-0003); the Calibration Run fills it. */
  readonly difficulty: DifficultyRecord | null;
  readonly contamination: ContaminationDisclosure;
}

export type CodegenInstance = InstanceEnvelope<
  "code_generation",
  CodegenInitialState,
  CodegenExpectedOutcome
>;
export type CorpusQaInstance = InstanceEnvelope<
  "corpus_qa",
  CorpusQaInitialState,
  CorpusQaExpectedOutcome
>;
export type ExtractionInstance = InstanceEnvelope<
  "structured_extraction",
  ExtractionInitialState,
  ExtractionExpectedOutcome
>;
export type AgenticInstance = InstanceEnvelope<
  "agentic_repo_task",
  AgenticInitialState,
  AgenticExpectedOutcome
>;

export type TaskInstance =
  | CodegenInstance
  | CorpusQaInstance
  | ExtractionInstance
  | AgenticInstance;

/** One pinned file in `datasets/pins.json`. */
export interface DatasetPin {
  readonly task_type: TaskType;
  readonly seed: string;
  readonly path: string;
  readonly instances: number;
  readonly sha256: string;
  readonly license: string;
  readonly attribution: string;
  readonly derivation: string;
  readonly source: {
    readonly url: string;
    readonly revision: string;
    readonly license: string;
    readonly sha256: string | null;
  };
}

export interface DatasetPins {
  readonly format_version: number;
  readonly generated_at: string;
  readonly fetch_script: string;
  readonly verifier_params: Readonly<Record<VerifierName, Readonly<Record<string, unknown>>>>;
  readonly datasets: readonly DatasetPin[];
  readonly agentic_images: {
    readonly digest_status: "pinned" | "unpinned";
    readonly note: string;
  };
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function datasetDir(root = "datasets"): string {
  return root;
}

/**
 * Parse one `instances.jsonl` file. Blank lines are rejected: a frozen dataset
 * is machine-written, so a blank line means a broken freeze, not a quirk.
 */
export function parseInstanceFile(text: string): TaskInstance[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => JSON.parse(line) as TaskInstance);
}

export function loadInstanceFile(path: string): TaskInstance[] {
  return parseInstanceFile(readFileSync(path, "utf8"));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function checkStringArray(
  value: unknown,
  field: string,
  errors: string[],
  allowEmpty = false,
): void {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${field}: expected a non-empty array`);
    return;
  }
  value.forEach((item, i) => {
    if (!nonEmptyString(item)) errors.push(`${field}[${i}]: expected a non-empty string`);
  });
}

/**
 * Validate one Task Instance against its type's envelope. Returns human-readable
 * errors (empty = valid). Kept hand-rolled and dependency-free: the schema file
 * documents the same shape, and CI runs both this and the pins check.
 */
export function validateInstance(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["instance: expected an object"];

  if (!nonEmptyString(value["id"])) errors.push("id: expected a non-empty string");

  const taskType = value["task_type"];
  if (!TASK_TYPES.includes(taskType as TaskType)) {
    return [...errors, `task_type: expected one of ${TASK_TYPES.join(", ")}`];
  }
  const type = taskType as TaskType;

  const seed = value["seed"];
  if (!isRecord(seed)) {
    errors.push("seed: expected an object");
  } else {
    for (const field of ["name", "version", "license", "source_url"] as const) {
      if (!nonEmptyString(seed[field])) errors.push(`seed.${field}: expected a non-empty string`);
    }
  }

  const verifier = value["verifier"];
  const expectedVerifier = TASK_TYPE_VERIFIER[type];
  if (!isRecord(verifier)) {
    errors.push("verifier: expected an object");
  } else if (verifier["name"] !== expectedVerifier) {
    errors.push(`verifier.name: ${type} must use ${expectedVerifier}`);
  } else if (
    JSON.stringify(verifier["params"]) !== JSON.stringify(VERIFIER_PARAMS[expectedVerifier])
  ) {
    errors.push(`verifier.params: must match the pinned params for ${expectedVerifier} (ADR-0005)`);
  }

  if (value["difficulty"] !== null) {
    const difficulty = value["difficulty"];
    if (!isRecord(difficulty)) {
      errors.push("difficulty: expected null pre-calibration or a calibrated record");
    } else {
      const tier = difficulty["tier"];
      if (tier !== "easy" && tier !== "medium" && tier !== "hard") {
        errors.push(`difficulty.tier: expected easy|medium|hard`);
      }
      const rate = difficulty["baseline_pass_rate"];
      if (typeof rate !== "number" || rate < 0 || rate > 1) {
        errors.push("difficulty.baseline_pass_rate: expected a number in [0, 1]");
      }
      if (!nonEmptyString(difficulty["calibrated_at"])) {
        errors.push("difficulty.calibrated_at: expected a timestamp");
      }
    }
  }

  const contamination = value["contamination"];
  if (!isRecord(contamination)) {
    errors.push("contamination: expected an object");
  } else {
    if (contamination["disclosed"] !== true) errors.push("contamination.disclosed: must be true");
    if (!nonEmptyString(contamination["notes"]))
      errors.push("contamination.notes: expected a note");
  }

  const initial = value["initial_state"];
  const expected = value["expected_outcome"];
  if (!isRecord(initial)) errors.push("initial_state: expected an object");
  if (!isRecord(expected)) errors.push("expected_outcome: expected an object");
  if (!isRecord(initial) || !isRecord(expected)) return errors;

  if (type === "code_generation") {
    for (const field of ["prompt", "entry_point", "function_signature"] as const) {
      if (!nonEmptyString(initial[field]))
        errors.push(`initial_state.${field}: expected a non-empty string`);
    }
    if (typeof initial["test_setup_code"] !== "string") {
      errors.push("initial_state.test_setup_code: expected a string (may be empty)");
    }
    if (!Array.isArray(expected["tests"]) || expected["tests"].length !== 3) {
      errors.push("expected_outcome.tests: MBPP instances carry exactly 3 hidden tests (ADR-0005)");
    } else {
      expected["tests"].forEach((test, i) => {
        if (!nonEmptyString(test))
          errors.push(`expected_outcome.tests[${i}]: expected a non-empty string`);
      });
    }
    if (!nonEmptyString(expected["entry_point"])) {
      errors.push("expected_outcome.entry_point: expected a non-empty string");
    }
    if (!nonEmptyString(initial["test_setup_code"]) && initial["test_setup_code"] !== "") {
      errors.push("initial_state.test_setup_code: expected a string");
    }
  }

  if (type === "corpus_qa") {
    for (const field of ["passage", "question"] as const) {
      if (!nonEmptyString(initial[field]))
        errors.push(`initial_state.${field}: expected a non-empty string`);
    }
    checkStringArray(expected["answers"], "expected_outcome.answers", errors);
    if (!Array.isArray(expected["validated_answers"])) {
      errors.push("expected_outcome.validated_answers: expected an array (may be empty)");
    } else {
      expected["validated_answers"].forEach((answer, i) =>
        checkStringArray(answer, `expected_outcome.validated_answers[${i}]`, errors),
      );
    }
    checkStringArray(expected["answer_types"], "expected_outcome.answer_types", errors);
  }

  if (type === "structured_extraction") {
    if (!nonEmptyString(initial["document"])) {
      errors.push("initial_state.document: expected the document text");
    }
    checkStringArray(initial["keys"], "initial_state.keys", errors);
    const fields = expected["fields"];
    if (!isRecord(fields) || Object.keys(fields).length === 0) {
      errors.push("expected_outcome.fields: expected a non-empty key→value map");
    } else {
      for (const [key, fieldValue] of Object.entries(fields)) {
        if (!nonEmptyString(key)) errors.push("expected_outcome.fields: empty key");
        if (typeof fieldValue !== "string") {
          errors.push(`expected_outcome.fields.${key}: golden values are strings (ADR-0005)`);
        }
        if (Array.isArray(initial["keys"]) && !(initial["keys"] as unknown[]).includes(key)) {
          errors.push(`expected_outcome.fields.${key}: not listed in initial_state.keys`);
        }
      }
      if (Array.isArray(initial["keys"])) {
        for (const key of initial["keys"] as unknown[]) {
          if (typeof key === "string" && !(key in fields)) {
            errors.push(`initial_state.keys: ${key} has no golden value`);
          }
        }
      }
    }
  }

  if (type === "agentic_repo_task") {
    const image = initial["image"];
    if (!isRecord(image)) {
      errors.push("initial_state.image: expected an object");
    } else {
      const tags = image["tags"];
      const digests = image["digests"];
      if (!isRecord(tags) || !nonEmptyString(tags["x86_64"]) || !nonEmptyString(tags["arm64"])) {
        errors.push("initial_state.image.tags: expected x86_64 and arm64 image tags");
      }
      if (!isRecord(digests)) {
        errors.push("initial_state.image.digests: expected per-arch digests (null before pinning)");
      } else {
        for (const arch of ["x86_64", "arm64"] as const) {
          const digest = digests[arch];
          if (digest !== null && !/^sha256:[0-9a-f]{64}$/.test(String(digest))) {
            errors.push(`initial_state.image.digests.${arch}: expected sha256:<64 hex> or null`);
          }
        }
        const anyPinned = digests["x86_64"] !== null || digests["arm64"] !== null;
        const status = image["digest_status"];
        if (status === "pinned" && !anyPinned) {
          errors.push("initial_state.image.digest_status: pinned requires at least one digest");
        }
        if (status !== "pinned" && status !== "unpinned") {
          errors.push("initial_state.image.digest_status: expected pinned|unpinned");
        }
      }
    }
    for (const field of ["repo", "base_commit", "problem_statement"] as const) {
      if (!nonEmptyString(initial[field]))
        errors.push(`initial_state.${field}: expected a non-empty string`);
    }
    if (!nonEmptyString(expected["test_patch"])) {
      errors.push("expected_outcome.test_patch: expected the golden test patch");
    }
    checkStringArray(expected["fail_to_pass"], "expected_outcome.fail_to_pass", errors);
    // 6 Lite instances define no PASS_TO_PASS tests at all — empty is legal upstream data.
    checkStringArray(expected["pass_to_pass"], "expected_outcome.pass_to_pass", errors, true);
  }

  return errors;
}

export interface DatasetFileReport {
  readonly path: string;
  readonly taskType: TaskType | null;
  readonly instances: number;
  readonly sha256: string;
  readonly errors: readonly string[];
}

/** Validate one `instances.jsonl` file: envelope, ids, and `datasets/<type>/<seed>` placement. */
export function validateInstanceFile(path: string, root = "datasets"): DatasetFileReport {
  const text = readFileSync(path, "utf8");
  const relativePath = relative(root, path).split("\\").join("/");
  const [typeSegment] = relativePath.split("/");
  const taskType = TASK_TYPES.includes(typeSegment as TaskType) ? (typeSegment as TaskType) : null;
  const errors: string[] = [];
  let instances: TaskInstance[] = [];
  try {
    instances = parseInstanceFile(text);
  } catch (error) {
    errors.push(`parse: ${(error as Error).message}`);
  }
  if (taskType === null) errors.push(`path: expected datasets/<task_type>/<seed>/instances.jsonl`);
  if (instances.length === 0) errors.push("instances: expected at least one line");

  const seen = new Set<string>();
  instances.forEach((instance, line) => {
    for (const error of validateInstance(instance)) errors.push(`line ${line + 1}: ${error}`);
    if (seen.has(instance.id)) errors.push(`line ${line + 1}: duplicate id ${instance.id}`);
    seen.add(instance.id);
    if (taskType !== null && instance.task_type !== taskType) {
      errors.push(`line ${line + 1}: task_type ${instance.task_type} does not match directory`);
    }
  });

  return {
    path: relativePath,
    taskType,
    instances: instances.length,
    sha256: sha256Hex(text),
    errors,
  };
}

export function instanceFiles(root = "datasets"): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === "instances.jsonl") found.push(path);
    }
  };
  if (!existsSync(root)) return found;
  walk(root);
  return found.sort();
}

export function loadPins(root = "datasets"): DatasetPins {
  return JSON.parse(readFileSync(join(root, "pins.json"), "utf8")) as DatasetPins;
}

/**
 * The CI gate: every instance file validates, `datasets/pins.json` covers every
 * file with the right sha256, and the schema file is present. Returns errors.
 */
export function validateDatasetTree(root = "datasets"): string[] {
  const errors: string[] = [];
  const files = instanceFiles(root);
  if (files.length === 0) return [`${root}: no instances.jsonl files found`];

  const schemaPath = join(root, "schema", "task-instance.schema.json");
  if (!existsSync(schemaPath)) errors.push(`${schemaPath}: missing`);

  let pins: DatasetPins | null = null;
  try {
    pins = loadPins(root);
  } catch (error) {
    errors.push(`${root}/pins.json: ${(error as Error).message}`);
  }

  const pinned = new Map<string, DatasetPin>();
  if (pins) {
    if (pins.format_version !== 1) errors.push("pins.format_version: expected 1");
    for (const pin of pins.datasets) pinned.set(pin.path, pin);
    for (const [name, params] of Object.entries(VERIFIER_PARAMS)) {
      if (JSON.stringify(pins.verifier_params[name as VerifierName]) !== JSON.stringify(params)) {
        errors.push(`pins.verifier_params.${name}: out of date with ADR-0005`);
      }
    }
  }

  for (const file of files) {
    const report = validateInstanceFile(file, root);
    const datasetPath = `${root}/${report.path}`;
    for (const error of report.errors) errors.push(`${report.path}: ${error}`);
    if (!pins) continue;
    const pin = pinned.get(datasetPath);
    if (!pin) {
      errors.push(`${report.path}: missing from pins.json`);
      continue;
    }
    if (pin.sha256 !== report.sha256) {
      errors.push(`${report.path}: sha256 mismatch (pins ${pin.sha256}, file ${report.sha256})`);
    }
    if (pin.instances !== report.instances) {
      errors.push(
        `${report.path}: instance count mismatch (pins ${pin.instances}, file ${report.instances})`,
      );
    }
    if (report.taskType !== null && pin.task_type !== report.taskType) {
      errors.push(`${report.path}: pins task_type ${pin.task_type} does not match directory`);
    }
    if (!nonEmptyString(pin.license)) errors.push(`${report.path}: pins license is required`);
    if (!nonEmptyString(pin.attribution))
      errors.push(`${report.path}: pins attribution is required`);
  }

  const onDisk = new Set(
    files.map((file) => `${root}/${relative(root, file).split("\\").join("/")}`),
  );
  for (const path of pinned.keys()) {
    if (!onDisk.has(path)) errors.push(`${path}: pinned in pins.json but file is missing`);
  }

  return errors;
}
