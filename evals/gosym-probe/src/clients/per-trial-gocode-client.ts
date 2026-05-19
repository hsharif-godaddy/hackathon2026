import { AsyncLocalStorage } from 'async_hooks';
import { GocodeClient } from './gocode-client.js';
import type { IGocodeClient, Message, ProbeUsage } from './gocode-client.js';
import type { TrialLifecycle } from './trial-lifecycle.js';
import type { Config } from '../../config/environments/types.js';

interface TrialKey {
  scenario: string;
  index: number;
}

const trialStorage = new AsyncLocalStorage<TrialKey>();

function compositeKey(scenario: string, index: number): string {
  return `${scenario}:${index}`;
}

/**
 * A `GocodeClient` proxy that maintains one isolated `GocodeClient` instance
 * per (scenario, trialIndex) pair. Callers must wrap each trial's execution in
 * `runInScope()` so that `complete()`, `getAccumulatedUsage()`, and
 * `resetAccumulatedUsage()` route to the correct per-trial instance.
 *
 * Implements `TrialLifecycle` so it can be injected into `SuiteRunner` for
 * both scope bracketing and resource cleanup.
 *
 * Usage pattern:
 *   const client = new PerTrialGocodeClient(config.gocode);
 *   await client.runInScope('my-scenario', 0, async () => {
 *     await client.complete(messages);   // routes to trial's own GocodeClient
 *     client.getAccumulatedUsage();      // returns only this trial's tokens
 *   });
 *   client.release('my-scenario', 0);   // discard the per-trial instance
 */
export class PerTrialGocodeClient implements IGocodeClient, TrialLifecycle {
  private readonly instances = new Map<string, GocodeClient>();

  constructor(private readonly config: Config['gocode']) {}

  private resolve(): GocodeClient {
    const key = trialStorage.getStore();
    if (key === undefined) {
      throw new Error(
        'PerTrialGocodeClient: called outside a trial scope. Wrap execution in runInScope().',
      );
    }
    const mapKey = compositeKey(key.scenario, key.index);
    const existing = this.instances.get(mapKey);
    if (existing !== undefined) return existing;
    const instance = new GocodeClient(this.config);
    this.instances.set(mapKey, instance);
    return instance;
  }

  async complete(
    messages: Message[],
    options?: { signal?: AbortSignal },
  ): Promise<string> {
    return this.resolve().complete(messages, options);
  }

  getAccumulatedUsage(): ProbeUsage {
    return this.resolve().getAccumulatedUsage();
  }

  getModel(): string {
    return this.config.model;
  }

  withModel(model: string): IGocodeClient {
    return new GocodeClient({ ...this.config, model });
  }

  resetAccumulatedUsage(): void {
    this.resolve().resetAccumulatedUsage();
  }

  /**
   * Runs `fn` inside an AsyncLocalStorage context tagged with the given
   * scenario and trial index. Any `PerTrialGocodeClient` method called
   * within `fn`'s async call stack will resolve to the instance for this
   * (scenario, trialIndex) pair.
   */
  runInScope<T>(
    scenario: string,
    trialIndex: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    return trialStorage.run({ scenario, index: trialIndex }, fn);
  }

  /**
   * Removes the per-trial instance for the given scenario and trial index.
   * Idempotent: calling for a non-existent key is a no-op. Should be called
   * in the trial's `finally` block to prevent unbounded map growth.
   */
  release(scenario: string, trialIndex: number): void {
    this.instances.delete(compositeKey(scenario, trialIndex));
  }
}
