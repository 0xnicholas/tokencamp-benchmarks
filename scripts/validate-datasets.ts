import {
  instanceFiles,
  loadPins,
  validateDatasetTree,
  validateInstanceFile,
} from "../src/core/datasets";

/**
 * CI gate for the frozen Task Dataset: validates every `instances.jsonl` file
 * against the envelope, and `datasets/pins.json` against the files on disk
 * (sha256, instance counts, licenses, verifier pointers).
 *
 *   bun run datasets:validate
 */

const root = "datasets";
const files = instanceFiles(root);

if (files.length === 0) {
  console.error(`✗ ${root}: no instances.jsonl files found`);
  process.exit(1);
}

let pins: ReturnType<typeof loadPins> | null = null;
try {
  pins = loadPins(root);
} catch (error) {
  console.error(`✗ ${root}/pins.json: ${(error as Error).message}`);
}

for (const file of files) {
  const report = validateInstanceFile(file, root);
  const pin = pins?.datasets.find((entry) => entry.path === `${root}/${report.path}`);
  const ok = report.errors.length === 0 && pin?.sha256 === report.sha256;
  const marker = ok ? "✓" : "✗";
  console.log(
    `${marker} ${report.path.padEnd(66)} ${String(report.instances).padStart(4)} instances  sha256:${report.sha256.slice(0, 12)}`,
  );
  for (const error of report.errors) console.log(`    ${error}`);
}

const errors = validateDatasetTree(root);
if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} dataset validation error(s):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`\n✓ ${files.length} dataset files validated against the envelope and pins.json`);
