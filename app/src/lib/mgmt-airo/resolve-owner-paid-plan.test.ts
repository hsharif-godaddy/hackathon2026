import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSubscription = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  AiroMgmtClient: vi.fn().mockImplementation(function () {
    return { getSubscription: mockGetSubscription };
  }),
}));

vi.mock('@/lib/mgmt-airo/base-url', () => ({
  getMgmtAiroBaseUrl: vi.fn(() => 'https://mgmt.test'),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resolveOwnerPaidPlan } from '@/lib/mgmt-airo/resolve-owner-paid-plan';

describe('mgmt-airo/resolve-owner-paid-plan', function resolveOwnerPaidPlanTests() {
  beforeEach(function setup() {
    mockGetSubscription.mockReset();
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
  });

  it('allows when owner is on an active paid plan (starter)', async function paidStarter() {
    mockGetSubscription.mockResolvedValue({ plan: 'starter', status: 'active', productId: 'aab-v1' });
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: true });
  });

  it('allows when owner is on active professional', async function paidProfessional() {
    mockGetSubscription.mockResolvedValue({ plan: 'professional', status: 'active', productId: 'aab-v1' });
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: true });
  });

  it('blocks when owner is on free plan', async function freePlan() {
    mockGetSubscription.mockResolvedValue({ plan: 'free', status: 'active', productId: 'aab-v1' });
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: false, reason: 'free_tier' });
  });

  it('blocks when owner is on airoPlus (legacy)', async function airoPlus() {
    mockGetSubscription.mockResolvedValue({ plan: 'airoPlus', status: 'active', productId: 'aab-v1' });
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: false, reason: 'free_tier' });
  });

  it('blocks when subscription has no plan field (legacy fallback)', async function noPlan() {
    mockGetSubscription.mockResolvedValue({ status: 'active', productId: 'aab-v1' });
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: false, reason: 'free_tier' });
  });

  it('blocks when paid subscription is not active (suspended)', async function paidButSuspended() {
    mockGetSubscription.mockResolvedValue({ plan: 'starter', status: 'suspended', productId: 'aab-v1' });
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: false, reason: 'not_active' });
  });

  it('blocks when paid subscription is cancelled', async function paidButCancelled() {
    mockGetSubscription.mockResolvedValue({ plan: 'professional', status: 'cancelled', productId: 'aab-v1' });
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: false, reason: 'not_active' });
  });

  it('blocks (fail-closed) when subscription fetch throws', async function fetchError() {
    mockGetSubscription.mockRejectedValue(new Error('network error'));
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: 'sub-1', siteId: 'app-1' });
    expect(result).toEqual({ allowed: false, reason: 'fetch_failed' });
  });

  it('blocks when subscriptionId is missing', async function noSubscription() {
    const result = await resolveOwnerPaidPlan({ jwt: 'tok', subscriptionId: undefined, siteId: 'app-1' });
    expect(result).toEqual({ allowed: false, reason: 'no_subscription' });
    expect(mockGetSubscription).not.toHaveBeenCalled();
  });
});
