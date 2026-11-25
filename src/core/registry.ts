import type { Benchmark } from "./types";

/**
 * Name-keyed benchmark registry. Real benchmarks register themselves here as
 * they are built (model layer first, then the task layer reuses it); the
 * registry ships empty in the harness-core ticket.
 */
const REGISTRY: Record<string, Benchmark> = {};

export function registerBenchmark(benchmark: Benchmark): void {
  REGISTRY[benchmark.meta.id] = benchmark;
}

export function getBenchmark(id: string): Benchmark | undefined {
  return REGISTRY[id];
}

export function benchmarkIds(): readonly string[] {
  return Object.keys(REGISTRY).sort();
}

export function allBenchmarks(): readonly Benchmark[] {
  return benchmarkIds().map((id) => REGISTRY[id]!);
}
