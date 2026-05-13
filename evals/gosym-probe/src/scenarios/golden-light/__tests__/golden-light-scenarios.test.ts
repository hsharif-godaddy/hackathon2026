import { describe, it, expect } from 'vitest';
import {
  simplePortfolioScenario,
  businessSiteScenario,
  multipageCatalogScenario,
  cleaningBizAmbiguityScenario,
} from '../index.js';

import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../__tests__/scenario-test-helpers.js';
import type { GocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';

const REQUIRED_EVALUATORS = [
  'bug-hit-rate',
  'tool-failure-rate',
  'prompt-efficiency',
  'jtbd-completion',
  'output-quality',
  'agent-steps',
  'token-usage',
  'intent-to-output-alignment',
  'implicit-feature-gap',
  'scope-drift-overgeneration',
  'silent-hallucination',
];

type ScenarioBuilder = (
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
) => Scenario;

const scenarios: {
  builder: ScenarioBuilder;
  name: string;
  goalCount: number;
  hasStaticFirstMessage: boolean;
  expectedPersonaName?: string;
}[] = [
  {
    builder: simplePortfolioScenario,
    name: 'simple-portfolio',
    goalCount: 1,
    hasStaticFirstMessage: true,
  },
  {
    builder: businessSiteScenario,
    name: 'business-site',
    goalCount: 2,
    hasStaticFirstMessage: true,
  },
  {
    builder: multipageCatalogScenario,
    name: 'multipage-catalog',
    goalCount: 3,
    hasStaticFirstMessage: true,
  },
  {
    builder: cleaningBizAmbiguityScenario,
    name: 'cleaning-biz-ambiguity',
    goalCount: 1,
    hasStaticFirstMessage: false,
    expectedPersonaName: 'cleaning-biz-owner',
  },
];

describe('golden-light suite', () => {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();

  describe.each(scenarios)(
    '$name',
    ({ builder, name, goalCount, hasStaticFirstMessage, expectedPersonaName }) => {
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

      if (hasStaticFirstMessage) {
        it('has a static first message', () => {
          expect(
            scenario.staticFirstMessage ?? '',
          ).not.toHaveLength(0);
        });
      } else {
        it('has no static first message but has a persona', () => {
          expect(scenario.staticFirstMessage).toBeUndefined();
          expect(scenario.persona).toBeDefined();
          expect(scenario.persona?.name).toBe(expectedPersonaName);
        });
      }
    },
  );
});
