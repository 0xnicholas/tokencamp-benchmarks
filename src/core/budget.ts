/**
 * The per-run spend guard (ADR-0006): refuses new attempts once actual spend
 * reaches `--max-spend-usd`. The ledger fills from streamed attempt rows
 * (settled headline spend, ADR-0006); in-flight attempts finish — the guard is
 * per-attempt granular, and the agentic loop checks it between turns (#19).
 */
export class RunBudget {
  readonly #maxSpendUsd: number;
  #spentUsd = 0;
  #exceeded = false;

  constructor(options: { readonly maxSpendUsd: number }) {
    this.#maxSpendUsd = options.maxSpendUsd;
  }

  get spentUsd(): number {
    return this.#spentUsd;
  }

  get exceeded(): boolean {
    return this.#exceeded;
  }

  record(spendUsd: number): void {
    this.#spentUsd += spendUsd;
    if (this.#spentUsd >= this.#maxSpendUsd) {
      this.#exceeded = true;
    }
  }
}
