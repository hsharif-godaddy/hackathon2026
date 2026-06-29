import type { SyntheticUserAgent } from './synthetic-user.js';
import type { GoalTracker } from './goal-tracker.js';
import type { Scenario } from '../scenarios/types.js';
import type { Turn } from './transcript.js';

/**
 * Stateful-injection synthetic user. When a scenario declares
 * {@link Scenario.scriptedTurns}, this replays entry `n` verbatim on the nth
 * user turn with no LLM call — removing synthetic-user variance from the
 * simulation. Once the script is exhausted it either ends the conversation
 * (when {@link Scenario.scriptEndsConversation} is set) or delegates to the
 * wrapped LLM-backed user for free-form continuation.
 *
 * Scenarios without `scriptedTurns` pass straight through to the delegate, so
 * wrapping the default {@link GocodeSyntheticUser} in this is behaviour-neutral
 * for every existing scenario.
 */
export class ScriptedSyntheticUser implements SyntheticUserAgent {
  constructor(private readonly delegate: SyntheticUserAgent) {}

  async nextMessage(
    history: Turn[],
    scenario: Scenario,
    goalTracker?: GoalTracker,
  ): Promise<string | null> {
    const script = scenario.scriptedTurns;
    if (script === undefined || script.length === 0) {
      return this.delegate.nextMessage(history, scenario, goalTracker);
    }

    const userTurns = history.filter((t) => t.role === 'user').length;
    if (userTurns < script.length) {
      return script[userTurns];
    }

    // Script exhausted.
    if (scenario.scriptEndsConversation) {
      return null;
    }
    return this.delegate.nextMessage(history, scenario, goalTracker);
  }
}
