import { createGoldenLightScenario } from './golden-light/create-golden-light-scenario.js';
import { ContrastViolationsEvaluator } from '../evaluators/contrast-violations.js';

import type { IGocodeClient } from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../clients/aab-ctrl-plane-client.js';
import type { Scenario, ScenarioGoal } from './types.js';

/**
 * AIROBUILD-2976 #1 — color/contrast pairing. A compact, metadata-dense prompt
 * (muted subtitle, caption text, fine-print footer metadata) is exactly where the
 * agent reaches for low-emphasis/"tertiary" text — the situation that produces low
 * contrast. The prompt is deliberately kept to a single screen so the design-system
 * first-build completes within one turn (see run notes below); the contrast signal
 * lives in the small/muted surfaces, not in page volume. The
 * `ContrastViolationsEvaluator` scores the result.
 *
 * Two scenarios, frozen as a matched pair for the before/after baseline:
 * - `contrast-pairing-kit`: design-system auto-select profile (kit's `--ink-tertiary`
 *   is in context → the headline case).
 * - `contrast-pairing-control`: same prompt, default profile → template baseline +
 *   the non-kit regression guard for the PR-B guardrail.
 *
 * Run notes: drive with `--max-turns 1` (single-shot build — the synthetic user has
 * no context compaction, so a second turn replays the whole transcript and exceeds
 * the model context window). The design-system first-build can run long; raise the
 * per-turn cap with `TURN_TIMEOUT_MS` if needed. `trials` is intentionally modest in
 * the definition; a frozen baseline run bumps it via the runner's stability override.
 */
const CONTRAST_PROMPT: string =
  'Build a single, compact one-screen landing page for "Meridian Studio", a design ' +
  'consultancy. Keep it small \u2014 just a hero with a headline and a muted one-line ' +
  'subtitle, one short testimonial with the author name and company in small caption ' +
  'text, and a footer with fine-print metadata: address, opening hours, social links, ' +
  'and a copyright line. Do not add extra sections.';

const CONTRAST_GOALS: [ScenarioGoal, ...ScenarioGoal[]] = [
  {
    description:
      'All body text, captions, metadata and labels meet WCAG AA contrast (>= 4.5:1) against their backgrounds',
    assertion: 'positive',
  },
  {
    description: 'Low-emphasis/secondary text is not placed on backgrounds it lacks contrast against',
    assertion: 'positive',
  },
];

export function buildContrastScenarios(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  const kit: Scenario = createGoldenLightScenario(
    {
      name: 'contrast-pairing-kit',
      suite: 'contrast',
      agentProfile: 'initial-agent-design-system-homepage-build',
      designKitSlug: 'Aether',
      staticFirstMessage: CONTRAST_PROMPT,
      goals: CONTRAST_GOALS,
      trials: 3,
      extraEvaluators: [new ContrastViolationsEvaluator()],
    },
    gocode,
    ctrlPlane,
  );

  const control: Scenario = createGoldenLightScenario(
    {
      name: 'contrast-pairing-control',
      suite: 'contrast',
      staticFirstMessage: CONTRAST_PROMPT,
      goals: CONTRAST_GOALS,
      trials: 3,
      extraEvaluators: [new ContrastViolationsEvaluator()],
    },
    gocode,
    ctrlPlane,
  );

  return [kit, control];
}
