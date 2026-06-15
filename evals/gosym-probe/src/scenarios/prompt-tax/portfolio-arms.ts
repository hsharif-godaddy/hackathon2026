import {
  createPromptTaxScenario,
  type PromptTaxArm,
  type PromptTaxTask,
} from './create-prompt-tax-scenario.js';
import { blindReviewPersona } from '../../personas/blind-review.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

/**
 * Base build task for the portfolio prompt-tax experiment. Identical prompt and
 * goal to the golden-light `simple-portfolio` scenario, so the prompt-tax control
 * arm reproduces the established baseline and every other arm differs by exactly
 * one lever.
 */
const PORTFOLIO_PROMPT = [
  'Build me a personal portfolio website with:',
  '- A hero section with my name and a short tagline',
  '- An about section describing my background',
  '- A contact section with an email link and social',
  '  media icons',
  'Use a clean, modern design with good spacing.',
].join('\n');

const PORTFOLIO_TASK: PromptTaxTask = {
  taskId: 'portfolio',
  staticFirstMessage: PORTFOLIO_PROMPT,
  goals: [
    {
      description:
        'The agent creates a personal portfolio site with ' +
        'a hero section, an about section, and a contact ' +
        'section',
      assertion: 'positive',
    },
  ],
};

/**
 * The arms of the portfolio experiment. Each maps a cheat-sheet pattern to a
 * single-lever change vs the in-run control:
 *   control     — canonical prompt, standard persona (the in-run baseline)
 *   blind       — Pattern #4, blind-review synthetic-user persona
 *
 * The five develop-agent profile-swap arms (compressed / emotional / persona /
 * generic / haiku) were retired when their finished-experiment profiles were
 * removed from the agents service. Re-running them now would silently collapse
 * to control — resolveProfile returns null for an unknown profile, so the build
 * is byte-identical to the baseline — producing invalid treatment data with no
 * error. They are dropped rather than left pointing at deleted profiles.
 *
 * To A/B a develop-prompt lever again, add an eval prompt variant on the agents
 * side (EVAL_PROMPT_VARIANTS in develop-prompt-variants.ts) and select it here.
 * IMPORTANT ordering constraint: do NOT activate a develop variant via a profile
 * registered in agents/src/profiles/ — a registered profile flag is
 * JWT-resolveProfile-reachable on real prod sessions (the P2 leak). The
 * eval-only transport (an eval/mock-auth-gated request field) must land before
 * or with the first registered variant profile. See
 * agents/src/prompts/develop/experiments/README.md ("Ordering constraint").
 */
export const PORTFOLIO_ARMS: readonly PromptTaxArm[] = [
  { arm: 'control' },
  { arm: 'blind', persona: blindReviewPersona },
];

/**
 * Build all portfolio prompt-tax scenarios (one per arm). Spread into the
 * registry so `--suite prompt-tax` runs every arm in a single invocation.
 */
export function buildPortfolioPromptTaxScenarios(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  return PORTFOLIO_ARMS.map((arm) =>
    createPromptTaxScenario(PORTFOLIO_TASK, arm, gocode, ctrlPlane),
  );
}
