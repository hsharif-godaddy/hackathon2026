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
    agentStartOverrideEnabled: true,
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
      agentStartOverrideEnabled: true,
      useAtlasCrawler: true,
      rebuildIntakeFormEnabled: false,
      rebuildSourceImagesEnabled: false,
      debugStatsEnabled: false,
      marketingCampaignsEnabled: false,
      googleBusinessProfileSyncEnabled: false,
      market: undefined,
      asmDualWriteEnabled: false,
      logoBrandColorsEnabled: false,
      purchaseIntentClassifierEnabled: false,
      skillSuggestionsEnabled: false,
      enableFixSession: false,
      ssoRequired: false,
      ssoConfigured: false,
      // ownerProduct defaults to '' when the JWT mints without a SiteInfo
      // ownerProduct value (non-V2 sites or test fixtures that omit it).
      // The agent treats empty as "unknown" — same fail-open semantics as
      // ssoRequired=false.
      ownerProduct: '',
      exp: 1700000000,
      iat: 1699999000,
    });
  });

  it('maps the SSO claims when they arrive as true (positive case for Auth-at-Edge)', function ssoPositive() {
    // The `fullClaims` happy-path test above omits the SSO keys, so the
    // resulting context defaults them to false. Without this positive case,
    // a regression that hard-coded ssoRequired/ssoConfigured to false would
    // not be caught — the publish + share gates would silently no-op for
    // every ent app.
    const ctx = buildAgentContext({
      ...fullClaims,
      ssoRequired: true,
      ssoConfigured: true,
    });
    expect(ctx.ssoRequired).toBe(true);
    expect(ctx.ssoConfigured).toBe(true);
  });

  it('maps ownerProduct when present (positive case for enterprise-managed apps)', function ownerProductPositive() {
    // Same defense-in-depth logic as the SSO positive case above. A
    // regression that hard-coded ownerProduct to '' would not be caught,
    // and the publish-tool's enterprise-managed branch would silently
    // suggest "upgrade your plan" to every ent customer.
    const ctx = buildAgentContext({
      ...fullClaims,
      ownerProduct: 'aab-ent-v1',
    });
    expect(ctx.ownerProduct).toBe('aab-ent-v1');
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
      'agentStartOverrideEnabled',
      'debugStatsEnabled',
      'useAtlasCrawler',
      'rebuildIntakeFormEnabled',
      'rebuildSourceImagesEnabled',
      'marketingCampaignsEnabled',
      'googleBusinessProfileSyncEnabled',
      'asmDualWriteEnabled',
      'logoBrandColorsEnabled',
      'purchaseIntentClassifierEnabled',
      'skillSuggestionsEnabled',
    ] as const;

    const ctx = buildAgentContext({});
    for (const claim of requiredClaims) {
      expect(ctx, `missing claim ${claim} in AgentContext`).toHaveProperty(claim);
    }
  });
});
