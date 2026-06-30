import { createGoldenLightScenario } from './golden-light/create-golden-light-scenario.js';
import { CasingViolationsEvaluator } from '../evaluators/casing-violations.js';

import type { IGocodeClient } from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../clients/aab-ctrl-plane-client.js';
import type { Scenario, ScenarioGoal } from './types.js';

/**
 * AIROBUILD-2976 #2 — type casing / "all-caps eyebrows that scream AI". A compact,
 * section-dense prompt (several short sections, each introduced by a small label/
 * kicker above its heading) is exactly where the agent reaches for the generic
 * "small + UPPERCASE + tracking-widest" eyebrow — even when the loaded kit's spec
 * is lowercase. The prompt is kept to a single screen so the design-system
 * first-build completes within one turn. The `CasingViolationsEvaluator` scores
 * the result.
 *
 * Two scenarios, frozen as a matched pair for the before/after baseline:
 * - `casing-eyebrows-kit`: design-system auto-select profile pinned to `Aether`
 *   (its `typography.scale.labelCase` is `lowercase` — the headline case where an
 *   all-caps eyebrow violates the kit).
 * - `casing-eyebrows-control`: same prompt, default profile → template baseline +
 *   the non-kit regression guard for the Part-A guardrail.
 *
 * Run notes: drive with `--max-turns 1` (single-shot build — the synthetic user
 * has no context compaction, so a second turn replays the whole transcript and
 * exceeds the model context window). Raise the per-turn cap with `TURN_TIMEOUT_MS`
 * if the design-system first-build runs long.
 */
const CASING_PROMPT: string =
  'Build a single, compact one-screen landing page for "Northwind Labs", a research ' +
  'studio. Keep it small \u2014 a hero with a short kicker line above the headline, then ' +
  'three brief feature blurbs each introduced by a small section label above its ' +
  'heading, and a short footer. Do not add extra sections.';

const CASING_GOALS: [ScenarioGoal, ...ScenarioGoal[]] = [
  {
    description: "Eyebrows, kickers and section labels follow the kit's casing (lowercase for this kit), not gratuitous ALL-CAPS",
    assertion: 'positive',
  },
  {
    description: 'All-caps + wide letter-spacing is not applied to labels the kit does not mark uppercase',
    assertion: 'positive',
  },
];

export function buildCasingScenarios(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  const kit: Scenario = createGoldenLightScenario(
    {
      name: 'casing-eyebrows-kit',
      suite: 'casing',
      agentProfile: 'initial-agent-design-system-homepage-build',
      designKitSlug: 'Aether',
      staticFirstMessage: CASING_PROMPT,
      goals: CASING_GOALS,
      trials: 3,
      extraEvaluators: [new CasingViolationsEvaluator()],
    },
    gocode,
    ctrlPlane,
  );

  const control: Scenario = createGoldenLightScenario(
    {
      name: 'casing-eyebrows-control',
      suite: 'casing',
      staticFirstMessage: CASING_PROMPT,
      goals: CASING_GOALS,
      trials: 3,
      extraEvaluators: [new CasingViolationsEvaluator()],
    },
    gocode,
    ctrlPlane,
  );

  return [kit, control];
}
