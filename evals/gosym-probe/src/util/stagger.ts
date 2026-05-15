import { sleep } from "./sleep.js";

export const STAGGER_INTERVAL_MS = 1_000;

export async function staggeredRun<T>(
  index: number,
  concurrencyCap: number,
  fn: () => Promise<T>,
): Promise<T> {
  const delay = (index % concurrencyCap) * STAGGER_INTERVAL_MS;
  if (delay > 0) {
    await sleep(delay);
  }
  return fn();
}
