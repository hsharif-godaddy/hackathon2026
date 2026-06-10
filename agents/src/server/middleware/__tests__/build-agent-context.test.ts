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
    agentProfile: 'experimental',
    agentProfileSelectorEnabled: true,
    useAtlasCrawler: true,
    exp: 1700000000,
    iat: 1699999000,
  };

  it('maps all claims to the correct fields', function mapsAll() {
    const ctx = buildAgentContext(fullClaims);
    expect(ctx).toEqual({
      siteId: 'site-123',
      customerId: undefined,
      visitorId: undefined,
      trafficSessionId: undefined,
      canDownload: true,
      canPublish: true,
      canPurchaseDomain: true,
      isE2S: false,
      authType: 'basic',
      useTestBudget: false,
      budgetServiceEnabled: true,
      subscriptionId: 'sub-456',
      bmsBudgetId: undefined,
      enableAssessmentAgent: true,
      enableAssessmentOverride: false,
      assessmentClassifier: undefined,
      product: 'PaaSNodeJS',
      modelOverride: 'claude-sonnet-4-5',
      modelSelectorEnabled: true,
      agentProfile: 'experimental',
      agentProfileSelectorEnabled: true,
      useAtlasCrawler: true,
      rebuildIntakeFormEnabled: false,
      debugStatsEnabled: false,
      marketingCampaignsEnabled: false,
      market: undefined,
      asmDualWriteEnabled: false,
      logoBrandColorsEnabled: false,
      purchaseIntentClassifierEnabled: false,
      exp: 1700000000,
      iat: 1699999000,
    });
  });

  it('maps string visitorId and trafficSessionId', function trafficClaims() {
    const ctx = buildAgentContext({
      siteId: 's',
      visitorId: 'v-1',
      trafficSessionId: 'p-1',
      exp: 1,
      iat: 0,
    });
    expect(ctx.visitorId).toBe('v-1');
    expect(ctx.trafficSessionId).toBe('p-1');
  });

  it('drops non-string visitorId and trafficSessionId', function trafficNonString() {
    const ctx = buildAgentContext({
      siteId: 's',
      visitorId: 99 as unknown as string,
      trafficSessionId: { x: 1 } as unknown as string,
      exp: 1,
      iat: 0,
    });
    expect(ctx.visitorId).toBeUndefined();
    expect(ctx.trafficSessionId).toBeUndefined();
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
    expect(ctx.agentProfileSelectorEnabled).toBe(false);
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

  it('passes through useAtlasCrawler when true', function atlasTrue() {
    expect(buildAgentContext({ useAtlasCrawler: true }).useAtlasCrawler).toBe(true);
  });

  it('passes through useAtlasCrawler when false', function atlasFalse() {
    expect(buildAgentContext({ useAtlasCrawler: false }).useAtlasCrawler).toBe(false);
  });

  it('defaults useAtlasCrawler to false when missing', function atlasDefault() {
    expect(buildAgentContext({}).useAtlasCrawler).toBe(false);
  });

  // Guardrail: every Switchboard-driven claim that the BFF mints (and that
  // agent code is expected to read) must be carried through buildAgentContext.
  // The previous omission of useAtlasCrawler silently disabled the
  // appbuilder-atlas-crawler rollout because the field was dropped here.
  // If you add a new Switchboard claim, add it to this list.
  it('maps every Switchboard-driven JWT claim to AgentContext', function guardrail() {
    const requiredClaims = [
      'canDownload',
      'canPublish',
      'canPurchaseDomain',
      'useTestBudget',
      'budgetServiceEnabled',
      'enableAssessmentAgent',
      'enableAssessmentOverride',
      'assessmentClassifier',
      'modelOverride',
      'modelSelectorEnabled',
      'agentProfile',
      'agentProfileSelectorEnabled',
      'debugStatsEnabled',
      'useAtlasCrawler',
      'rebuildIntakeFormEnabled',
      'asmDualWriteEnabled',
      'purchaseIntentClassifierEnabled',
    ] as const;

    const ctx = buildAgentContext({});
    for (const claim of requiredClaims) {
      expect(ctx, `missing claim ${claim} in AgentContext`).toHaveProperty(claim);
    }
  });
});
