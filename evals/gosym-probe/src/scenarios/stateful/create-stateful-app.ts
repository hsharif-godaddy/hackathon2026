import type {
  AABCtrlPlaneClient,
  ProvisionResult,
} from '../../clients/aab-ctrl-plane-client.js';
import type { SeedSummaryInput } from '../../clients/aab-agents-api-client.js';
import type { SetupContext } from '../types.js';

/**
 * Seeds prefabricated conversation state for an app. Injected (rather than
 * taking the full agents client) so createStatefulApp stays decoupled from the
 * transport and is trivially testable. Typically `AABAgentsApiClient.seedSummary`
 * bound to a client instance.
 */
export type SummarySeeder = (
  appId: string,
  summary: SeedSummaryInput,
) => Promise<void>;

/**
 * Lifecycle hooks (setup/teardown) a scenario plugs into its Scenario object.
 */
export interface StatefulAppLifecycle {
  setup: () => Promise<SetupContext>;
  /** Per-trial teardown — a no-op, since the app is shared across trials. */
  teardown: (ctx: SetupContext) => Promise<void>;
  /**
   * Deletes the shared app exactly once. Call after all trials for the
   * scenario complete (scenario-level teardown / suite end), NOT per trial.
   */
  teardownShared: () => Promise<void>;
}

export interface StatefulAppOptions {
  /**
   * Reset the shared app to its baseline before every trial. Default true.
   * The first trial provisions and runs against the fresh app (establishing
   * the baseline); each subsequent trial resets the workspace first so it
   * starts from the same state instead of accumulating prior trials' edits.
   */
  resetBetweenTrials?: boolean;
  /**
   * Optional commit to reset to. Omitted → reset to HEAD (the app's state as
   * the control plane last committed it). The control plane defaults to the
   * app's git HEAD when no commit is given.
   */
  resetCommit?: string;
  /**
   * Reuse a pre-built app instead of provisioning a fresh one. When set, every
   * trial (including the first) resets this app to `resetCommit` and runs
   * against that fixed base — the only way to measure an *increment* task's
   * variance cleanly, since a freshly-provisioned or build-from-scratch base
   * carries its own build variance. `teardownShared` does NOT delete a borrowed
   * app (the caller owns its lifecycle). Pair with an increment-only
   * `scriptedTurns` and a `resetCommit` pinned to the built base.
   *
   * Requires `resetBetweenTrials` (the default): with it off, trials accumulate
   * edits on the borrowed base instead of resetting to the pinned commit,
   * defeating the fixed-base contract.
   *
   * Requires serial trials (`--concurrency 1`): every trial resets the shared
   * workspace, so two concurrent `setup()` calls would issue overlapping
   * `resetApp` on the same app — one trial's reset firing mid-build of another.
   * Scenarios opt in via the golden-light factory, which marks them
   * `requiresSerialTrials`; the suite runner then throws if effective
   * concurrency is > 1. Do not call `createStatefulApp` directly under
   * concurrent trials without that guard.
   */
  existingApp?: ProvisionResult;
  /**
   * Prefabricated conversation state to seed before each trial so the run
   * starts mid-conversation rather than from turn 0. Authored to match the
   * filesystem state at `resetCommit` (e.g. "a landing page with hero + contact
   * form already exists"). Seeded AFTER the workspace reset on every trial that
   * resets — so each trial starts from the same file state AND the same
   * conversation memory — via {@link seedSummary}, which writes the summary the
   * agent injects on turn 0. Without a `seedSummary` callback this is ignored.
   *
   * Filesystem mid-state alone (resetCommit) makes the agent re-read the whole
   * site every trial; pairing it with this conversation seed is what lets a run
   * genuinely resume mid-conversation.
   */
  seededSummary?: SeedSummaryInput;
}

/**
 * Builds memoized setup/teardown for a scenario that **reuses one provisioned
 * app across all its trials** instead of provisioning a fresh one per trial.
 *
 * Why: per-trial provisioning + from-scratch builds are the dominant source of
 * eval variance (sigma~mu tool-loop noise, quantified in 1b.i). Sharing one app
 * and resetting its workspace between trials means each trial starts from the
 * same state, so the measured variance reflects the agent's behaviour, not how
 * many round-trips a cold build happened to take.
 *
 * Concurrency: only *provisioning* is concurrency-safe — it is memoized via a
 * single shared promise, so trials racing on the first `setup()` all await the
 * same provision rather than each creating an app. The reset+run cycle is NOT
 * concurrency-safe: a shared workspace cannot be reset while a sibling trial
 * builds against it, so stateful scenarios must run serially (enforced by
 * `requiresSerialTrials` at the factory + a runner guard). Teardown deletes the
 * shared app exactly once (after the final trial / scenario teardown) —
 * per-trial teardown is intentionally a no-op here, since deleting a shared app
 * mid-suite would break the remaining trials.
 *
 * The returned `setup` is safe to call once per trial; `teardown` is safe to
 * call once per trial too (only the app-deleting final call does work).
 */
export function createStatefulApp(
  ctrlPlane: Pick<AABCtrlPlaneClient, 'provisionApp' | 'resetApp' | 'deleteApp'>,
  options: StatefulAppOptions = {},
  seedSummary?: SummarySeeder,
): StatefulAppLifecycle {
  const resetBetweenTrials = options.resetBetweenTrials ?? true;
  const existingApp = options.existingApp;
  const seededSummary = options.seededSummary;
  if (seededSummary && !seedSummary) {
    throw new Error(
      'createStatefulApp: options.seededSummary was set but no seedSummary ' +
      'callback was provided; the summary would silently never be seeded',
    );
  }

  // Shared provisioning promise — the first setup() kicks it off, every other
  // trial (sequential or concurrent) awaits the same result. When reusing an
  // existing app, this resolves immediately to it (no provisioning).
  let provisionPromise: Promise<SetupContext> | null = null;
  let firstSetupDone = false;

  const provisionOnce = (): Promise<SetupContext> => {
    if (provisionPromise === null) {
      if (existingApp) {
        provisionPromise = Promise.resolve({
          appId: existingApp.appId,
          previewUrl: existingApp.previewUrl,
        });
      } else {
        // Clear the memo on failure so a later trial can re-attempt rather than
        // every trial inheriting one transient provision error. provisionApp
        // already retries internally, so reaching here means retries were
        // exhausted — but a fresh trial getting a fresh shot is still preferable
        // to poisoning the whole scenario.
        provisionPromise = ctrlPlane.provisionApp().then(
          ({ appId, previewUrl }) => ({ appId, previewUrl }),
          (err: unknown) => {
            provisionPromise = null;
            throw err;
          },
        );
      }
    }
    return provisionPromise;
  };

  const setup = async (): Promise<SetupContext> => {
    const ctx = await provisionOnce();

    // Reset to the fixed base before a trial runs. For a borrowed existing app
    // EVERY trial resets (including the first) so all trials start from the
    // pinned base. For a provisioned app the first trial establishes the
    // baseline and only subsequent trials reset back to it.
    const shouldReset = Boolean(
      resetBetweenTrials && ctx.appId
      && (existingApp !== undefined || firstSetupDone),
    );
    if (shouldReset) {
      await ctrlPlane.resetApp(ctx.appId!, {
        ...(options.resetCommit !== undefined && { commit: options.resetCommit }),
      });
      // Seed conversation state AFTER the filesystem reset so the trial starts
      // from the same file base AND the same conversation memory. Seeding on
      // every resetting trial (rather than once) makes the prefab summary the
      // latest summary at turn 0 even if a prior trial's run produced its own
      // summary — the agent's findLatestForApp would otherwise pick that up.
      if (seededSummary && seedSummary) {
        await seedSummary(ctx.appId!, seededSummary);
      }
    }
    firstSetupDone = true;
    return ctx;
  };

  const teardown = async (_ctx: SetupContext): Promise<void> => {
    // Per-trial no-op: the app is shared, so deletion happens once via
    // teardownShared() after all trials complete — never here.
  };

  const teardownShared = async (): Promise<void> => {
    // Never delete a borrowed app — the caller owns its lifecycle.
    if (existingApp || provisionPromise === null) return;
    const ctx = await provisionPromise;
    if (ctx.appId) {
      await ctrlPlane.deleteApp(ctx.appId);
    }
  };

  return { setup, teardown, teardownShared };
}
