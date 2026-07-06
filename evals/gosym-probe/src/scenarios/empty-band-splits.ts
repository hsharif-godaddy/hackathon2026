import { createGoldenLightScenario } from './golden-light/create-golden-light-scenario.js';
import { EmptyBandViolationsEvaluator } from '../evaluators/empty-band-violations.js';

import type { IGocodeClient } from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../clients/aab-ctrl-plane-client.js';
import type { Scenario, ScenarioGoal } from './types.js';

/**
 * AIROBUILD-2976 #4 — empty divider + full-bleed "split" with no content between.
 * A multi-section prompt that asks for "clear full-width separation between
 * sections" is exactly where the agent reaches for a hollow full-bleed band or a
 * tall divider that splits the page with nothing in it — the missing/broken-section
 * tell Ann flagged. The prompt is kept to a single screen so the design-system
 * first-build completes within one turn. The `EmptyBandViolationsEvaluator` scores
 * the result.
 *
 * Two scenarios, frozen as a matched pair for the before/after baseline:
 * - `empty-band-splits-kit`: design-system auto-select profile pinned to a kit
 *   (the kit drops `spacing`/`layout` tokens, the condition that worsened the
 *   symptom in the original report).
 * - `empty-band-splits-control`: same prompt, default profile → template baseline +
 *   the non-kit regression guard for the Part-A guardrail.
 *
 * Run notes: drive with `--max-turns 1` (single-shot build — the synthetic user
 * has no context compaction, so a second turn replays the whole transcript and
 * exceeds the model context window). Raise the per-turn cap with `TURN_TIMEOUT_MS`
 * if the design-system first-build runs long.
 */
const EMPTY_BAND_PROMPT: string =
  'Build a single, compact one-screen landing page for "Atlas Freight", a logistics ' +
  'company. Give it a hero, two short feature sections, and a footer, with clear ' +
  'full-width visual separation between the sections. Do not add extra sections.';

const EMPTY_BAND_GOALS: [ScenarioGoal, ...ScenarioGoal[]] = [
  {
    description:
      'Section separators and full-bleed bands wrap real content (heading, media, or copy); no empty/hollow split bands',
    assertion: 'positive',
  },
  {
    description: 'No content-less full-bleed band or tall divider splits the page where there is nothing between sections',
    assertion: 'positive',
  },
];

export function buildEmptyBandScenarios(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario[] {
  const kit: Scenario = createGoldenLightScenario(
    {
      name: 'empty-band-splits-kit',
      suite: 'empty-band',
      agentProfile: 'initial-agent-design-system-homepage-build',
      designKitSlug: 'Aether',
      staticFirstMessage: EMPTY_BAND_PROMPT,
      goals: EMPTY_BAND_GOALS,
      trials: 3,
      extraEvaluators: [new EmptyBandViolationsEvaluator()],
    },
    gocode,
    ctrlPlane,
  );

  const control: Scenario = createGoldenLightScenario(
    {
      name: 'empty-band-splits-control',
      suite: 'empty-band',
      staticFirstMessage: EMPTY_BAND_PROMPT,
      goals: EMPTY_BAND_GOALS,
      trials: 3,
      extraEvaluators: [new EmptyBandViolationsEvaluator()],
    },
    gocode,
    ctrlPlane,
  );

  return [kit, control];
}
