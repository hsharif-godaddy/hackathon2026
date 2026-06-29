import { describe, it, expect, vi } from 'vitest';
import { skillNonSelectionScenario } from '../skill-non-selection.js';
import { wrongSkillRoutingScenario } from '../wrong-skill-routing.js';
import { seoNonSelectionScenario } from '../seo-non-selection.js';
import { googleAnalyticsNonSelectionScenario }
  from '../google-analytics-non-selection.js';
import { googleReviewsNonSelectionScenario }
  from '../google-reviews-non-selection.js';
import { authenticationNonSelectionScenario }
  from '../authentication-non-selection.js';
import { onlineAppointmentsNonSelectionScenario }
  from '../online-appointments-non-selection.js';
import { commerceVsPaymentRoutingScenario }
  from '../commerce-vs-payment-routing.js';
import type { Scenario } from '../../types.js';
import type { IGocodeClient } from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';

function stubGocode(): IGocodeClient {
  return {
    chat: vi.fn(),
    chatJson: vi.fn(),
    getModel: () => 'test-model',
    resetAccumulatedUsage: vi.fn(),
    withModel: vi.fn(),
    getAccumulatedUsage: vi.fn().mockReturnValue({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      calls: 0,
    }),
  } as unknown as IGocodeClient;
}

function stubCtrlPlane(): AABCtrlPlaneClient {
  return {
    provisionApp: vi.fn(),
    deleteApp: vi.fn(),
  } as unknown as AABCtrlPlaneClient;
}

describe('skill-issue scenarios (1d)', () => {
  const gocode = stubGocode();
  const ctrlPlane = stubCtrlPlane();

  describe('skillNonSelectionScenario', () => {
    const scenario = skillNonSelectionScenario(gocode, ctrlPlane);

    it('expects the database skill so non-selection is detectable', () => {
      expect(scenario.expectedSkills).toEqual(['database']);
    });

    it('wires the skill-selection evaluator that catches non-selection', () => {
      const names = scenario.evaluators.map((e) => e.name);
      expect(names).toContain('skill-selection');
    });

    it('requires using the skill (instruction-level signal independent of diagnostics)', () => {
      const required = (scenario.skillInstructions ?? []).filter(
        (i) => i.priority === 'required',
      );
      expect(required.length).toBeGreaterThan(0);
      expect(
        (scenario.skillInstructions ?? []).some((i) =>
          /database skill/i.test(i.instruction),
        ),
      ).toBe(true);
    });

    it('phrases the intent without naming the skill (so a pretrained path can misfire)', () => {
      expect(scenario.staticFirstMessage).toBeDefined();
      expect(scenario.staticFirstMessage!.toLowerCase()).not.toContain('database');
      expect(scenario.staticFirstMessage!.toLowerCase()).not.toContain('skill');
    });
  });

  describe('wrongSkillRoutingScenario', () => {
    const scenario = wrongSkillRoutingScenario(gocode, ctrlPlane);

    it('expects the inbox skill (the correct route)', () => {
      expect(scenario.expectedSkills).toEqual(['inbox']);
    });

    it('forbids the email skill so the misroute is caught by the judge', () => {
      const noEmail = (scenario.skillInstructions ?? []).find(
        (i) => i.id === 'no-email-skill',
      );
      expect(noEmail).toBeDefined();
      expect(noEmail!.priority).toBe('required');
      expect(noEmail!.instruction.toLowerCase()).toContain('email');
    });

    it('wires the skill-selection evaluator', () => {
      expect(scenario.evaluators.map((e) => e.name)).toContain('skill-selection');
    });
  });

  // The golden-set non-selection scenarios (1d, expanding coverage across the
  // skill-refactoring tracker) all share the same detection contract: a single
  // expected skill, the skill-selection evaluator wired, a `required`
  // instruction naming the skill, and an intent that never names the skill so a
  // pretrained path can misfire.
  const nonSelectionCases: ReadonlyArray<{
    label: string;
    factory: (g: IGocodeClient, c: AABCtrlPlaneClient) => Scenario;
    skill: string;
    forbiddenIntentWords: readonly string[];
  }> = [
    {
      label: 'seoNonSelectionScenario',
      factory: seoNonSelectionScenario,
      skill: 'seo',
      forbiddenIntentWords: ['skill', 'seo'],
    },
    {
      label: 'googleAnalyticsNonSelectionScenario',
      factory: googleAnalyticsNonSelectionScenario,
      skill: 'google-analytics',
      forbiddenIntentWords: ['skill', 'google analytics', 'ga4'],
    },
    {
      label: 'googleReviewsNonSelectionScenario',
      factory: googleReviewsNonSelectionScenario,
      skill: 'google-reviews',
      forbiddenIntentWords: ['skill'],
    },
    {
      label: 'authenticationNonSelectionScenario',
      factory: authenticationNonSelectionScenario,
      skill: 'authentication',
      forbiddenIntentWords: ['skill', 'authentication', 'better-auth'],
    },
    {
      label: 'onlineAppointmentsNonSelectionScenario',
      factory: onlineAppointmentsNonSelectionScenario,
      skill: 'online-appointments',
      forbiddenIntentWords: ['skill'],
    },
  ];

  describe.each(nonSelectionCases)(
    '$label',
    ({ factory, skill, forbiddenIntentWords }) => {
      const scenario = factory(gocode, ctrlPlane);

      it(`expects the ${skill} skill so non-selection is detectable`, () => {
        expect(scenario.expectedSkills).toEqual([skill]);
      });

      it('wires the skill-selection evaluator', () => {
        expect(scenario.evaluators.map((e) => e.name)).toContain(
          'skill-selection',
        );
      });

      it('has a required instruction naming the skill', () => {
        const required = (scenario.skillInstructions ?? []).filter(
          (i) => i.priority === 'required',
        );
        expect(required.length).toBeGreaterThan(0);
        expect(
          required.some((i) =>
            i.instruction.toLowerCase().includes(skill.replace(/-/g, ' '))
            || i.instruction.toLowerCase().includes(skill),
          ),
        ).toBe(true);
      });

      it('phrases the intent without naming the skill', () => {
        expect(scenario.staticFirstMessage).toBeDefined();
        const intent = scenario.staticFirstMessage!.toLowerCase();
        for (const word of forbiddenIntentWords) {
          expect(intent).not.toContain(word);
        }
      });
    },
  );

  describe('commerceVsPaymentRoutingScenario', () => {
    const scenario = commerceVsPaymentRoutingScenario(gocode, ctrlPlane);

    it('expects the commerce skill (the correct route)', () => {
      expect(scenario.expectedSkills).toEqual(['commerce']);
    });

    it('forbids the payment router so the misroute is caught by the judge', () => {
      const noPayment = (scenario.skillInstructions ?? []).find(
        (i) => i.id === 'no-payment-router',
      );
      expect(noPayment).toBeDefined();
      expect(noPayment!.priority).toBe('required');
      expect(noPayment!.instruction.toLowerCase()).toContain('stripe');
    });

    it('wires the skill-selection evaluator', () => {
      expect(scenario.evaluators.map((e) => e.name)).toContain(
        'skill-selection',
      );
    });
  });
});
