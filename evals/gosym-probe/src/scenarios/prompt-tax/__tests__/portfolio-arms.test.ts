import { describe, it, expect } from 'vitest';
import {
  buildPortfolioPromptTaxScenarios,
  PORTFOLIO_ARMS,
} from '../index.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../__tests__/scenario-test-helpers.js';

const REQUIRED_EVALUATORS = [
  'bug-hit-rate',
  'tool-failure-rate',
  'prompt-efficiency',
  'jtbd-completion',
  'output-quality',
  'agent-steps',
  'token-usage',
  'turn-duration',
  'intent-to-output-alignment',
  'implicit-feature-gap',
  'silent-hallucination',
];

describe('prompt-tax portfolio suite', () => {
  const gocode = makeGocodeClient();
  const ctrlPlane = makeCtrlPlaneClient();
  const scenarios = buildPortfolioPromptTaxScenarios(gocode, ctrlPlane);

  it('builds one scenario per arm', () => {
    expect(scenarios).toHaveLength(PORTFOLIO_ARMS.length);
    expect(scenarios).toHaveLength(2);
  });

  it('names every scenario pt-portfolio-<arm> under the prompt-tax suite', () => {
    const names = scenarios.map((s) => s.name).sort();
    expect(names).toEqual(
      [
        'pt-portfolio-control',
        'pt-portfolio-blind',
      ].sort(),
    );
    expect(scenarios.every((s) => s.suite === 'prompt-tax')).toBe(true);
  });

  it('holds the build task constant across every arm', () => {
    const prompts = new Set(
      scenarios.map((s) => s.staticFirstMessage),
    );
    const goalText = new Set(
      scenarios.map((s) => s.goals.map((g) => g.description).join('|')),
    );
    expect(prompts.size).toBe(1);
    expect(goalText.size).toBe(1);
    expect([...prompts][0]).toContain('personal portfolio website');
  });

  it('varies exactly one lever per arm vs the control', () => {
    const byName = new Map(scenarios.map((s) => [s.name, s]));

    const control = byName.get('pt-portfolio-control');
    expect(control?.agentProfile).toBeUndefined();
    expect(control?.persona?.name).toBe('standard');

    // Persona-swap arm: persona changes, no agentProfile. (The five
    // develop-agent profile-swap arms were retired with their profiles; see
    // portfolio-arms.ts. No arm references an agentProfile until one is re-added.)
    const blind = byName.get('pt-portfolio-blind');
    expect(blind?.agentProfile).toBeUndefined();
    expect(blind?.persona?.name).toBe('blind-review');

    // Guard: no surviving arm points at a develop profile (would silently
    // collapse to control if the profile is absent).
    expect(scenarios.every((s) => s.agentProfile === undefined)).toBe(true);
  });

  it('includes all required evaluators on every arm', () => {
    for (const scenario of scenarios) {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    }
  });
});
