import { describe, it, expect } from 'vitest';
import {
  simplePortfolioScenario,
  multipageCatalogScenario,
} from '../golden-light/index.js';
import { buildLandingPageScenario } from '../build-landing-page.js';
import {
  symptomBlankPageScenario,
  symptomChangesNotShowingScenario,
  symptomModuleNotFoundScenario,
  multiTurnPublishFlowScenario,
  contactPageExpectationsScenario,
} from '../prompt-vs-skill/index.js';
import { complexPromptLatencyScenario } from '../complex-prompt-latency.js';
import { buildWithExplicitNameScenario } from '../todo-lifecycle/build-with-explicit-name.js';
import { reAskInToolCallScenario } from '../todo-lifecycle/re-ask-in-tool-call.js';
import { inboxSkillEvalScenario } from '../skill-eval/inbox.js';
import { buildContrastScenarios } from '../contrast-pairing.js';
import { buildCasingScenarios } from '../casing-eyebrows.js';
import { buildColorSchemeOptionsScenario } from '../color-scheme-options.js';
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

/**
 * Assert a scenario carries the static-rigor skill-eval wiring + fields.
 * The deterministic evaluators (expected-artifact-match, skill-selection)
 * always run; the narrow LLM judge is calibration-only and must be ABSENT
 * unless the scenario was built with calibrate=true.
 */
function assertSkillEvalWiring(scenario: Scenario, expectedSkills: string[]): void {
  const names = scenario.evaluators.map((e) => e.name);
  expect(names).toContain('expected-artifact-match');
  expect(names).toContain('skill-selection');
  expect(names).not.toContain('narrow-artifact-judge');
  expect(scenario.expectedArtifact?.items.length).toBeGreaterThan(0);
  expect(scenario.expectedAgent).toBe('AI Developer');
  expect(scenario.expectedSkills).toEqual(expectedSkills);
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

  it('multipage-catalog has token evaluators and valid shape', () => {
    const scenario = multipageCatalogScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'multipage-catalog');
    assertSkillEvalWiring(scenario, ['commerce']);
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
    assertSkillEvalWiring(scenario, ['publishing']);
  });

  it('pvs-contact-page-expectations wires the static-rigor evaluators + expectation', () => {
    const scenario = contactPageExpectationsScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'pvs-contact-page-expectations');
    const names = scenario.evaluators.map((e) => e.name);
    for (const evalName of PVS_REQUIRED_EVALUATORS) {
      expect(names).toContain(evalName);
    }
    assertSkillEvalWiring(scenario, ['inbox']);
    expect(scenario.staticFirstMessage).toBeTruthy();
  });

  it('calibrate=true adds the narrow-artifact-judge to skill-eval scenarios', () => {
    const contact = contactPageExpectationsScenario(gocode, ctrlPlane, true);
    const catalog = multipageCatalogScenario(gocode, ctrlPlane, true);
    const publish = multiTurnPublishFlowScenario(gocode, ctrlPlane, true);
    for (const scenario of [contact, catalog, publish]) {
      const names = scenario.evaluators.map((e) => e.name);
      expect(names).toContain('narrow-artifact-judge');
      expect(names).toContain('expected-artifact-match');
      expect(names).toContain('skill-selection');
    }
  });

  it('complex-prompt-latency has token evaluators and valid shape', () => {
    assertScenarioShape(
      complexPromptLatencyScenario(gocode, ctrlPlane),
      'complex-prompt-latency',
    );
  });

  it('build-with-explicit-name has todo-lifecycle evaluator and 5 trials', () => {
    const scenario = buildWithExplicitNameScenario(gocode, ctrlPlane);
    expect(scenario.name).toBe('build-with-explicit-name');
    expect(scenario.goals.length).toBeGreaterThan(0);
    expect(scenario.evaluators.map((e) => e.name)).toContain('todo-lifecycle');
    expect(scenario.trials).toBe(5);
  });

  it('re-ask-in-tool-call has todo-lifecycle evaluator and 5 trials', () => {
    const scenario = reAskInToolCallScenario(gocode, ctrlPlane);
    expect(scenario.name).toBe('re-ask-in-tool-call');
    expect(scenario.goals.length).toBeGreaterThan(0);
    expect(scenario.evaluators.map((e) => e.name)).toContain('todo-lifecycle');
    expect(scenario.trials).toBe(5);
  });

  it('skill-eval-inbox has skill-selection, skill-outcome, and skillInstructions', () => {
    const scenario = inboxSkillEvalScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'skill-eval-inbox');
    const names = scenario.evaluators.map((e) => e.name);
    expect(names).toContain('skill-selection');
    expect(names).toContain('skill-outcome');
    expect(scenario.suite).toBe('skill-eval');
    expect(scenario.expectedSkills).toEqual(['inbox']);
    expect(scenario.expectedAgent).toBeUndefined();
    expect(scenario.skillInstructions).toBeDefined();
    expect(scenario.skillInstructions!.length).toBe(3);
    expect(scenario.staticFirstMessage).toBeTruthy();
  });

  it('contrast-pairing-kit + control have valid shape and the contrast evaluator', () => {
    const [kit, control] = buildContrastScenarios(gocode, ctrlPlane);
    assertScenarioShape(kit, 'contrast-pairing-kit');
    assertScenarioShape(control, 'contrast-pairing-control');
    for (const scenario of [kit, control]) {
      expect(scenario.suite).toBe('contrast');
      expect(scenario.evaluators.map((e) => e.name)).toContain('contrast-violations');
    }
  });

  it('casing-eyebrows-kit + control have valid shape and the casing evaluator', () => {
    const [kit, control] = buildCasingScenarios(gocode, ctrlPlane);
    assertScenarioShape(kit, 'casing-eyebrows-kit');
    assertScenarioShape(control, 'casing-eyebrows-control');
    for (const scenario of [kit, control]) {
      expect(scenario.suite).toBe('casing');
      expect(scenario.evaluators.map((e) => e.name)).toContain('casing-violations');
    }
  });

  it('color-scheme-options has valid shape and the suggest evaluator', () => {
    const scenario = buildColorSchemeOptionsScenario(gocode, ctrlPlane);
    assertScenarioShape(scenario, 'color-scheme-options');
    expect(scenario.suite).toBe('contrast');
    expect(scenario.evaluators.map((e) => e.name)).toContain('color-scheme-suggest-contrast');
  });
});
