import { describe, it, expect } from 'vitest';
import {
  MARKETING_HANDOFF,
  MARKETING_AGENT_DISPLAY_NAME,
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

describe('MARKETING_HANDOFF (baseline)', () => {
  it('asserts the handoff tool IS called targeting marketing', () => {
    expect(MARKETING_HANDOFF.tool).toBe('handoff');
    expect(MARKETING_HANDOFF.called).toBe(true);
    expect(MARKETING_HANDOFF.args).toEqual({ targetAgent: 'marketing' });
  });
  it('exposes the marketing agent display name', () => {
    expect(MARKETING_AGENT_DISPLAY_NAME).toBe('Airo Marketer');
  });
});
