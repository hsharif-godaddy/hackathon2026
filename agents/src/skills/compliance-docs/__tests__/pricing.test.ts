import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetHivemindValue, mockGetActiveAgentContext } = vi.hoisted(() => ({
  mockGetHivemindValue: vi.fn(),
  mockGetActiveAgentContext: vi.fn(),
}));

vi.mock('../../../services/switchboard.js', () => ({
  getHivemindValue: mockGetHivemindValue,
}));

vi.mock('../../../lib/agent-context-storage.js', () => ({
  getActiveAgentContext: mockGetActiveAgentContext,
}));

import { getComplianceDocPricing, getComplianceDocCreditCost } from '../pricing.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveAgentContext.mockReturnValue({ shopperId: 'shop-1' });
  mockGetHivemindValue.mockReturnValue({ cohortId: 'FREE' });
});

describe('getComplianceDocPricing', () => {
  it.each([
    ['CHARGE_SHOWN_1', { cost: 1, showCost: true }],
    ['CHARGE_SHOWN_2', { cost: 2, showCost: true }],
    ['CHARGE_HIDDEN_1', { cost: 1, showCost: false }],
    ['CHARGE_HIDDEN_2', { cost: 2, showCost: false }],
    ['FREE', { cost: 0, showCost: false }],
  ])('maps cohort %s', (cohortId, expected) => {
    mockGetHivemindValue.mockReturnValue({ cohortId });
    expect(getComplianceDocPricing()).toEqual(expected);
  });

  it('is free for an unknown or missing cohortId', () => {
    mockGetHivemindValue.mockReturnValue({ cohortId: 'SOMETHING_NEW' });
    expect(getComplianceDocPricing()).toEqual({ cost: 0, showCost: false });
    mockGetHivemindValue.mockReturnValue({});
    expect(getComplianceDocPricing()).toEqual({ cost: 0, showCost: false });
  });

  it('scopes the experiment to the active shopper', () => {
    mockGetActiveAgentContext.mockReturnValue({ shopperId: 'shop-42' });
    getComplianceDocPricing();
    expect(mockGetHivemindValue).toHaveBeenCalledWith('aab-compliance-docs', {}, 'shop-42');
  });

  it('is free when there is no active agent context', () => {
    mockGetActiveAgentContext.mockReturnValue(null);
    mockGetHivemindValue.mockReturnValue({ cohortId: 'FREE' });
    expect(getComplianceDocPricing()).toEqual({ cost: 0, showCost: false });
    expect(mockGetHivemindValue).toHaveBeenCalledWith('aab-compliance-docs', {}, undefined);
  });
});

describe('getComplianceDocCreditCost', () => {
  it('returns just the cost for the charge/gate callers', () => {
    mockGetHivemindValue.mockReturnValue({ cohortId: 'CHARGE_HIDDEN_2' });
    expect(getComplianceDocCreditCost()).toBe(2);
  });
});
