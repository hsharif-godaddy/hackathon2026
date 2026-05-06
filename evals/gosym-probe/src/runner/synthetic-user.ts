import type { GoalTracker } from './goal-tracker.js';
import type { Scenario } from '../scenarios/types.js';
import type { Turn } from './transcript.js';

export interface SyntheticUserAgent {
  nextMessage(
    history: Turn[],
    scenario: Scenario,
    goalTracker?: GoalTracker,
  ): Promise<string | null>;
}
