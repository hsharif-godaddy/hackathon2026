import { describe, it, expect, vi, beforeEach } from 'vitest';

// Local class mirroring StripeService's StripeServiceError (vi.mock factory
// returns before the import resolves, so we redefine an equivalent here).
class MockStripeServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly responseText: string,
  ) {
    super(`stripe-service ${code} (HTTP ${status}): ${responseText}`);
    this.name = 'StripeServiceError';
  }
}

const mockCreateSandbox = vi.fn();
const mockGetStatus = vi.fn();

vi.mock('../../../../../services/StripeService.js', () => ({
  stripeService: {
    createSandbox: mockCreateSandbox,
    getStatus: mockGetStatus,
  },
  StripeServiceError: MockStripeServiceError,
}));

const mockLoadStripeMcpTools = vi.fn();

vi.mock('../../../../../services/mcp/stripe-mcp-client.js', () => ({
  loadStripeMcpTools: mockLoadStripeMcpTools,
}));

const mockFsExistsSync = vi.fn();

vi.mock('node:fs', () => ({
  default: { existsSync: mockFsExistsSync },
  existsSync: mockFsExistsSync,
}));

const mockRegisterDynamicTools = vi.fn();

vi.mock('../../../../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {
    registerDynamicTools: mockRegisterDynamicTools,
  },
}));

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../../../../logging/index.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

const { setupTool, statusTool } = await import('../provisioning-tools.js');
const { hooks } = await import('../index.js');

const APP = { metadata: { appId: 'app-1', customerId: 'cust-1' } };

describe('stripe skill tools', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so a persistent mockResolvedValue set in
    // one test can't leak its implementation into a later test that forgot to
    // stub the loader — which would otherwise hit real backoff timers.
    vi.resetAllMocks();
    // Default: MCP key not yet propagated. Tests that need MCP tools loaded
    // immediately override this in their own setup.
    mockLoadStripeMcpTools.mockResolvedValue({});
    // Default: templates not yet installed — nextStep should be included.
    mockFsExistsSync.mockReturnValue(false);
  });

  describe('setupTool (platform-managed)', () => {
    it('forwards input to createSandbox and returns the sandbox shape (no MCP fields)', async () => {
      mockCreateSandbox.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
      });

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(mockCreateSandbox).toHaveBeenCalledWith({ appId: 'app-1', customerId: 'cust-1', country: 'US' });
      expect(result).toEqual({
        success: true,
        mode: 'managed',
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
        nextStep: expect.stringContaining('skill({action: "install"'),
      });
      // MCP catalog tools are disabled — loader and dynamic registration must not fire.
      expect(mockLoadStripeMcpTools).not.toHaveBeenCalled();
      expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
    });

    it('returns a graceful-degrade shape on STRIPE_CREATE_FAILED and logs at WARN (not ERROR)', async () => {
      mockCreateSandbox.mockRejectedValueOnce(
        new MockStripeServiceError(502, 'STRIPE_CREATE_FAILED', 'preview not enabled'),
      );

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(result).toMatchObject({
        stripeProvisioningUnavailable: true,
        retryAfterSeconds: 30,
        upstreamCode: 'STRIPE_CREATE_FAILED',
        upstreamStatus: 502,
      });
      expect((result as { message: string }).message).toContain('this Airo Builder deployment');
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'skill.stripe.setup.provisioning_unavailable',
        expect.objectContaining({ appId: 'app-1', upstreamStatus: 502 }),
      );
      expect(mockLoggerError).not.toHaveBeenCalledWith(
        expect.stringMatching(/^skill\.stripe\.setup/),
        expect.anything(),
      );
    });

    it('logs at ERROR with upstream code/status on a non-degrade StripeServiceError', async () => {
      mockCreateSandbox.mockRejectedValueOnce(
        new MockStripeServiceError(400, 'INVALID_JSON', 'request body is not valid JSON'),
      );

      await expect(setupTool.execute({ country: 'US' }, APP)).rejects.toBeInstanceOf(
        MockStripeServiceError,
      );
      expect(mockLoggerError).toHaveBeenCalledWith(
        'skill.stripe.setup.error',
        expect.objectContaining({ appId: 'app-1', upstreamCode: 'INVALID_JSON', upstreamStatus: 400 }),
      );
    });

    it('propagates generic errors so the agent loop sees them', async () => {
      const boom = new Error('boom');
      mockCreateSandbox.mockRejectedValueOnce(boom);
      await expect(setupTool.execute({ country: 'US' }, APP)).rejects.toBe(boom);
    });

    it('returns a missing-appId error without calling stripeService', async () => {
      const result = await setupTool.execute({}, undefined);
      expect(result).toEqual({ error: 'App ID is required. Pass context.metadata.appId.' });
      expect(mockCreateSandbox).not.toHaveBeenCalled();
    });

    it('omits nextStep when templates are already installed (idempotent re-call)', async () => {
      mockFsExistsSync.mockReturnValue(true); // templates present
      mockCreateSandbox.mockResolvedValueOnce({ sandboxId: 's', accountId: 'a', claimUrl: 'u' });

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(result).not.toHaveProperty('nextStep');
      expect(result).toMatchObject({ success: true, mode: 'managed' });
    });

    it('resolves template path via CUSTOMER_APP_DIR in production', async () => {
      const original = process.env.CUSTOMER_APP_DIR;
      process.env.CUSTOMER_APP_DIR = '/app';
      mockFsExistsSync.mockReturnValue(true);
      mockCreateSandbox.mockResolvedValueOnce({ sandboxId: 's', accountId: 'a', claimUrl: 'u' });

      const result = await setupTool.execute({ country: 'US' }, APP);

      // CUSTOMER_APP_DIR is set → existsSync was called with the production path
      expect(mockFsExistsSync).toHaveBeenCalledWith(
        expect.stringContaining('/app/src/scripts/stripe-register-products.ts'),
      );
      expect(result).not.toHaveProperty('nextStep');

      process.env.CUSTOMER_APP_DIR = original;
    });

    it('never attempts MCP loading from setup (MCP catalog tools are disabled)', async () => {
      mockCreateSandbox.mockResolvedValueOnce({ sandboxId: 's', accountId: 'a', claimUrl: 'u' });
      // Even if the loader would succeed, the disabled flag must short-circuit it.
      mockLoadStripeMcpTools.mockResolvedValue({
        products_create: { description: 'p', execute: vi.fn() },
      });

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(mockLoadStripeMcpTools).not.toHaveBeenCalled();
      expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('mcpToolsReadyNextTurn');
      expect(result).toMatchObject({ success: true, mode: 'managed' });
    });
  });

  describe('statusTool', () => {
    it('returns hasStripe:true with the sandbox state at provisioned', async () => {
      mockGetStatus.mockResolvedValueOnce({ sandboxId: 'cbsbx_fake_X', claimStatus: 'provisioned' });
      const result = await statusTool.execute({}, APP);
      expect(mockGetStatus).toHaveBeenCalledWith('app-1');
      expect(result).toEqual({
        success: true,
        hasStripe: true,
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'provisioned',
        realPaymentsEnabled: false,
      });
    });

    it('returns hasStripe:false when no sandbox exists', async () => {
      mockGetStatus.mockResolvedValueOnce(null);
      const result = await statusTool.execute({}, APP);
      expect(result).toEqual({ success: true, hasStripe: false });
    });

    it('includes liveAccountId and realPaymentsEnabled:true at live', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'live',
        liveAccountId: 'acct_live_real',
      });
      const result = await statusTool.execute({}, APP);
      expect(result).toEqual({
        success: true,
        hasStripe: true,
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'live',
        realPaymentsEnabled: true,
        liveAccountId: 'acct_live_real',
      });
    });

    it('returns realPaymentsEnabled:false at claimed', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'claimed',
      });
      const result = await statusTool.execute({}, APP);
      expect(result).toEqual({
        success: true,
        hasStripe: true,
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'claimed',
        realPaymentsEnabled: false,
      });
    });

    it('surfaces expiresAt and claimUrlExpiresAt only at provisioned', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'provisioned',
        expiresAt: '2026-08-22T00:00:00Z',
        claimUrlExpiresAt: '2026-06-30T00:00:00Z',
      });
      const result = await statusTool.execute({}, APP);
      expect(result).toEqual({
        success: true,
        hasStripe: true,
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'provisioned',
        realPaymentsEnabled: false,
        expiresAt: '2026-08-22T00:00:00Z',
        claimUrlExpiresAt: '2026-06-30T00:00:00Z',
      });
    });

    it('suppresses expiresAt and claimUrlExpiresAt at claimed (Stripe nulls them on claim)', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'claimed',
        expiresAt: '2026-08-22T00:00:00Z',
        claimUrlExpiresAt: '2026-06-30T00:00:00Z',
      });
      const result = await statusTool.execute({}, APP);
      expect(result).not.toHaveProperty('expiresAt');
      expect(result).not.toHaveProperty('claimUrlExpiresAt');
    });

    it('suppresses expiresAt and claimUrlExpiresAt at live (sandbox in terminal state)', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'live',
        liveAccountId: 'acct_live_real',
        expiresAt: '2026-08-22T00:00:00Z',
        claimUrlExpiresAt: '2026-06-30T00:00:00Z',
      });
      const result = await statusTool.execute({}, APP);
      expect(result).not.toHaveProperty('expiresAt');
      expect(result).not.toHaveProperty('claimUrlExpiresAt');
    });

    it('returns a missing-appId error without calling stripeService', async () => {
      const result = await statusTool.execute({}, undefined);
      expect(result).toEqual({ error: 'App ID is required. Pass context.metadata.appId.' });
      expect(mockGetStatus).not.toHaveBeenCalled();
    });

    it('logs ERROR and returns degrade shape on unexpected STRIPE_CREATE_FAILED (contract violation)', async () => {
      mockGetStatus.mockRejectedValueOnce(
        new MockStripeServiceError(502, 'STRIPE_CREATE_FAILED', 'unexpected on status route'),
      );
      const result = await statusTool.execute({}, APP);
      expect(result).toMatchObject({ stripeProvisioningUnavailable: true });
      // Pin the level: STRIPE_CREATE_FAILED on /v1/status is unexpected (oncall-worthy), not recoverable WARN.
      expect(mockLoggerError).toHaveBeenCalledWith(
        'skill.stripe.status.provisioning_unavailable_unexpected',
        expect.objectContaining({ appId: 'app-1' }),
      );
      expect(mockLoggerWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('provisioning_unavailable'),
        expect.anything(),
      );
    });

    it('propagates generic errors so the agent loop sees them', async () => {
      const boom = new Error('status boom');
      mockGetStatus.mockRejectedValueOnce(boom);
      await expect(statusTool.execute({}, APP)).rejects.toBe(boom);
    });
  });

  describe('setupTool — execute', () => {
    it('returns needsInputs when country omitted', async () => {
      const result = await setupTool.execute({}, APP);

      expect(result).toMatchObject({ autoProvisionedFlow: true, needsInputs: true });
      expect(mockCreateSandbox).not.toHaveBeenCalled();
    });

    it('provisions when country is provided', async () => {
      vi.useFakeTimers();
      try {
        mockCreateSandbox.mockResolvedValueOnce({ sandboxId: 's', accountId: 'a', claimUrl: 'u' });
        mockLoadStripeMcpTools.mockResolvedValue({});

        const pending = setupTool.execute({ country: 'US' }, APP);
        await vi.runAllTimersAsync();
        const result = await pending;

        expect(result).toMatchObject({ success: true, mode: 'managed', sandboxId: 's' });
        expect(mockCreateSandbox).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns mode:legacy when stripe-service short-circuits with legacy:true', async () => {
      mockCreateSandbox.mockResolvedValueOnce({
        sandboxId: '',
        accountId: '',
        claimUrl: '',
        legacy: true,
      });

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(result).toMatchObject({ success: true, mode: 'legacy' });
      expect((result as { message: string }).message).toContain('already has a Stripe integration');
      expect(mockLoadStripeMcpTools).not.toHaveBeenCalled();
    });
  });

  describe('setupTool.computeState', () => {
    it('is defined on the tool', function defined() {
      expect(setupTool.computeState).toBeDefined();
    });

    it('returns { provisioned: true } on a successful output', function successState() {
      const state = setupTool.computeState!({}, { success: true, sandboxId: 's' });
      expect(state).toEqual({ provisioned: true });
    });

    it('returns null when output.success is false', function failState() {
      const state = setupTool.computeState!({}, { success: false });
      expect(state).toBeNull();
    });

    it('returns null when output is a degrade shape (no success field)', function degradeState() {
      const state = setupTool.computeState!({}, { stripeProvisioningUnavailable: true });
      expect(state).toBeNull();
    });

    it('returns null when output is undefined', function undefinedState() {
      const state = setupTool.computeState!({}, undefined);
      expect(state).toBeNull();
    });
  });

  describe('statusTool.computeState', () => {
    it('is defined on the tool', function defined() {
      expect(statusTool.computeState).toBeDefined();
    });

    it('returns { provisioned: true, claimStatus } when hasStripe is true', function withStripe() {
      const state = statusTool.computeState!({}, { success: true, hasStripe: true, sandboxId: 's', claimStatus: 'provisioned' });
      expect(state).toEqual({ provisioned: true, claimStatus: 'provisioned' });
    });

    it('reflects the current claimStatus (e.g. live)', function liveStatus() {
      const state = statusTool.computeState!({}, { success: true, hasStripe: true, sandboxId: 's', claimStatus: 'live' });
      expect(state).toEqual({ provisioned: true, claimStatus: 'live' });
    });

    it('returns null when hasStripe is false', function noStripe() {
      const state = statusTool.computeState!({}, { success: true, hasStripe: false });
      expect(state).toBeNull();
    });

    it('returns null when output.success is false', function failState() {
      const state = statusTool.computeState!({}, { success: false });
      expect(state).toBeNull();
    });

    it('returns null when output is undefined', function undefinedState() {
      const state = statusTool.computeState!({}, undefined);
      expect(state).toBeNull();
    });
  });

  describe('hooks.onLoad (no-op while MCP_TOOLS_ENABLED=false)', () => {
    it('does not attempt to load or register MCP tools', async () => {
      // Even if the loader would resolve to a non-empty map, hooks.onLoad must
      // short-circuit on the disabled flag and skip both calls.
      mockLoadStripeMcpTools.mockResolvedValue({
        products_create: { description: 'p', execute: vi.fn() },
      });

      await hooks.onLoad?.({ skillName: 'payment/stripe', appId: 'app-1' });

      expect(mockLoadStripeMcpTools).not.toHaveBeenCalled();
      expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
    });
  });
});
