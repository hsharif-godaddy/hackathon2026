import { sleep } from "./sleep.js";

export const STAGGER_INTERVAL_MS = 1_000;

/**
 * Computes the stagger delay for a given item index within a capped worker pool.
 * Items beyond the first batch (index >= cap) receive zero delay (first-batch-only
 * semantics). Callers that want cycling behavior (e.g. staggeredRun) pass
 * `index % cap` to wrap indices back into the first-batch range.
 */
export function computeStaggerDelay(
  index: number,
  concurrencyCap: number,
  intervalMs: number = STAGGER_INTERVAL_MS,
): number {
  if (index >= concurrencyCap) return 0;
  return index * intervalMs;
}

export async function staggeredRun<T>(
  index: number,
  concurrencyCap: number,
  fn: () => Promise<T>,
): Promise<T> {
  const delay = computeStaggerDelay(index % concurrencyCap, concurrencyCap);
  if (delay > 0) {
    await sleep(delay);
  }
  return fn();
}
