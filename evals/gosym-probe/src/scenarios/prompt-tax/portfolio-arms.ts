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
 * The seven arms of the portfolio experiment. Each maps a cheat-sheet pattern to
 * a single-lever change vs the in-run control:
 *   control     — canonical prompt, standard persona (the in-run baseline)
 *   compressed  — Pattern #1, reuses the existing compressed-develop profile
 *   emotional   — Pattern #3, emotional-stakes fragment prepended
 *   persona     — Pattern #6, code-reviewer persona prepended
 *   generic     — Pattern #2, generic coding advice appended
 *   haiku       — Pattern #5, develop agent runs on Haiku (model swap only)
 *   blind       — Pattern #4, blind-review synthetic-user persona
 */
export const PORTFOLIO_ARMS: readonly PromptTaxArm[] = [
  { arm: 'control' },
  { arm: 'compressed', agentProfile: 'compressed-develop' },
  { arm: 'emotional', agentProfile: 'emotional-develop' },
  { arm: 'persona', agentProfile: 'persona-develop' },
  { arm: 'generic', agentProfile: 'generic-develop' },
  { arm: 'haiku', agentProfile: 'haiku-develop' },
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
