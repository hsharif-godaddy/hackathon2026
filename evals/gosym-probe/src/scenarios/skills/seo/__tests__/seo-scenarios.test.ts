import { describe, it, expect } from 'vitest';
import { addMetaTagsScenario } from '../add-meta-tags.js';
import { seoAuditFlowScenario } from '../seo-audit-flow.js';
import { noDuplicateTitlesScenario } from '../no-duplicate-titles.js';
import { followExistingPatternScenario } from '../follow-existing-pattern.js';
import { addStructuredDataScenario } from '../add-structured-data.js';
import { registerNewRouteScenario } from '../register-new-route.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../../../scenarios/__tests__/scenario-test-helpers.js';

const mockGocode = makeGocodeClient();
const mockCtrlPlane = makeCtrlPlaneClient();

const REQUIRED_EVALUATORS = [
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

describe('seo suite scenarios', () => {
  describe('seo-add-meta-tags', () => {
    const scenario = addMetaTagsScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('seo-add-meta-tags');
      expect(scenario.suite).toBe('seo');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
      expect(
        scenario.goals.every((g) => g.description.length > 0),
      ).toBe(true);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and grepSearch tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'grepSearch', called: true }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });

    it('uses a static first message about meta tags', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('meta tags');
    });
  });

  describe('seo-audit-flow', () => {
    const scenario = seoAuditFlowScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('seo-audit-flow');
      expect(scenario.suite).toBe('seo');
    });

    it('has 4 goals', () => {
      expect(scenario.goals).toHaveLength(4);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects seoAnalysis tool call', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'seoAnalysis', called: true }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });

    it('uses a static first message about SEO audit', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('SEO audit');
    });
  });

  describe('seo-no-duplicate-titles', () => {
    const scenario = noDuplicateTitlesScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('seo-no-duplicate-titles');
      expect(scenario.suite).toBe('seo');
    });

    it('has 5 goals (including a negative assertion)', () => {
      expect(scenario.goals).toHaveLength(5);
      const negativeGoals = scenario.goals.filter(
        (g) => g.assertion === 'negative',
      );
      expect(negativeGoals).toHaveLength(1);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and readFile tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'readFile', called: true }),
      );
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('seo-follow-existing-pattern', () => {
    const scenario = followExistingPatternScenario(
      mockGocode, mockCtrlPlane,
    );

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('seo-follow-existing-pattern');
      expect(scenario.suite).toBe('seo');
    });

    it('has 4 goals (including a negative assertion)', () => {
      expect(scenario.goals).toHaveLength(4);
      const negativeGoals = scenario.goals.filter(
        (g) => g.assertion === 'negative',
      );
      expect(negativeGoals).toHaveLength(1);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects grepSearch and readFile tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'grepSearch', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'readFile', called: true }),
      );
    });

    it('uses a static first message about existing Helmet', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('Helmet');
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('seo-add-structured-data', () => {
    const scenario = addStructuredDataScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('seo-add-structured-data');
      expect(scenario.suite).toBe('seo');
    });

    it('has 5 goals', () => {
      expect(scenario.goals).toHaveLength(5);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill tool call', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
    });

    it('uses a static first message about a local bakery', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('bakery');
      expect(scenario.staticFirstMessage).toContain('Portland');
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });

  describe('seo-register-new-route', () => {
    const scenario = registerNewRouteScenario(mockGocode, mockCtrlPlane);

    it('has correct name and suite', () => {
      expect(scenario.name).toBe('seo-register-new-route');
      expect(scenario.suite).toBe('seo');
    });

    it('has 4 goals (including a negative assertion)', () => {
      expect(scenario.goals).toHaveLength(4);
      const negativeGoals = scenario.goals.filter(
        (g) => g.assertion === 'negative',
      );
      expect(negativeGoals).toHaveLength(1);
    });

    it('includes all required evaluators', () => {
      const names = scenario.evaluators.map((e) => e.name);
      for (const evalName of REQUIRED_EVALUATORS) {
        expect(names).toContain(evalName);
      }
    });

    it('expects skill and readFile tool calls', () => {
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'skill', called: true }),
      );
      expect(scenario.expectedTools).toContainEqual(
        expect.objectContaining({ tool: 'readFile', called: true }),
      );
    });

    it('uses a static first message about a pricing page', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage).toContain('pricing');
      expect(scenario.staticFirstMessage).toContain('sitemap');
    });

    it('defaults to 3 trials', () => {
      expect(scenario.trials).toBe(3);
    });
  });
});
