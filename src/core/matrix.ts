import matrix from "../../models/matrix.json";

const MATRIX_IDS: ReadonlySet<string> = new Set(matrix.models.map((model) => model.id));

/**
 * ADR-0004 model-matrix discipline: every legal model id is pinned in
 * models/matrix.json and nothing outside the matrix runs. Virtual routing ids
 * (tokencamp/auto, forge/*) are not matrix members, so this check subsumes
 * the ban.
 */
export function isModelInMatrix(modelId: string): boolean {
  return MATRIX_IDS.has(modelId);
}

export function matrixModelIds(): readonly string[] {
  return [...MATRIX_IDS].sort();
}
