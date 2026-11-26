import { describe, expect, test } from "bun:test";
import { RunBudget } from "./budget";

describe("RunBudget", () => {
  test("accumulates spend and exceeds at the cap (ADR-0006: refuse new attempts at budget)", () => {
    const budget = new RunBudget({ maxSpendUsd: 1 });
    expect(budget.exceeded).toBe(false);
    budget.record(0.4);
    expect(budget.exceeded).toBe(false);
    budget.record(0.4);
    expect(budget.exceeded).toBe(false);
    budget.record(0.4); // 1.2 ≥ 1.0
    expect(budget.exceeded).toBe(true);
    expect(budget.spentUsd).toBeCloseTo(1.2, 12);
  });

  test("exact spend reaching the budget counts as reached", () => {
    const budget = new RunBudget({ maxSpendUsd: 2 });
    budget.record(2);
    expect(budget.exceeded).toBe(true);
  });

  test("spend below the cap never flips the guard", () => {
    const budget = new RunBudget({ maxSpendUsd: 1 });
    budget.record(0.999);
    expect(budget.exceeded).toBe(false);
  });
});
