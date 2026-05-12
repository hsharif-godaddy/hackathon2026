import { describe, it, expect } from 'vitest';
import {
  simplePortfolioScenario,
  businessSiteScenario,
  multipageCatalogScenario,
} from '../golden-light/index.js';
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

const PVS_REQUIRED_EVALUATORS = [
  'bug-hit-rate',
  'tool-failure-rate',
  'prompt-efficiency',
  'tool-call-verification',
  'jtbd-completion',
  'tool-parallelism',
  'turn-duration',
  'token-usage',
  'llm-cost',
];


function assertScenarioShape(scenario: Scenario, expectedName: string): void {
  expect(scenario.name).toBe(expectedName);
  expect(scenario.goals.length).toBeGreaterThan(0);
  expect(scenario.trials).toBeGreaterThanOrEqual(1);

  const evaluatorNames = scenario.evaluators.map((e) => e.name);
  expect(evaluatorNames).toContain('token-usage');
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
  });

  it('pvs-symptom-blank-page has token evaluators and valid shape', () => {
    const scenario = symptomBlankPageScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'pvs-symptom-blank-page');
    const names = scenario.evaluators.map((e) => e.name);
    for (const evalName of PVS_REQUIRED_EVALUATORS) {
      expect(names).toContain(evalName);
    }
  });

  it('pvs-symptom-changes-not-showing has token evaluators and valid shape', () => {
    const scenario = symptomChangesNotShowingScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'pvs-symptom-changes-not-showing');
    const names = scenario.evaluators.map((e) => e.name);
    for (const evalName of PVS_REQUIRED_EVALUATORS) {
      expect(names).toContain(evalName);
    }
  });

  it('pvs-symptom-module-not-found has token evaluators and valid shape', () => {
    const scenario = symptomModuleNotFoundScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'pvs-symptom-module-not-found');
    const names = scenario.evaluators.map((e) => e.name);
    for (const evalName of PVS_REQUIRED_EVALUATORS) {
      expect(names).toContain(evalName);
    }
  });

  it('pvs-multi-turn-publish-flow has token evaluators and valid shape', () => {
    const scenario = multiTurnPublishFlowScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'pvs-multi-turn-publish-flow');
    const names = scenario.evaluators.map((e) => e.name);
    for (const evalName of PVS_REQUIRED_EVALUATORS) {
      expect(names).toContain(evalName);
    }
  });

  it('complex-prompt-latency has token evaluators and valid shape', () => {
    assertScenarioShape(
      complexPromptLatencyScenario(gocode, ctrlPlane),
      'complex-prompt-latency',
    );
  });
});
