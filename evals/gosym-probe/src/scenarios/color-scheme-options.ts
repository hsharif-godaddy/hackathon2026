import { createGoldenLightScenario } from './golden-light/create-golden-light-scenario.js';
import { ColorSchemeSuggestEvaluator } from '../evaluators/color-scheme-suggest.js';

import type { IGocodeClient } from '../clients/gocode-client.js';
import type { AABCtrlPlaneClient } from '../clients/aab-ctrl-plane-client.js';
import type { Scenario, ScenarioGoal } from './types.js';

/**
 * AIROBUILD-2976 — "show me more color schemes" use case. Exercises the colorScheme
 * tool's SUGGEST mode (the `color-palette-grid` the customer picks from) rather than
 * a built page. The `ColorSchemeSuggestEvaluator` reads the suggested palettes out of
 * the tool-call output and audits each for AA-safe muted text — the regression guard
 * for "asking for more color schemes still returns contrast-safe options".
 *
 * Behavioral caveat: the score only materializes if the agent actually calls
 * `colorScheme` in suggest mode for this turn; otherwise the evaluator returns
 * `verdict: unknown` (not a failure). The prompt is framed as an EXISTING site
 * exploring alternatives (suggest mode's documented use is "user wants to see/compare
 * palette options on content that exists" — the tool is told NOT to suggest before a
 * page exists). If a graduated run still reports `unknown`, confirm `colorScheme`
 * fired (PROBE_DEBUG_EVENTS) and tune the prompt before freezing a baseline. Drive
 * with `--max-turns 1` (single-shot, like the contrast scenarios).
 */
const SUGGEST_PROMPT: string =
  'My portfolio website for a photographer is already up. Before I commit to a look, ' +
  'I want to compare a few different color schemes \u2014 show me several color palette ' +
  'options as a grid so I can pick one. Don\u2019t apply any yet; I just want to see the ' +
  'choices side by side.';

const SUGGEST_GOALS: [ScenarioGoal, ...ScenarioGoal[]] = [
  {
    description: 'The agent presents multiple color scheme options for the customer to choose from',
    assertion: 'positive',
  },
  {
    description: 'Every suggested color scheme has low-emphasis/muted text that meets WCAG AA (>= 4.5:1) on its surfaces',
    assertion: 'positive',
  },
];

export function buildColorSchemeOptionsScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoldenLightScenario(
    {
      name: 'color-scheme-options',
      suite: 'contrast',
      staticFirstMessage: SUGGEST_PROMPT,
      goals: SUGGEST_GOALS,
      trials: 3,
      extraEvaluators: [new ColorSchemeSuggestEvaluator()],
    },
    gocode,
    ctrlPlane,
  );
}
