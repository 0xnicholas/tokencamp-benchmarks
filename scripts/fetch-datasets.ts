import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";
import { parquetReadObjects } from "hyparquet";
import { extractText, getDocumentProxy } from "unpdf";

import {
  TASK_TYPE_VERIFIER,
  VERIFIER_PARAMS,
  sha256Hex,
  type AgenticInstance,
  type CodegenInstance,
  type CorpusQaExpectedOutcome,
  type CorpusQaInstance,
  type DatasetPin,
  type DatasetPins,
  type ExtractionInstance,
  type SeedRef,
  type TaskInstance,
} from "../src/core/datasets";
import { SYNTHETIC_PER_TEMPLATE, generateSyntheticInstances } from "./seeds/synthetic-extraction";

/**
 * Re-freeze the v1 Task Dataset (ADR-0003, amended by ADR-0007).
 *
 *   bun run datasets:fetch                # fetch seeds (cached), derive, write JSONL + pins.json
 *   bun run datasets:fetch --refresh      # re-download every seed artifact
 *   bun run datasets:fetch --pin-digests  # also resolve SWE-bench image digests from a registry
 *
 * Nothing here is part of the harness: this script is the reproducible path from
 * the upstream Seed Datasets to the frozen files CI validates. Derived output is
 * deterministic — a second run against the same seeds produces identical bytes,
 * which is what `pins.json`'s sha256s assert.
 */

const CACHE_DIR = ".cache/datasets";
const DATASETS_DIR = "datasets";
const GENERATED_AT = new Date().toISOString();

const args = new Set(process.argv.slice(2));
const REFRESH = args.has("--refresh");
const PIN_DIGESTS = args.has("--pin-digests");
const REGISTRY = process.env["SWEBENCH_REGISTRY"] ?? "https://registry-1.docker.io";
const TOKEN = process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"] ?? null;

// ---------------------------------------------------------------- transport

async function request(url: string, init: RequestInit = {}, attempts = 4): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(180_000),
        headers: { "user-agent": "tokencamp-benchmarks-dataset-freeze", ...init.headers },
      });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) {
        throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
      }
      lastError = new Error(`${url}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
  }
  throw new Error(`fetch failed: ${(lastError as Error | null)?.message ?? "unknown"}`);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await request(url);
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  const response = await request(url);
  return await response.text();
}

function cachePath(name: string): string {
  return join(CACHE_DIR, name);
}

async function cachedBytes(name: string, url: string): Promise<Uint8Array> {
  const path = cachePath(name);
  if (!REFRESH && existsSync(path)) return new Uint8Array(readFileSync(path));
  const bytes = await fetchBytes(url);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return bytes;
}

/** Stream a large artifact to the cache with a progress-free resume. */
async function cachedLargeFile(name: string, url: string): Promise<Uint8Array> {
  const path = cachePath(name);
  if (!REFRESH && existsSync(path)) {
    const bytes = new Uint8Array(readFileSync(path));
    if (bytes.byteLength > 0) return bytes;
  }
  mkdirSync(dirname(path), { recursive: true });
  const response = await request(url);
  const stream = createWriteStream(path);
  const reader = response.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    stream.write(Buffer.from(value));
  }
  await new Promise((resolve) => stream.end(resolve));
  return new Uint8Array(readFileSync(path));
}

// ---------------------------------------------------------------- seeds

interface MbppProblem {
  readonly task_id: number;
  readonly text: string;
  readonly code: string;
  readonly test_setup_code: string;
  readonly test_list: readonly string[];
}

const MBPP_REPO = "google-research/google-research";
const MBPP_PATH = "mbpp/mbpp.jsonl";

async function fetchMbpp(): Promise<{ problems: MbppProblem[]; revision: string }> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (TOKEN) headers["authorization"] = `Bearer ${TOKEN}`;

  const contentsUrl = `https://api.github.com/repos/${MBPP_REPO}/contents/${MBPP_PATH}`;
  const contents = (await (await request(contentsUrl, { headers })).json()) as {
    content: string;
    sha: string;
  };
  const text = Buffer.from(contents.content, "base64").toString("utf8");
  writeFileSync(join(CACHE_DIR, "mbpp.jsonl"), text);

  const commitsUrl = `https://api.github.com/repos/${MBPP_REPO}/commits?path=${MBPP_PATH}&per_page=1`;
  const commits = (await (await request(commitsUrl, { headers })).json()) as { sha: string }[];
  const revision = commits[0]?.sha ?? contents.sha;

  const problems = text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as MbppProblem);
  return { problems, revision };
}

interface DropQa {
  readonly passage: string;
  readonly question: string;
  readonly query_id: string;
  readonly answer: {
    readonly spans: readonly string[];
    readonly number: string;
    readonly date: { readonly day: string; readonly month: string; readonly year: string };
  };
  readonly validated_answers?: readonly DropQa["answer"][];
}

async function fetchDrop(): Promise<DropQa[]> {
  const bytes = await cachedLargeFile(
    "drop_dataset.zip",
    "https://s3-us-west-2.amazonaws.com/allennlp/datasets/drop/drop_dataset.zip",
  );
  const files = unzipSync(bytes);
  const devFile = files["drop_dataset/drop_dataset_dev.json"];
  if (!devFile) throw new Error("drop_dataset.zip: drop_dataset_dev.json missing");
  const sections = JSON.parse(Buffer.from(devFile).toString("utf8")) as Record<
    string,
    { passage: string; qa_pairs: Omit<DropQa, "passage">[] }
  >;
  const qas: DropQa[] = [];
  for (const section of Object.values(sections)) {
    for (const qa of section.qa_pairs) qas.push({ ...qa, passage: section.passage });
  }
  return qas;
}

const EXTRACTBENCH_REPO = "llamaindex/ExtractBench";
const EXTRACTBENCH_MIRROR = process.env["HF_ENDPOINT"] ?? "https://hf-mirror.com";

interface ExtractBenchRow {
  readonly id: string;
  readonly category: string;
  readonly pdf: string;
  readonly data_schema: string;
  readonly expected_output: string;
  readonly field_rules: string;
  readonly repeated_structure: string;
  readonly tags: readonly string[];
}

async function fetchExtractBenchRows(): Promise<{ rows: ExtractBenchRow[]; revision: string }> {
  const apiUrl = `${EXTRACTBENCH_MIRROR}/api/datasets/${EXTRACTBENCH_REPO}`;
  const meta = (await (await request(apiUrl)).json()) as { sha: string };
  const rows: ExtractBenchRow[] = [];
  // The slice is drawn from the short split only (≤10 pages, cheapest PDF text extraction).
  for (const split of ["short", "medium", "long"]) {
    const text = await fetchText(
      `${EXTRACTBENCH_MIRROR}/datasets/${EXTRACTBENCH_REPO}/resolve/main/${split}.jsonl`,
    );
    for (const line of text.split("\n")) {
      if (line.trim().length > 0) rows.push(JSON.parse(line) as ExtractBenchRow);
    }
  }
  return { rows, revision: meta.sha };
}

const SWE_DATASET = "princeton-nlp/SWE-bench_Lite";
const SWE_PARQUET = "data/test-00000-of-00001.parquet";

interface SweBenchRow {
  readonly instance_id: string;
  readonly repo: string;
  readonly base_commit: string;
  readonly problem_statement: string;
  readonly test_patch: string;
  readonly FAIL_TO_PASS: string;
  readonly PASS_TO_PASS: string;
  readonly version: string;
  readonly created_at: string;
  readonly environment_setup_commit: string;
}

async function fetchSweBench(): Promise<{ rows: SweBenchRow[]; revision: string }> {
  const meta = (await (
    await request(`${EXTRACTBENCH_MIRROR}/api/datasets/${SWE_DATASET}`)
  ).json()) as {
    sha: string;
  };
  const bytes = await cachedBytes(
    "swe-bench-lite.parquet",
    `${EXTRACTBENCH_MIRROR}/datasets/${SWE_DATASET}/resolve/main/${SWE_PARQUET}`,
  );
  const rows = (await parquetReadObjects({
    file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  })) as unknown as SweBenchRow[];
  return { rows, revision: meta.sha };
}

// ---------------------------------------------------------------- derivation helpers

const CONTAMINATION = {
  mbpp: "Pre-2021 public dataset, heavily represented in model training data. Disclosed, not mitigated: reproducibility over novelty (ADR-0003).",
  drop: "Pre-2019 public dataset, heavily represented in model training data. Disclosed, not mitigated: reproducibility over novelty (ADR-0003).",
  extractbench:
    "Published enterprise-document extraction benchmark; documents are public records, so contamination cannot be ruled out. Disclosed, not mitigated (ADR-0003).",
  synthetic:
    "Generated in-house at freeze time from no model output — no upstream training exposure. The generator ships in-repo, so later models trained on this repository could see it. Disclosed, not mitigated (ADR-0003).",
  swebench:
    "Public GitHub issues and test patches (2023), heavily represented in model training data. Disclosed, not mitigated: reproducibility over novelty (ADR-0003).",
} as const;

function corpusQaAnswerSurfaces(answer: DropQa["answer"]): string[] {
  const surfaces: string[] = [];
  for (const span of answer.spans) if (span.trim().length > 0) surfaces.push(span.trim());
  if (answer.number && answer.number.trim().length > 0) surfaces.push(answer.number.trim());
  const date = answer.date;
  const dateParts = [date.day, date.month, date.year]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean);
  if (dateParts.length > 0) surfaces.push(dateParts.join(" "));
  return surfaces;
}

function corpusQaAnswerTypes(answer: DropQa["answer"]): CorpusQaExpectedOutcome["answer_types"] {
  const types: ("span" | "number" | "date")[] = [];
  if (
    answer.date &&
    (answer.date.year?.trim() || answer.date.month?.trim() || answer.date.day?.trim())
  ) {
    types.push("date");
  }
  if (answer.number && answer.number.trim().length > 0) types.push("number");
  if (answer.spans.some((span) => span.trim().length > 0)) types.push("span");
  return types;
}

/** Stratum assignment for the DROP sample: the rarest label wins, so dates and numbers are visible. */
function corpusQaStratum(types: readonly string[]): "span" | "number" | "date" {
  if (types.includes("date")) return "date";
  if (types.includes("number")) return "number";
  return "span";
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Largest-remainder allocation, so the strata sum exactly to `total`. */
function allocate(populations: ReadonlyMap<string, number>, total: number): Map<string, number> {
  const keys = [...populations.keys()].sort();
  const populationTotal = [...populations.values()].reduce((sum, n) => sum + n, 0);
  const exact = keys.map((key) => (total * (populations.get(key) ?? 0)) / populationTotal);
  const floors = exact.map((value) => Math.floor(value));
  let remaining = total - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (remaining <= 0) break;
    floors[index] = floors[index]! + 1;
    remaining -= 1;
  }
  return new Map(keys.map((key, index) => [key, floors[index]!]));
}

/** Punctuation/whitespace-free form used only for the answerability check. */
const squash = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Keep the document's line structure (it is the task input) while normalizing whitespace. */
const cleanDocument = (value: string): string =>
  value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const STRING_COMPARATORS = new Set([
  "exact",
  "case_insensitive",
  "enum",
  "name",
  "address",
  "phone",
]);

interface FieldRule {
  readonly comparator?: string;
}

/** Flatten `expected_output` into dotted leaf paths, dropping arrays (record lists are out of the exact slice). */
function flattenScalars(
  value: unknown,
  prefix = "",
  into = new Map<string, unknown>(),
): Map<string, unknown> {
  if (Array.isArray(value)) return into;
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenScalars(child, prefix ? `${prefix}.${key}` : key, into);
    }
    return into;
  }
  if (prefix) into.set(prefix, value);
  return into;
}

/** Rule lookup tolerates rules keyed at a parent path (arrays/counters) by matching the longest prefix. */
function ruleFor(rules: Record<string, FieldRule>, path: string): FieldRule | undefined {
  if (rules[path]) return rules[path];
  const segments = path.split(".");
  for (let i = segments.length - 1; i > 0; i--) {
    const prefix = segments.slice(0, i).join(".");
    if (rules[prefix]) return rules[prefix];
  }
  return undefined;
}

interface ExtractBenchSelection {
  readonly row: ExtractBenchRow;
  readonly document: string;
  readonly fields: Record<string, string>;
}

async function extractBenchText(row: ExtractBenchRow): Promise<string> {
  const slug = row.id.replace(/[^A-Za-z0-9._-]+/g, "_");
  const textPath = cachePath(`extractbench-text/${slug}.txt`);
  if (!REFRESH && existsSync(textPath)) return readFileSync(textPath, "utf8");
  const pdfUrl = `${EXTRACTBENCH_MIRROR}/datasets/${EXTRACTBENCH_REPO}/resolve/main/${encodeURI(row.pdf)}`;
  const bytes = await cachedBytes(`extractbench/${slug}.pdf`, pdfUrl);
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const document = cleanDocument((Array.isArray(text) ? text : [text]).join("\n\n"));
  mkdirSync(dirname(textPath), { recursive: true });
  writeFileSync(textPath, document);
  return document;
}

const MIN_EXACT_FIELDS = 3;

/**
 * The ExtractBench slice (ADR-0003: "exact-match fields only on the ExtractBench
 * slice"). A document qualifies when PDF text extraction preserves at least
 * MIN_EXACT_FIELDS golden values that are plain strings compared with a string
 * comparator (record lists are out of the slice); only those answerable fields
 * are kept, so every instance can be solved from its vendored text.
 *
 * Candidates are scanned short → medium → long, each in id order: deterministic,
 * and it keeps the slice biased toward the cheapest documents (the long split is
 * 20 documents over 1,816 pages, reached only if the cheaper splits fall short).
 */
async function selectExtractBench(
  rows: readonly ExtractBenchRow[],
  target: number,
): Promise<ExtractBenchSelection[]> {
  const selections: ExtractBenchSelection[] = [];
  const splitOrder = new Map([
    ["short", 0],
    ["medium", 1],
    ["long", 2],
  ]);
  const candidates = [...rows]
    .filter((row) => splitOrder.has(row.category))
    .sort(
      (a, b) =>
        (splitOrder.get(a.category) ?? 0) - (splitOrder.get(b.category) ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

  for (const row of candidates) {
    if (selections.length >= target) break;
    const rules = JSON.parse(row.field_rules) as Record<string, FieldRule>;
    const leaves = flattenScalars(JSON.parse(row.expected_output));
    const candidatesFields: Record<string, string> = {};
    for (const [path, value] of leaves) {
      if (typeof value !== "string") continue;
      const rule = ruleFor(rules, path);
      if (!rule?.comparator || !STRING_COMPARATORS.has(rule.comparator)) continue;
      const trimmed = value.trim();
      if (trimmed.length === 0) continue;
      candidatesFields[path] = trimmed;
    }
    if (Object.keys(candidatesFields).length < MIN_EXACT_FIELDS) continue;

    const document = await extractBenchText(row);
    if (document.length < 500) continue;
    const haystack = squash(document);
    const fields: Record<string, string> = {};
    for (const [path, value] of Object.entries(candidatesFields)) {
      if (haystack.includes(squash(value))) fields[path] = value;
    }
    if (Object.keys(fields).length < MIN_EXACT_FIELDS) continue;
    selections.push({ row, document, fields });
  }
  return selections;
}

async function pinImageDigests(
  instanceIds: readonly string[],
): Promise<Map<string, { x86_64: string | null; arm64: string | null }>> {
  const digests = new Map<string, { x86_64: string | null; arm64: string | null }>();
  const registryHost = new URL(REGISTRY).host;
  for (const instanceId of instanceIds) {
    const result = { x86_64: null as string | null, arm64: null as string | null };
    for (const arch of ["x86_64", "arm64"] as const) {
      const repository = `swebench/sweb.eval.${arch}.${instanceId.toLowerCase()}`;
      try {
        const unauth = await fetch(`${REGISTRY}/v2/${repository}/manifests/latest`, {
          signal: AbortSignal.timeout(30_000),
          headers: {
            accept:
              "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json",
          },
        });
        let authorization: string | null = null;
        const challenge = unauth.headers.get("www-authenticate");
        if (unauth.status === 401 && challenge) {
          const realm = /realm="([^"]+)"/.exec(challenge)?.[1];
          const service = /service="([^"]+)"/.exec(challenge)?.[1];
          if (realm) {
            const tokenUrl = `${realm}?service=${service ?? registryHost}&scope=repository:${repository}:pull`;
            const token = (await (
              await fetch(tokenUrl, { signal: AbortSignal.timeout(30_000) })
            ).json()) as {
              token?: string;
              access_token?: string;
            };
            authorization = `Bearer ${token.token ?? token.access_token ?? ""}`;
          }
        }
        const response = await fetch(`${REGISTRY}/v2/${repository}/manifests/latest`, {
          signal: AbortSignal.timeout(30_000),
          headers: {
            accept:
              "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json",
            ...(authorization ? { authorization } : {}),
          },
        });
        const digest = response.headers.get("docker-content-digest");
        if (response.ok && digest?.startsWith("sha256:")) result[arch] = digest;
      } catch {
        // Registry unreachable for this arch: the instance keeps a null digest.
      }
    }
    digests.set(instanceId, result);
  }
  return digests;
}

// ---------------------------------------------------------------- builders

function seedRef(name: string, version: string, license: string, sourceUrl: string): SeedRef {
  return { name, version, license, source_url: sourceUrl };
}

function verifierFor(taskType: keyof typeof TASK_TYPE_VERIFIER) {
  const name = TASK_TYPE_VERIFIER[taskType];
  return { name, params: VERIFIER_PARAMS[name] };
}

function toLines(instances: readonly TaskInstance[]): string {
  return `${instances.map((instance) => JSON.stringify(instance)).join("\n")}\n`;
}

const MBPP_SIGNATURE = /^[ \t]*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/m;

function mbppEntryPoint(code: string): { entryPoint: string; signature: string } {
  const match = MBPP_SIGNATURE.exec(code);
  if (!match)
    throw new Error(
      `MBPP: cannot derive a function signature from ${JSON.stringify(code.slice(0, 60))}`,
    );
  const params = (match[2] ?? "").replace(/\s+/g, " ").trim();
  return { entryPoint: match[1]!, signature: `def ${match[1]}(${params})` };
}

function buildMbpp(problems: readonly MbppProblem[], revision: string): CodegenInstance[] {
  const seed = seedRef(
    "mbpp",
    `${MBPP_REPO}@${revision} (${MBPP_PATH})`,
    "Apache-2.0",
    `https://github.com/${MBPP_REPO}/blob/${revision}/${MBPP_PATH}`,
  );
  const testSplit = problems
    .filter((problem) => problem.task_id >= 11 && problem.task_id <= 510)
    .sort((a, b) => a.task_id - b.task_id);

  return testSplit.map((problem) => {
    const { entryPoint, signature } = mbppEntryPoint(problem.code);
    return {
      id: `mbpp-test-${problem.task_id}`,
      task_type: "code_generation" as const,
      seed,
      initial_state: {
        prompt: problem.text.trim(),
        entry_point: entryPoint,
        function_signature: signature,
        test_setup_code: problem.test_setup_code ?? "",
      },
      expected_outcome: { tests: [...problem.test_list], entry_point: entryPoint },
      verifier: verifierFor("code_generation"),
      difficulty: null,
      contamination: { disclosed: true, notes: CONTAMINATION.mbpp },
    };
  });
}

function buildDrop(qas: readonly DropQa[], target = 300): CorpusQaInstance[] {
  const seed = seedRef(
    "drop",
    "drop_dataset_dev.json (allennlp S3 release, fetched 2026-11-26)",
    "CC BY-SA 4.0",
    "https://s3-us-west-2.amazonaws.com/allennlp/datasets/drop/drop_dataset.zip",
  );

  const byStratum = new Map<string, DropQa[]>();
  for (const qa of qas) {
    const stratum = corpusQaStratum(corpusQaAnswerTypes(qa.answer));
    const bucket = byStratum.get(stratum) ?? [];
    bucket.push(qa);
    byStratum.set(stratum, bucket);
  }

  const populations = new Map([...byStratum].map(([stratum, bucket]) => [stratum, bucket.length]));
  const allocation = allocate(populations, target);
  const rand = mulberry32(20261126);
  const selected: DropQa[] = [];
  for (const stratum of [...allocation.keys()].sort()) {
    const bucket = [...(byStratum.get(stratum) ?? [])].sort((a, b) =>
      a.query_id < b.query_id ? -1 : a.query_id > b.query_id ? 1 : 0,
    );
    const wanted = allocation.get(stratum) ?? 0;
    const pool = [...bucket];
    for (let i = 0; i < wanted && pool.length > 0; i++) {
      const index = Math.floor(rand() * pool.length);
      selected.push(pool[index]!);
      pool.splice(index, 1);
    }
  }

  return selected
    .sort((a, b) => (a.query_id < b.query_id ? -1 : a.query_id > b.query_id ? 1 : 0))
    .map((qa) => {
      const answerTypes = corpusQaAnswerTypes(qa.answer);
      const validated = (qa.validated_answers ?? [])
        .map((answer) => corpusQaAnswerSurfaces(answer))
        .filter((surfaces) => surfaces.length > 0);
      return {
        id: `drop-dev-${qa.query_id}`,
        task_type: "corpus_qa" as const,
        seed,
        initial_state: { passage: qa.passage, question: qa.question },
        expected_outcome: {
          answers: corpusQaAnswerSurfaces(qa.answer),
          validated_answers: validated,
          answer_types: answerTypes,
        },
        verifier: verifierFor("corpus_qa"),
        difficulty: null,
        contamination: { disclosed: true, notes: CONTAMINATION.drop },
      };
    });
}

function buildExtractBench(
  selections: readonly ExtractBenchSelection[],
  revision: string,
): ExtractionInstance[] {
  const seed = seedRef(
    "extractbench",
    `llamaindex/ExtractBench@${revision} (short / medium / long splits)`,
    "Apache-2.0",
    `https://huggingface.co/datasets/llamaindex/ExtractBench/tree/${revision}`,
  );
  return selections.map((selection) => {
    const stem = selection.row.id.replace(/[^A-Za-z0-9._-]+/g, "-");
    return {
      id: `extractbench-${stem}`,
      task_type: "structured_extraction" as const,
      seed,
      initial_state: { document: selection.document, keys: Object.keys(selection.fields) },
      expected_outcome: { fields: selection.fields },
      verifier: verifierFor("structured_extraction"),
      difficulty: null,
      contamination: { disclosed: true, notes: CONTAMINATION.extractbench },
    };
  });
}

function buildSynthetic(): ExtractionInstance[] {
  const seed = seedRef(
    "synthetic-extraction-generator",
    `v1 (scripts/seeds/synthetic-extraction.ts, seed 20261126)`,
    "MIT (in-house, this repository)",
    "https://github.com/0xnicholas/tokencamp-benchmarks/blob/main/scripts/seeds/synthetic-extraction.ts",
  );
  return generateSyntheticInstances().map((instance) => ({
    id: instance.id,
    task_type: "structured_extraction" as const,
    seed,
    initial_state: instance.initial_state,
    expected_outcome: instance.expected_outcome,
    verifier: verifierFor("structured_extraction"),
    difficulty: null,
    contamination: { disclosed: true, notes: CONTAMINATION.synthetic },
  }));
}

function imageRef(
  instanceId: string,
  digests: Map<string, { x86_64: string | null; arm64: string | null }> | null,
): AgenticInstance["initial_state"]["image"] {
  const base = instanceId.toLowerCase();
  const pinned = digests?.get(instanceId);
  return {
    tags: {
      x86_64: `swebench/sweb.eval.x86_64.${base}`,
      arm64: `swebench/sweb.eval.arm64.${base}`,
    },
    digests: { x86_64: pinned?.x86_64 ?? null, arm64: pinned?.arm64 ?? null },
    digest_status: pinned?.x86_64 || pinned?.arm64 ? "pinned" : "unpinned",
  };
}

function buildSweBench(
  rows: readonly SweBenchRow[],
  revision: string,
  digests: Map<string, { x86_64: string | null; arm64: string | null }> | null,
): { all: AgenticInstance[]; firstReport: AgenticInstance[] } {
  const seed = seedRef(
    "swebench-lite",
    `princeton-nlp/SWE-bench_Lite@${revision} (test split)`,
    "MIT",
    `https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite/tree/${revision}`,
  );
  const build = (row: SweBenchRow): AgenticInstance => ({
    id: `swebench-lite-${row.instance_id.toLowerCase()}`,
    task_type: "agentic_repo_task" as const,
    seed,
    initial_state: {
      image: imageRef(row.instance_id, digests),
      repo: row.repo,
      base_commit: row.base_commit,
      problem_statement: row.problem_statement,
    },
    expected_outcome: {
      test_patch: row.test_patch,
      fail_to_pass: JSON.parse(row.FAIL_TO_PASS) as string[],
      pass_to_pass: JSON.parse(row.PASS_TO_PASS) as string[],
    },
    verifier: verifierFor("agentic_repo_task"),
    difficulty: null,
    contamination: { disclosed: true, notes: CONTAMINATION.swebench },
  });

  const all = [...rows]
    .sort((a, b) => (a.instance_id < b.instance_id ? -1 : a.instance_id > b.instance_id ? 1 : 0))
    .map(build);

  // The first report runs a fixed 50-instance subset: a systematic sample
  // (every 6th instance in id order) so all 11 Lite repos stay represented.
  const stride = Math.ceil(all.length / 50);
  const firstReport = all.filter((_, index) => index % stride === 0).slice(0, 50);
  return { all, firstReport };
}

// ---------------------------------------------------------------- writer

function writeDataset(
  relativePath: string,
  instances: readonly TaskInstance[],
): DatasetPin["sha256"] {
  const path = join(DATASETS_DIR, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  const text = toLines(instances);
  writeFileSync(path, text);
  return sha256Hex(text);
}

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });

  console.log("→ MBPP (google-research/google-research, mbpp/mbpp.jsonl)");
  const mbpp = await fetchMbpp();
  const mbppInstances = buildMbpp(mbpp.problems, mbpp.revision);
  console.log(`  ${mbppInstances.length} test-split instances @ ${mbpp.revision.slice(0, 12)}`);

  console.log("→ DROP (allennlp drop_dataset_dev.json)");
  const dropQas = await fetchDrop();
  const dropInstances = buildDrop(dropQas);
  console.log(`  ${dropInstances.length} stratified instances from ${dropQas.length} dev QA pairs`);

  console.log("→ ExtractBench (llamaindex/ExtractBench, short → medium → long)");
  const extractBench = await fetchExtractBenchRows();
  const selections = await selectExtractBench(extractBench.rows, 100);
  const extractBenchInstances = buildExtractBench(selections, extractBench.revision);
  console.log(
    `  ${extractBenchInstances.length} exact-match instances @ ${extractBench.revision.slice(0, 12)}`,
  );

  console.log("→ Synthetic extraction generator (in-house)");
  const syntheticInstances = buildSynthetic();
  console.log(
    `  ${syntheticInstances.length} generated instances (${SYNTHETIC_PER_TEMPLATE} per template)`,
  );

  console.log("→ SWE-bench Lite (princeton-nlp/SWE-bench_Lite)");
  const sweBench = await fetchSweBench();
  let digests: Map<string, { x86_64: string | null; arm64: string | null }> | null = null;
  if (PIN_DIGESTS) {
    console.log(`  pinning image digests against ${REGISTRY}`);
    digests = await pinImageDigests(sweBench.rows.map((row) => row.instance_id));
    const pinned = [...digests.values()].filter((entry) => entry.x86_64 || entry.arm64).length;
    console.log(`  digests pinned for ${pinned}/${sweBench.rows.length} instances`);
  }
  const { all: agenticAll, firstReport } = buildSweBench(sweBench.rows, sweBench.revision, digests);
  console.log(
    `  ${agenticAll.length} adopted instances, ${firstReport.length} in the first-report subset`,
  );

  const pins: DatasetPin[] = [
    {
      task_type: "code_generation",
      seed: "mbpp-test",
      path: "datasets/code_generation/mbpp-test/instances.jsonl",
      instances: mbppInstances.length,
      sha256: writeDataset("code_generation/mbpp-test/instances.jsonl", mbppInstances),
      license: "Apache-2.0",
      attribution:
        "MBPP (Mostly Basic Python Problems), Google Research — https://github.com/google-research/google-research/tree/master/mbpp",
      derivation:
        "mbpp.jsonl task IDs 11–510 (the paper's test split, 500 problems). initial_state = prompt + signature derived from the reference solution's def line + test_setup_code; expected_outcome.tests = test_list (3 hidden tests every problem carries); the reference solution itself is never vendored.",
      source: {
        url: `https://github.com/${MBPP_REPO}/blob/${mbpp.revision}/${MBPP_PATH}`,
        revision: mbpp.revision,
        license: "Apache-2.0",
        sha256: sha256Hex(readFileSync(join(CACHE_DIR, "mbpp.jsonl"), "utf8")),
      },
    },
    {
      task_type: "corpus_qa",
      seed: "drop-dev-stratified",
      path: "datasets/corpus_qa/drop-dev-stratified/instances.jsonl",
      instances: dropInstances.length,
      sha256: writeDataset("corpus_qa/drop-dev-stratified/instances.jsonl", dropInstances),
      license: "CC BY-SA 4.0",
      attribution:
        "DROP (Discrete Reasoning Over Paragraphs), Allen Institute for AI — https://allennlp.org/drop. Vendored slice distributed under CC BY-SA 4.0; it carries the upstream share-alike terms.",
      derivation:
        "drop_dataset_dev.json, stratified by answer type (date > number > span, since DROP answers are multi-type) with proportional largest-remainder allocation and a fixed sample seed (20261126). expected_outcome carries gold surfaces plus validated_answers (ADR-0005 takes the max over both).",
      source: {
        url: "https://s3-us-west-2.amazonaws.com/allennlp/datasets/drop/drop_dataset.zip",
        revision: "drop-dataset.zip etag 1f73566ba43a4ec6722967d418c3478c (fetched 2026-11-26)",
        license: "CC BY-SA 4.0",
        sha256: null,
      },
    },
    {
      task_type: "structured_extraction",
      seed: "extractbench-short-exact",
      path: "datasets/structured_extraction/extractbench-short-exact/instances.jsonl",
      instances: extractBenchInstances.length,
      sha256: writeDataset(
        "structured_extraction/extractbench-short-exact/instances.jsonl",
        extractBenchInstances,
      ),
      license: "Apache-2.0",
      attribution:
        "ExtractBench, LlamaIndex — https://huggingface.co/datasets/llamaindex/ExtractBench (Apache-2.0); source documents are public records.",
      derivation:
        "short, then medium, then long split documents in id order, mined for exact-match fields: leaves of expected_output whose field_rule comparator is a string comparison (exact / case_insensitive / enum / name / address / phone), record lists excluded. A document is adopted when at least 3 such golden values survive PDF text extraction (punctuation/whitespace-insensitive check); only those answerable fields are kept as keys. document = normalized PDF text (unpdf).",
      source: {
        url: `https://huggingface.co/datasets/llamaindex/ExtractBench/tree/${extractBench.revision}`,
        revision: extractBench.revision,
        license: "Apache-2.0",
        sha256: null,
      },
    },
    {
      task_type: "structured_extraction",
      seed: "synthetic-v1",
      path: "datasets/structured_extraction/synthetic-v1/instances.jsonl",
      instances: syntheticInstances.length,
      sha256: writeDataset(
        "structured_extraction/synthetic-v1/instances.jsonl",
        syntheticInstances,
      ),
      license: "MIT",
      attribution: "Generated in-house by scripts/seeds/synthetic-extraction.ts (this repository).",
      derivation:
        "Five document templates (invoice, purchase order, lab report, lease summary, support ticket) × 30 seeded variants. Golden values are rendered verbatim into each document; the generator is deterministic (mulberry32, seed 20261126).",
      source: {
        url: "https://github.com/0xnicholas/tokencamp-benchmarks/blob/main/scripts/seeds/synthetic-extraction.ts",
        revision: "scripts/seeds/synthetic-extraction.ts @ repo HEAD of the freeze commit",
        license: "MIT",
        sha256: sha256Hex(readFileSync("scripts/seeds/synthetic-extraction.ts", "utf8")),
      },
    },
    {
      task_type: "agentic_repo_task",
      seed: "swebench-lite",
      path: "datasets/agentic_repo_task/swebench-lite/instances.jsonl",
      instances: agenticAll.length,
      sha256: writeDataset("agentic_repo_task/swebench-lite/instances.jsonl", agenticAll),
      license: "MIT",
      attribution:
        "SWE-bench Lite, Princeton NLP / SWE-bench team — https://www.swebench.com/lite (MIT).",
      derivation:
        "All 300 Lite instances in id order. initial_state = official per-instance eval image tags (x86_64 + arm64) + repo + base_commit + problem_statement; expected_outcome = test_patch + FAIL_TO_PASS/PASS_TO_PASS. Repo snapshots are not vendored: the image is the snapshot (ADR-0007). The gold `patch` is deliberately not vendored.",
      source: {
        url: `https://huggingface.co/datasets/${SWE_DATASET}/tree/${sweBench.revision}`,
        revision: sweBench.revision,
        license: "MIT",
        sha256: sha256Hex(readFileSync(join(CACHE_DIR, "swe-bench-lite.parquet"))),
      },
    },
    {
      task_type: "agentic_repo_task",
      seed: "swebench-lite-first-report",
      path: "datasets/agentic_repo_task/swebench-lite-first-report/instances.jsonl",
      instances: firstReport.length,
      sha256: writeDataset(
        "agentic_repo_task/swebench-lite-first-report/instances.jsonl",
        firstReport,
      ),
      license: "MIT",
      attribution:
        "SWE-bench Lite subset — same attribution and licenses as the full vendored set.",
      derivation:
        "The 50-instance first-report subset: every 6th instance of the 300 in id order (systematic sample), so all 11 Lite repos stay represented. Instance envelope otherwise identical to the full set.",
      source: {
        url: `https://huggingface.co/datasets/${SWE_DATASET}/tree/${sweBench.revision}`,
        revision: sweBench.revision,
        license: "MIT",
        sha256: null,
      },
    },
  ];

  const pinnedInstances = agenticAll.filter(
    (instance) => instance.initial_state.image.digest_status === "pinned",
  );
  const pinsFile: DatasetPins = {
    format_version: 1,
    generated_at: GENERATED_AT,
    fetch_script: "scripts/fetch-datasets.ts",
    verifier_params: VERIFIER_PARAMS,
    datasets: pins,
    agentic_images: {
      digest_status: pinnedInstances.length === agenticAll.length ? "pinned" : "unpinned",
      note:
        pinnedInstances.length === agenticAll.length
          ? "Every agentic instance carries a manifest digest for both architectures (ADR-0007)."
          : `Image tags are pinned but digests are not: ${pinnedInstances.length}/${agenticAll.length} instances resolved a digest. Re-run \`bun run datasets:fetch --pin-digests\` with a reachable registry (\`SWEBENCH_REGISTRY\`) to fill them.`,
    },
  };
  writeFileSync(join(DATASETS_DIR, "pins.json"), `${JSON.stringify(pinsFile, null, 2)}\n`);

  console.log(`\n✓ wrote ${pins.length} dataset files + datasets/pins.json`);
}

await main();
