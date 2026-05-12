import { describe, it, expect } from 'vitest';
import {
  simplePortfolioScenario,
  businessSiteScenario,
  multipageCatalogScenario,
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
  'latency',
  'token-usage',
  'llm-cost',
  'tool-parallelism',
  'turn-duration',
];

type ScenarioBuilder = (
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
) => Scenario;

const scenarios: {
  builder: ScenarioBuilder;
  name: string;
  goalCount: number;
}[] = [
  {
    builder: simplePortfolioScenario,
    name: 'simple-portfolio',
    goalCount: 1,
  },
  {
    builder: businessSiteScenario,
    name: 'business-site',
    goalCount: 2,
  },
  {
    builder: multipageCatalogScenario,
    name: 'multipage-catalog',
    goalCount: 3,
  },
];

describe('build-quality suite', () => {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();

  describe.each(scenarios)(
    '$name',
    ({ builder, name, goalCount }) => {
      const scenario = builder(gocode, ctrlPlane);

      it('has correct name and suite', () => {
        expect(scenario.name).toBe(name);
        expect(scenario.suite).toBe('build-quality');
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

      it('uses parallel execution', () => {
        expect(scenario.executionMode).toBe('parallel');
      });

      it('has a static first message', () => {
        expect(
          scenario.staticFirstMessage ?? '',
        ).not.toHaveLength(0);
      });
    },
  );
});
