import { describe, it, expect } from 'vitest';
import { seoAuditFlowScenario } from '../seo-audit-flow.js';
import {
  makeGocodeClient,
  makeCtrlPlaneClient,
} from '../../../__tests__/scenario-test-helpers.js';
import { MARKETING_HANDOFF } from '../../../types.js';

describe('seo-audit-flow marketing-handoff baseline', () => {
  const scenario = seoAuditFlowScenario(makeGocodeClient(), makeCtrlPlaneClient());

  it('asserts the handoff to the marketing agent is called', () => {
    expect(scenario.expectedTools).toContainEqual(MARKETING_HANDOFF);
  });

  it('still asserts the seoAnalysis tool is called', () => {
    expect(scenario.expectedTools).toContainEqual(
      expect.objectContaining({ tool: 'seoAnalysis', called: true }),
    );
  });

  it('carries a positive goal about routing to marketing', () => {
    expect(scenario.goals).toHaveLength(4);
    expect(
      scenario.goals.some(
        (g) => g.assertion === 'positive' && /marketing/i.test(g.description),
      ),
    ).toBe(true);
  });
});
