import { describe, it, expect } from 'vitest';
import {
  simplePortfolioScenario,
  multipageCatalogScenario,
  cleaningBizAmbiguityScenario,
} from '../index.js';

import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../__tests__/scenario-test-helpers.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

const REQUIRED_EVALUATORS = [
  'bug-hit-rate',
  'tool-failure-rate',
  'prompt-efficiency',
  'jtbd-completion',
  'output-quality-passrate',
  'output-quality-scoremode',
  'agent-steps',
  'token-usage',
  'intent-to-output-alignment',
  'implicit-feature-gap',
  'silent-hallucination',
];

type ScenarioBuilder = (
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
) => Scenario;

const scenarios: {
  builder: ScenarioBuilder;
  name: string;
  goalCount: number;
  hasStaticFirstMessage: boolean;
  persona: string;
}[] = [
  {
    builder: simplePortfolioScenario,
    name: 'simple-portfolio',
    goalCount: 1,
    hasStaticFirstMessage: true,
    persona: 'standard',
  },
  {
    builder: multipageCatalogScenario,
    name: 'multipage-catalog',
    goalCount: 3,
    hasStaticFirstMessage: true,
    persona: 'standard',
  },
  {
    builder: cleaningBizAmbiguityScenario,
    name: 'cleaning-biz-ambiguity',
    goalCount: 1,
    hasStaticFirstMessage: true,
    persona: 'cleaning-biz-owner',
  },
];

describe('golden-light suite', () => {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();

  describe.each(scenarios)(
    '$name',
    ({ builder, name, goalCount, hasStaticFirstMessage, persona }) => {
      const scenario = builder(gocode, ctrlPlane);

      it('has correct name and suite', () => {
        expect(scenario.name).toBe(name);
        expect(scenario.suite).toBe('golden-light');
      });

      it(`has ${goalCount} goal(s)`, () => {
        expect(scenario.goals).toHaveLength(goalCount);
        expect(
          scenario.goals.every(
            (g) => g.description.length > 0,
          ),
        ).toBe(true);
      });

      it('includes all required evaluators', () => {
        const names = scenario.evaluators.map((e) => e.name);
        for (const evalName of REQUIRED_EVALUATORS) {
          expect(names).toContain(evalName);
        }
      });

      it('has 3 trials', () => {
        expect(scenario.trials).toBe(3);
      });

      it('has a static first message', () => {
        expect(
          scenario.staticFirstMessage ?? '',
        ).not.toHaveLength(0);
      });

      it('has the expected persona', () => {
        expect(scenario.persona).toBeDefined();
        expect(scenario.persona?.name).toBe(persona);
      });
    },
  );
});
