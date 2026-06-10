import { createGoldenLightScenario }
  from '../golden-light/create-golden-light-scenario.js';
import type { GoldenLightConfig }
  from '../golden-light/create-golden-light-scenario.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';
import type { Persona } from '../../personas/types.js';

/**
 * The base build task shared by every arm of a prompt-tax experiment. Holding
 * the prompt + goals constant across arms is what makes the A/B atomic: the only
 * thing that varies between sibling scenarios is the arm (agentProfile / persona).
 */
export interface PromptTaxTask {
  /** Short task id used in scenario names, e.g. 'portfolio' -> pt-portfolio-<arm>. */
  taskId: string;
  staticFirstMessage: GoldenLightConfig['staticFirstMessage'];
  goals: GoldenLightConfig['goals'];
}

/**
 * A single experiment arm. Exactly one lever changes vs the control:
 * - `agentProfile` flips an AAB-side develop-agent profile (prompt/model variant).
 * - `persona` swaps the synthetic-user behavior (e.g. blind-review).
 * The control arm sets neither (canonical prompt, standard persona).
 */
export interface PromptTaxArm {
  /** Arm id used in the scenario name, e.g. 'emotional' -> pt-portfolio-emotional. */
  arm: string;
  /** AAB develop-agent profile to activate for this arm (undefined = canonical). */
  agentProfile?: string;
  /** Synthetic-user persona override (undefined = standard via golden-light default). */
  persona?: Persona;
}

export const PROMPT_TAX_SUITE = 'prompt-tax';

/**
 * Build one prompt-tax scenario = base task + arm. Reuses the golden-light
 * factory so every arm carries the identical 14-evaluator set (token-usage,
 * turn-duration, agent-steps, output-quality, ...). Named `pt-<taskId>-<arm>` and
 * grouped under the `prompt-tax` suite so the whole experiment runs in one
 * `--suite prompt-tax` invocation and is compared like-for-like, in-run.
 */
export function createPromptTaxScenario(
  task: PromptTaxTask,
  arm: PromptTaxArm,
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoldenLightScenario(
    {
      name: `pt-${task.taskId}-${arm.arm}`,
      suite: PROMPT_TAX_SUITE,
      agentProfile: arm.agentProfile,
      persona: arm.persona,
      staticFirstMessage: task.staticFirstMessage,
      goals: task.goals,
    },
    gocode,
    ctrlPlane,
  );
}
