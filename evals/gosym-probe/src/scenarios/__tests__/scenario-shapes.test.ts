import { describe, it, expect } from 'vitest';
import {
  simplePortfolioScenario,
  businessSiteScenario,
  multipageCatalogScenario,
} from '../build-quality/index.js';
import { buildLandingPageScenario } from '../build-landing-page.js';
import {
  symptomBlankPageScenario,
  symptomChangesNotShowingScenario,
  symptomModuleNotFoundScenario,
  multiTurnPublishFlowScenario,
} from '../prompt-vs-skill/index.js';
import { complexPromptLatencyScenario } from '../complex-prompt-latency.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from './scenario-test-helpers.js';
import type { Scenario } from '../types.js';

const VALID_CATEGORIES = ['capability', 'regression'] as const;

function assertScenarioShape(scenario: Scenario, expectedName: string): void {
  expect(scenario.name).toBe(expectedName);
  expect(scenario.goals.length).toBeGreaterThan(0);
  expect(scenario.trials).toBeGreaterThanOrEqual(1);
  expect(VALID_CATEGORIES).toContain(scenario.category);

  const evaluatorNames = scenario.evaluators.map((e) => e.name);
  expect(evaluatorNames).toContain('token-usage');
  expect(evaluatorNames).toContain('llm-cost');
}

describe('scenario shapes', () => {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();

  it('simple-portfolio has token evaluators and valid shape', () => {
    assertScenarioShape(
      simplePortfolioScenario(gocode, ctrlPlane),
      'simple-portfolio',
    );
  });

  it('business-site has token evaluators and valid shape', () => {
    assertScenarioShape(
      businessSiteScenario(gocode, ctrlPlane),
      'business-site',
    );
  });

  it('multipage-catalog has token evaluators and valid shape', () => {
    assertScenarioShape(
      multipageCatalogScenario(gocode, ctrlPlane),
      'multipage-catalog',
    );
  });

  it('build-landing-page has token evaluators and valid shape', () => {
    const scenario = buildLandingPageScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'build-landing-page');
    expect(scenario.evaluators.map((e) => e.name)).toContain('agent-steps');
    expect(scenario.maxTurns).toBe(8);
  });

  it('pvs-symptom-blank-page has token evaluators and valid shape', () => {
    assertScenarioShape(
      symptomBlankPageScenario(gocode, ctrlPlane),
      'pvs-symptom-blank-page',
    );
  });

  it('pvs-symptom-changes-not-showing has token evaluators and valid shape', () => {
    assertScenarioShape(
      symptomChangesNotShowingScenario(gocode, ctrlPlane),
      'pvs-symptom-changes-not-showing',
    );
  });

  it('pvs-symptom-module-not-found has token evaluators and valid shape', () => {
    assertScenarioShape(
      symptomModuleNotFoundScenario(gocode, ctrlPlane),
      'pvs-symptom-module-not-found',
    );
  });

  it('pvs-multi-turn-publish-flow has token evaluators and valid shape', () => {
    assertScenarioShape(
      multiTurnPublishFlowScenario(gocode, ctrlPlane),
      'pvs-multi-turn-publish-flow',
    );
  });

  it('complex-prompt-latency has token evaluators and valid shape', () => {
    assertScenarioShape(
      complexPromptLatencyScenario(gocode, ctrlPlane),
      'complex-prompt-latency',
    );
  });
});
