/**
 * Core Paywall Eligibility Algorithm Tests
 *
 * Tests the core paywall logic with mock providers to ensure
 * the algorithm correctly determines access based on various scenarios.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPaywallEligibility } from './core.ts';
import type { PaywallDataProvider, SwitchboardFlagsResult } from './providers.ts';
import type { ProjectEdge } from './shared.ts';

/**
 * Mock logger to avoid console output during tests
 */
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Create a mock provider for testing
 */
function createMockProvider(overrides: Partial<PaywallDataProvider> = {}): PaywallDataProvider {
  return {
    getRootDomain: vi.fn().mockReturnValue('test-godaddy.com'),
    checkSwitchboardFlags: vi.fn().mockResolvedValue({ paywall: true, markets: true }),
    getSubscription: vi.fn().mockResolvedValue('sub-123'),
    getEntitlements: vi.fn().mockResolvedValue('ent-123'),
    getProjects: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('checkPaywallEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should deny access when no root domain (fail closed)', async () => {
    const provider = createMockProvider({
      getRootDomain: vi.fn().mockReturnValue(null),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(false);
    expect(result.reason).toContain('no root domain');
    expect(provider.checkSwitchboardFlags).not.toHaveBeenCalled();
  });

  it('should allow access when paywall is disabled (switchboard flags)', async () => {
    const provider = createMockProvider({
      checkSwitchboardFlags: vi.fn().mockResolvedValue({ paywall: false, markets: true }),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(true);
    expect(result.reason).toBe('Paywall not enabled');
  });

  it('should deny access when switchboard check fails (fail closed)', async () => {
    const provider = createMockProvider({
      checkSwitchboardFlags: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(false);
    expect(result.reason).toContain('switchboard check failed');
  });

  it('should block access when no subscription found', async () => {
    const provider = createMockProvider({
      getSubscription: vi.fn().mockResolvedValue(undefined),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe('No active subscription found');
    expect(result.details.hasSubscription).toBe(false);
  });

  it('should grant access when user has entitlements', async () => {
    const provider = createMockProvider({
      getSubscription: vi.fn().mockResolvedValue('sub-123'),
      getEntitlements: vi.fn().mockResolvedValue('ent-456'),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(true);
    expect(result.details.hasSubscription).toBe(true);
    expect(result.details.hasEntitlements).toBe(true);
    expect(result.details.subscriptionId).toBe('sub-123');
    expect(result.details.entitlementId).toBe('ent-456');
  });

  it('should grant access when user has matching project (fallback)', async () => {
    const provider = createMockProvider({
      getSubscription: vi.fn().mockResolvedValue('sub-123'),
      getEntitlements: vi.fn().mockResolvedValue(undefined),
      getProjects: vi.fn().mockResolvedValue([
        {
          node: {
            group: 'aigeneratedmedia',
            status: 'ACTIVE',
            billing: {
              id: 'billing-789',
              plan: 'logoImage',
            },
          },
        },
      ] as ProjectEdge[]),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(true);
    expect(result.details.hasSubscription).toBe(true);
    expect(result.details.hasEntitlements).toBe(false);
    expect(result.details.hasMatchingProject).toBe(true);
    expect(result.details.billingId).toBe('billing-789');
  });

  it('should block access when no entitlements and no matching project', async () => {
    const provider = createMockProvider({
      getSubscription: vi.fn().mockResolvedValue('sub-123'),
      getEntitlements: vi.fn().mockResolvedValue(undefined),
      getProjects: vi.fn().mockResolvedValue([
        {
          node: {
            group: 'other-group',
            status: 'ACTIVE',
            billing: {
              id: 'billing-456',
              plan: 'different-plan',
            },
          },
        },
      ] as ProjectEdge[]),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe('Airo Plus subscription required');
    expect(result.details.hasSubscription).toBe(true);
    expect(result.details.hasEntitlements).toBe(false);
    expect(result.details.hasMatchingProject).toBe(false);
  });

  it('should handle entitlements check errors gracefully', async () => {
    const provider = createMockProvider({
      getSubscription: vi.fn().mockResolvedValue('sub-123'),
      getEntitlements: vi.fn().mockRejectedValue(new Error('API Error')),
      getProjects: vi.fn().mockResolvedValue([]),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe('Airo Plus subscription required');
  });

  it('should handle projects check errors gracefully', async () => {
    const provider = createMockProvider({
      getSubscription: vi.fn().mockResolvedValue('sub-123'),
      getEntitlements: vi.fn().mockResolvedValue(undefined),
      getProjects: vi.fn().mockRejectedValue(new Error('API Error')),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe('Airo Plus subscription required');
  });

  it('should handle complete check failure', async () => {
    const provider = createMockProvider({
      getSubscription: vi.fn().mockRejectedValue(new Error('Complete failure')),
    });

    const result = await checkPaywallEligibility('app-123', provider);

    expect(result.hasAccess).toBe(false);
    expect(result.reason).toBe('Unable to verify subscription status');
  });
});
