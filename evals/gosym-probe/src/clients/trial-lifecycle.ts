/**
 * Lifecycle interface for per-trial isolation. Implementations bracket
 * trial execution so that downstream calls (e.g. GocodeClient) route to
 * the correct per-trial instance, and release resources when the trial
 * completes.
 */
export interface TrialLifecycle {
  /**
   * Runs `fn` inside an isolation scope tagged with the given scenario
   * and trial index. All downstream calls that depend on trial identity
   * resolve to the correct per-trial resource within `fn`'s async stack.
   */
  runInScope<T>(
    scenario: string,
    trialIndex: number,
    fn: () => Promise<T>,
  ): Promise<T>;

  /**
   * Releases the per-trial resource for the given scenario and trial.
   * Idempotent: calling for a non-existent key is a no-op. Should be
   * called in the trial's `finally` block to prevent unbounded growth.
   */
  release(scenario: string, trialIndex: number): void;
}
