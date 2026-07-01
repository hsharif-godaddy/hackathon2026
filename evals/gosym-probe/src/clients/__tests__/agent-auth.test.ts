import { describe, it, expect } from 'vitest';
import { resolveAgentAuth } from '../agent-auth.js';
import type { AgentContext } from '../aab-client.js';

const profile: AgentContext = {
  siteId: 'bypass-site',
  agentProfile: 'develop',
  agentProfileSelectorEnabled: true,
};

describe('resolveAgentAuth', () => {
  it('needs no auth and defaults siteId when neither profile nor claims present', () => {
    const result = resolveAgentAuth(undefined, undefined);
    expect(result.needsAuth).toBe(false);
    expect(result.claims).toEqual({ siteId: 'bypass-site' });
  });

  it('needs auth and passes the profile through when agentContext present', () => {
    const result = resolveAgentAuth(profile, undefined);
    expect(result.needsAuth).toBe(true);
    expect(result.claims).toEqual(profile);
  });

  it('needs auth and merges a switchboard claim onto the bypass-site default', () => {
    const result = resolveAgentAuth(undefined, {
      marketingCampaignsEnabled: true,
    });
    expect(result.needsAuth).toBe(true);
    expect(result.claims).toEqual({
      siteId: 'bypass-site',
      marketingCampaignsEnabled: true,
    });
  });

  it('merges claims on top of the profile when both present', () => {
    const result = resolveAgentAuth(profile, {
      marketingCampaignsEnabled: true,
    });
    expect(result.needsAuth).toBe(true);
    expect(result.claims).toEqual({
      ...profile,
      marketingCampaignsEnabled: true,
    });
  });

  it('treats an empty claims object as no claims', () => {
    const result = resolveAgentAuth(undefined, {});
    expect(result.needsAuth).toBe(false);
    expect(result.claims).toEqual({ siteId: 'bypass-site' });
  });
});
