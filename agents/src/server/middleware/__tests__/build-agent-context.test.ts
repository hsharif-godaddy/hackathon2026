import { describe, it, expect } from 'vitest';

import { buildAgentContext } from '../jwt-auth.js';

describe('buildAgentContext', function suite() {
  const fullClaims = {
    siteId: 'site-123',
    canDownload: true,
    canPublish: true,
    canPurchaseDomain: true,
    isE2S: false,
    authType: 'basic',
    useTestBudget: false,
    budgetServiceEnabled: true,
    subscriptionId: 'sub-456',
    enableAssessmentAgent: true,
    enableAssessmentOverride: false,
    product: 'PaaSNodeJS',
    modelOverride: 'claude-sonnet-4-5',
    modelSelectorEnabled: true,
    exp: 1700000000,
    iat: 1699999000,
  };

  it('maps all claims to the correct fields', function mapsAll() {
    const ctx = buildAgentContext(fullClaims);
    expect(ctx).toEqual({
      siteId: 'site-123',
      canDownload: true,
      canPublish: true,
      canPurchaseDomain: true,
      isE2S: false,
      authType: 'basic',
      useTestBudget: false,
      budgetServiceEnabled: true,
      subscriptionId: 'sub-456',
      enableAssessmentAgent: true,
      enableAssessmentOverride: false,
      product: 'PaaSNodeJS',
      modelOverride: 'claude-sonnet-4-5',
      modelSelectorEnabled: true,
      exp: 1700000000,
      iat: 1699999000,
    });
  });

  it('applies safe defaults for missing boolean claims', function defaults() {
    const ctx = buildAgentContext({ siteId: 'site-1', exp: 100, iat: 50 });
    expect(ctx.canDownload).toBe(false);
    expect(ctx.canPublish).toBe(false);
    expect(ctx.canPurchaseDomain).toBe(false);
    expect(ctx.isE2S).toBe(false);
    expect(ctx.useTestBudget).toBe(false);
    expect(ctx.budgetServiceEnabled).toBe(false);
    expect(ctx.enableAssessmentAgent).toBe(false);
    expect(ctx.enableAssessmentOverride).toBe(false);
    expect(ctx.modelSelectorEnabled).toBe(false);
  });

  it('defaults authType to basic when missing', function defaultAuth() {
    expect(buildAgentContext({}).authType).toBe('basic');
  });

  it('coerces unknown product to AiroAppBuilder', function unknownProduct() {
    expect(buildAgentContext({ product: 'SomethingElse' }).product).toBe('AiroAppBuilder');
  });

  it('preserves PaaSNodeJS product', function paasProduct() {
    expect(buildAgentContext({ product: 'PaaSNodeJS' }).product).toBe('PaaSNodeJS');
  });

  it('defaults product to AiroAppBuilder when missing', function missingProduct() {
    expect(buildAgentContext({}).product).toBe('AiroAppBuilder');
  });

  it('defaults siteId to empty string when missing', function missingSite() {
    expect(buildAgentContext({}).siteId).toBe('');
  });

  it('defaults exp and iat to 0 when missing', function missingTimestamps() {
    const ctx = buildAgentContext({});
    expect(ctx.exp).toBe(0);
    expect(ctx.iat).toBe(0);
  });

  it('leaves modelOverride undefined when not in claims', function noOverride() {
    expect(buildAgentContext({}).modelOverride).toBeUndefined();
  });

  it('passes through modelOverride string', function withOverride() {
    expect(buildAgentContext({ modelOverride: 'claude-sonnet-4-6' }).modelOverride).toBe('claude-sonnet-4-6');
  });

  it('leaves subscriptionId undefined when not in claims', function noSub() {
    expect(buildAgentContext({}).subscriptionId).toBeUndefined();
  });

  it('handles empty object without throwing', function emptyObject() {
    expect(() => buildAgentContext({})).not.toThrow();
  });
});
