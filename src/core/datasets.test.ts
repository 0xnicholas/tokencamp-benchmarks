import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  TASK_TYPE_VERIFIER,
  TASK_TYPES,
  VERIFIER_PARAMS,
  instanceFiles,
  loadInstanceFile,
  loadPins,
  validateDatasetTree,
  validateInstance,
  validateInstanceFile,
  type AgenticInstance,
  type CodegenInstance,
  type CorpusQaInstance,
  type ExtractionInstance,
} from "./datasets";

const ROOT = "datasets";
const instances = (path: string) => loadInstanceFile(`${ROOT}/${path}`);
const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const codegen = instances("code_generation/mbpp-test/instances.jsonl") as CodegenInstance[];
const corpusQa = instances("corpus_qa/drop-dev-stratified/instances.jsonl") as CorpusQaInstance[];
const extractBench = instances(
  "structured_extraction/extractbench-short-exact/instances.jsonl",
) as ExtractionInstance[];
const synthetic = instances(
  "structured_extraction/synthetic-v1/instances.jsonl",
) as ExtractionInstance[];
const agenticAll = instances(
  "agentic_repo_task/swebench-lite/instances.jsonl",
) as AgenticInstance[];
const agenticFirstReport = instances(
  "agentic_repo_task/swebench-lite-first-report/instances.jsonl",
) as AgenticInstance[];

describe("frozen task dataset (CI gate)", () => {
  test("every instance file validates and matches pins.json", () => {
    expect(validateDatasetTree(ROOT)).toEqual([]);
  });

  test("pins record licenses, attributions and the fetch script for every file", () => {
    const pins = loadPins(ROOT);
    expect(pins.fetch_script).toBe("scripts/fetch-datasets.ts");
    expect(pins.verifier_params).toEqual(VERIFIER_PARAMS);
    expect(pins.datasets).toHaveLength(instanceFiles(ROOT).length);
    for (const pin of pins.datasets) {
      expect(pin.license.length).toBeGreaterThan(0);
      expect(pin.attribution.length).toBeGreaterThan(0);
      expect(pin.source.revision.length).toBeGreaterThan(0);
      expect(pin.derivation.length).toBeGreaterThan(0);
    }
  });

  test("the ADR-0003 plan counts hold", () => {
    expect(codegen).toHaveLength(500);
    expect(corpusQa).toHaveLength(300);
    expect(extractBench).toHaveLength(100);
    expect(synthetic).toHaveLength(150);
    expect(agenticAll).toHaveLength(300);
    expect(agenticFirstReport).toHaveLength(50);
  });

  test("every instance is uncalibrated and discloses contamination", () => {
    for (const file of instanceFiles(ROOT)) {
      for (const instance of loadInstanceFile(file)) {
        expect(instance.difficulty).toBeNull();
        expect(instance.contamination.disclosed).toBe(true);
        expect(instance.contamination.notes.length).toBeGreaterThan(0);
        expect(instance.verifier.name).toBe(TASK_TYPE_VERIFIER[instance.task_type]);
      }
    }
  });

  test("ids are unique per file", () => {
    for (const file of instanceFiles(ROOT)) {
      const ids = loadInstanceFile(file).map((instance) => instance.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("code generation seed (MBPP test split)", () => {
  test("covers task ids 11–510, each with exactly 3 hidden tests", () => {
    const taskIds = codegen.map((instance) => Number(instance.id.replace("mbpp-test-", "")));
    expect(taskIds).toEqual([...taskIds].sort((a, b) => a - b));
    expect(taskIds[0]).toBe(11);
    expect(taskIds[taskIds.length - 1]).toBe(510);
    for (const instance of codegen) {
      expect(instance.expected_outcome.tests).toHaveLength(3);
      for (const test of instance.expected_outcome.tests) {
        expect(test.trim().startsWith("assert ")).toBe(true);
      }
    }
  });

  test("the initial state hands over the signature, not the solution", () => {
    for (const instance of codegen) {
      expect(instance.initial_state.function_signature).toContain(
        instance.initial_state.entry_point,
      );
      expect(instance.initial_state.prompt).not.toContain("def ");
    }
  });
});

describe("corpus Q&A seed (DROP dev, stratified)", () => {
  test("spans, numbers and dates are all represented", () => {
    const strata = new Set(corpusQa.flatMap((instance) => instance.expected_outcome.answer_types));
    expect(strata).toContain("span");
    expect(strata).toContain("number");
    expect(strata).toContain("date");
  });

  test("every instance carries a passage, a question and at least one gold answer", () => {
    for (const instance of corpusQa) {
      expect(instance.initial_state.passage.length).toBeGreaterThan(50);
      expect(instance.initial_state.question.length).toBeGreaterThan(5);
      expect(instance.expected_outcome.answers.length).toBeGreaterThan(0);
    }
  });
});

describe("structured extraction seeds", () => {
  test("ExtractBench golden keys are answerable from the vendored document text", () => {
    for (const instance of extractBench) {
      const document = squash(instance.initial_state.document);
      expect(Object.keys(instance.expected_outcome.fields)).toEqual([
        ...instance.initial_state.keys,
      ]);
      for (const value of Object.values(instance.expected_outcome.fields)) {
        expect(document).toContain(squash(value));
      }
    }
  });

  test("the synthetic seed is 5 templates × 30 deterministic variants", () => {
    expect(synthetic).toHaveLength(150);
    expect(new Set(synthetic.map((instance) => instance.id)).size).toBe(150);
    const keySets = new Set(synthetic.map((instance) => instance.initial_state.keys.join(",")));
    expect(keySets.size).toBe(5);
    for (const keySet of keySets) {
      const count = synthetic.filter(
        (instance) => instance.initial_state.keys.join(",") === keySet,
      ).length;
      expect(count).toBe(30);
    }
  });

  test("synthetic golden values are rendered verbatim into their document", () => {
    for (const instance of synthetic) {
      const document = squash(instance.initial_state.document);
      for (const value of Object.values(instance.expected_outcome.fields)) {
        expect(document).toContain(squash(value));
      }
    }
  });
});

describe("agentic repo task seed (SWE-bench Lite)", () => {
  test("instances carry the eval image tags, the base commit and the F2P/P2P lists", () => {
    for (const instance of agenticAll) {
      const upstream = instance.id.replace("swebench-lite-", "");
      expect(instance.initial_state.image.tags["x86_64"]).toBe(
        `swebench/sweb.eval.x86_64.${upstream}`,
      );
      expect(instance.initial_state.image.tags["arm64"]).toBe(
        `swebench/sweb.eval.arm64.${upstream}`,
      );
      expect(instance.initial_state.base_commit).toMatch(/^[0-9a-f]{40}$/);
      expect(instance.expected_outcome.test_patch).toContain("diff --git");
      expect(instance.expected_outcome.fail_to_pass.length).toBeGreaterThan(0);
    }
  });

  test("upstream PASS_TO_PASS may be empty, but rarely", () => {
    const empty = agenticAll.filter(
      (instance) => instance.expected_outcome.pass_to_pass.length === 0,
    );
    expect(empty.length).toBeLessThanOrEqual(10);
  });

  test("the first-report subset is drawn from the full set", () => {
    const allIds = new Set(agenticAll.map((instance) => instance.id));
    for (const instance of agenticFirstReport) expect(allIds.has(instance.id)).toBe(true);
    // A systematic sample: even spacing across the id-sorted 300, so repos stay covered.
    expect(
      new Set(agenticFirstReport.map((instance) => instance.initial_state.repo)).size,
    ).toBeGreaterThan(5);
  });

  test("digest status matches the digests the instances carry", () => {
    const pins = loadPins(ROOT);
    const pinned = agenticAll.filter(
      (instance) => instance.initial_state.image.digest_status === "pinned",
    ).length;
    if (pins.agentic_images.digest_status === "pinned") {
      expect(pinned).toBe(agenticAll.length);
      for (const instance of agenticAll) {
        expect(instance.initial_state.image.digests["x86_64"]).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    } else {
      expect(pinned).toBe(0);
      expect(pins.agentic_images.note).toContain("--pin-digests");
    }
  });
});

describe("envelope validation", () => {
  const base = JSON.parse(
    JSON.stringify(loadInstanceFile(`${ROOT}/code_generation/mbpp-test/instances.jsonl`)[0]),
  ) as Record<string, unknown>;

  test("a valid instance passes", () => {
    expect(validateInstance(base)).toEqual([]);
  });

  test("difficulty is null or a calibrated record", () => {
    const calibrated = {
      ...base,
      difficulty: {
        tier: "medium",
        baseline_pass_rate: 0.5,
        calibrated_at: "2026-12-01T00:00:00Z",
      },
    };
    expect(validateInstance(calibrated)).toEqual([]);
    const bad = {
      ...base,
      difficulty: { tier: "brutal", baseline_pass_rate: 2, calibrated_at: "" },
    };
    expect(validateInstance(bad).length).toBeGreaterThan(0);
  });

  test("verifier params that drift from ADR-0005 are rejected", () => {
    const drifted = {
      ...base,
      verifier: {
        name: "mbpp_unit_tests",
        params: { ...(base["verifier"] as { params: object }).params, per_test_timeout_s: 5 },
      },
    };
    expect(validateInstance(drifted)).toContain(
      "verifier.params: must match the pinned params for mbpp_unit_tests (ADR-0005)",
    );
  });

  test("a codegen instance with the wrong hidden-test count is rejected", () => {
    const wrong = {
      ...base,
      expected_outcome: {
        ...(base["expected_outcome"] as object),
        tests: [(base["expected_outcome"] as { tests: string[] }).tests[0]],
      },
    };
    expect(validateInstance(wrong).join("\n")).toContain("exactly 3 hidden tests");
  });

  test("undisclosed contamination is rejected", () => {
    const undisclosed = { ...base, contamination: { disclosed: false, notes: "nope" } };
    expect(validateInstance(undisclosed)).toContain("contamination.disclosed: must be true");
  });

  test("a task type may only use its own verifier", () => {
    const wrongVerifier = {
      ...base,
      verifier: { name: "drop_em_f1", params: VERIFIER_PARAMS.drop_em_f1 },
    };
    expect(validateInstance(wrongVerifier)).toContain(
      "verifier.name: code_generation must use mbpp_unit_tests",
    );
  });

  test("the schema file parses and names all four task types", () => {
    const schema = JSON.parse(readFileSync(`${ROOT}/schema/task-instance.schema.json`, "utf8")) as {
      properties: { task_type: { enum: string[] } };
    };
    expect(schema.properties.task_type.enum).toEqual([...TASK_TYPES]);
  });

  test("instance files keep the datasets/<type>/<seed>/instances.jsonl layout", () => {
    for (const file of instanceFiles(ROOT)) {
      const report = validateInstanceFile(file, ROOT);
      expect(report.path.split("/")).toHaveLength(3);
      expect(report.taskType).not.toBeNull();
    }
  });
});
