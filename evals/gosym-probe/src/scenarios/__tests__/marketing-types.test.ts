import { describe, it, expect } from 'vitest';
import {
  NO_MARKETING_HANDOFF,
  type Claims,
  type ToolCallAssertion,
  type Scenario,
} from '../types.js';

describe('marketing scenario typing', () => {
  it('accepts contextClaims and an arg-aware tool assertion', () => {
    const claims: Claims = { marketingCampaignsEnabled: true };
    const assertion: ToolCallAssertion = {
      tool: 'handoff',
      called: false,
      args: { targetAgent: 'marketing' },
    };
    const shape: Pick<Scenario, 'contextClaims' | 'expectedTools'> = {
      contextClaims: claims,
      expectedTools: [assertion],
    };
    expect(shape.contextClaims?.marketingCampaignsEnabled).toBe(true);
    expect(shape.expectedTools?.[0].args).toEqual({ targetAgent: 'marketing' });
  });
});

describe('NO_MARKETING_HANDOFF (develop-owned)', () => {
  it('asserts the handoff tool is NOT called targeting marketing', () => {
    expect(NO_MARKETING_HANDOFF.tool).toBe('handoff');
    expect(NO_MARKETING_HANDOFF.called).toBe(false);
    expect(NO_MARKETING_HANDOFF.args).toEqual({ targetAgent: 'marketing' });
  });
});
