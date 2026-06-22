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
const mockMarkLegacy = vi.fn();

vi.mock('../../../../../services/StripeService.js', () => ({
  stripeService: {
    createSandbox: mockCreateSandbox,
    getStatus: mockGetStatus,
    markLegacy: mockMarkLegacy,
  },
  StripeServiceError: MockStripeServiceError,
}));

const mockLoadStripeMcpTools = vi.fn();

vi.mock('../../../../../services/mcp/stripe-mcp-client.js', () => ({
  loadStripeMcpTools: mockLoadStripeMcpTools,
}));

const mockRegisterDynamicTools = vi.fn();

vi.mock('../../../../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {
    registerDynamicTools: mockRegisterDynamicTools,
  },
}));

const mockProfileFlag = vi.fn();

vi.mock('../../../../../profiles/profile-accessor.js', () => ({
  profileFlag: mockProfileFlag,
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
    // Default: platform flag ON, MCP key not yet propagated.
    // Tests that exercise the flag-OFF path override mockProfileFlag explicitly.
    mockProfileFlag.mockReturnValue(true);
    mockLoadStripeMcpTools.mockResolvedValue({});
  });

  describe('setupTool (platform-managed)', () => {
    it('forwards input to createSandbox and returns the sandbox shape + next-turn flag', async () => {
      mockCreateSandbox.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
      });
      // MCP tools already present → registered on the first (0ms) attempt.
      mockLoadStripeMcpTools.mockResolvedValue({
        products_create: { description: 'create a product', execute: vi.fn() },
      });

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(mockCreateSandbox).toHaveBeenCalledWith({ appId: 'app-1', customerId: 'cust-1', country: 'US' });
      expect(result).toEqual({
        success: true,
        mode: 'managed',
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
        mcpToolsReadyNextTurn: true,
      });
      expect(mockRegisterDynamicTools).toHaveBeenCalledWith('payment/stripe', {
        products_create: expect.anything(),
      });
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

    it('registers MCP tools on a later attempt when the key propagates late (backoff)', async () => {
      vi.useFakeTimers();
      try {
        mockCreateSandbox.mockResolvedValueOnce({ sandboxId: 's', accountId: 'a', claimUrl: 'u' });
        const fakeTool = { description: 'create a product', execute: vi.fn() };
        mockLoadStripeMcpTools.mockResolvedValueOnce({}); // attempt 0: not propagated
        mockLoadStripeMcpTools.mockResolvedValueOnce({ products_create: fakeTool }); // attempt 1

        const pending = setupTool.execute({ country: 'US' }, APP);
        await vi.advanceTimersByTimeAsync(0);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(1); // backoff: no 2nd load yet
        await vi.advanceTimersByTimeAsync(1);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(2);

        const result = await pending;
        expect(mockRegisterDynamicTools).toHaveBeenCalledWith('payment/stripe', { products_create: fakeTool });
        expect(mockLoggerInfo).toHaveBeenCalledWith(
          'skill.stripe.setup.mcp_tools_registered',
          expect.objectContaining({ appId: 'app-1', attempt: 1 }),
        );
        expect(result).toMatchObject({ success: true, mcpToolsReadyNextTurn: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns mcpToolsReadyNextTurn:false with a key_not_propagated reason when the key never lands', async () => {
      vi.useFakeTimers();
      try {
        mockCreateSandbox.mockResolvedValueOnce({ sandboxId: 's', accountId: 'a', claimUrl: 'u' });
        mockLoadStripeMcpTools.mockResolvedValue({});

        const pending = setupTool.execute({ country: 'US' }, APP);
        await vi.runAllTimersAsync();
        const result = await pending;

        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(3);
        expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
        expect(mockLoggerInfo).toHaveBeenCalledWith(
          'skill.stripe.setup.mcp_tools_not_ready',
          expect.objectContaining({ appId: 'app-1', reason: 'key_not_propagated' }),
        );
        expect(result).toMatchObject({ success: true, mcpToolsReadyNextTurn: false });
      } finally {
        vi.useRealTimers();
      }
    });

    it('bails early when the remaining setup-timeout budget is exhausted', async () => {
      vi.useFakeTimers();
      try {
        mockCreateSandbox.mockResolvedValueOnce({ sandboxId: 's', accountId: 'a', claimUrl: 'u' });
        mockLoadStripeMcpTools.mockResolvedValue({});

        // setupStart records Date.now() at the beginning of execute. Advance the
        // clock by 29s first so the deadline (start + 30000 - 2000 = start + 28000)
        // is already past when reloadMcpToolsAfterSetup runs.
        const pending = setupTool.execute({ country: 'US' }, APP);
        vi.advanceTimersByTime(29000);
        await vi.runAllTimersAsync();
        const result = await pending;

        // First attempt (0ms delay): Date.now() + 0 > deadline → bail immediately.
        expect(mockLoadStripeMcpTools).not.toHaveBeenCalled();
        expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
        expect(mockLoggerInfo).toHaveBeenCalledWith(
          'skill.stripe.setup.mcp_reload_budget_exhausted',
          expect.objectContaining({ appId: 'app-1', attempt: 0 }),
        );
        expect(result).toMatchObject({ success: true, mcpToolsReadyNextTurn: false });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('statusTool', () => {
    it('returns hasStripe:true with the sandbox state', async () => {
      mockGetStatus.mockResolvedValueOnce({ sandboxId: 'cbsbx_fake_X', claimStatus: 'provisioned' });
      const result = await statusTool.execute({}, APP);
      expect(mockGetStatus).toHaveBeenCalledWith('app-1');
      expect(result).toEqual({ success: true, hasStripe: true, sandboxId: 'cbsbx_fake_X', claimStatus: 'provisioned' });
    });

    it('returns hasStripe:false when no sandbox exists', async () => {
      mockGetStatus.mockResolvedValueOnce(null);
      const result = await statusTool.execute({}, APP);
      expect(result).toEqual({ success: true, hasStripe: false });
    });

    it('includes liveAccountId in the response when present', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'live',
        liveAccountId: 'acct_live_real',
      });
      const result = await statusTool.execute({}, APP);
      expect(result).toMatchObject({ success: true, hasStripe: true, liveAccountId: 'acct_live_real' });
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

  describe('setupTool — flag-gated execute', () => {
    it('returns autoProvisioningUnavailable (no inputs needed) when the flag is OFF', async () => {
      mockProfileFlag.mockReturnValue(false);
      mockMarkLegacy.mockResolvedValueOnce(undefined);

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(result).toMatchObject({ autoProvisioningUnavailable: true });
      expect((result as { message: string }).message).toContain('Manual key flow');
      expect(mockCreateSandbox).not.toHaveBeenCalled();
    });

    it('self-marks the app as legacy when the flag is OFF', async () => {
      mockProfileFlag.mockReturnValue(false);
      mockMarkLegacy.mockResolvedValueOnce(undefined);

      await setupTool.execute({ country: 'US' }, APP);

      expect(mockMarkLegacy).toHaveBeenCalledTimes(1);
      expect(mockMarkLegacy).toHaveBeenCalledWith('app-1');
    });

    it('still returns autoProvisioningUnavailable when markLegacy fails (best-effort)', async () => {
      mockProfileFlag.mockReturnValue(false);
      mockMarkLegacy.mockRejectedValueOnce(new Error('stripe-service down'));

      const result = await setupTool.execute({ country: 'US' }, APP);

      expect(result).toMatchObject({ autoProvisioningUnavailable: true });
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'skill.stripe.setup.mark_legacy_failed',
        expect.objectContaining({ appId: 'app-1', error: 'stripe-service down' }),
      );
    });

    it('returns needsInputs when flag is ON but country omitted', async () => {
      mockProfileFlag.mockReturnValue(true);

      const result = await setupTool.execute({}, APP);

      expect(result).toMatchObject({ autoProvisionedFlow: true, needsInputs: true });
      expect(mockCreateSandbox).not.toHaveBeenCalled();
    });

    it('provisions when flag is ON and country is provided', async () => {
      vi.useFakeTimers();
      try {
        mockProfileFlag.mockReturnValue(true);
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
      mockProfileFlag.mockReturnValue(true);
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

  describe('hooks.onLoad (MCP catalog tools only)', () => {
    it('registers MCP tools when available', async () => {
      mockLoadStripeMcpTools.mockResolvedValue({ products_create: { description: 'p', execute: vi.fn() } });

      await hooks.onLoad?.({ skillName: 'payment/stripe', appId: 'app-1' });

      expect(mockLoadStripeMcpTools).toHaveBeenCalledWith('app-1');
      expect(mockRegisterDynamicTools).toHaveBeenCalledWith('payment/stripe', expect.objectContaining({ products_create: expect.anything() }));
    });

    it('skips registerDynamicTools when no MCP tools yet (pre-provisioning)', async () => {
      mockLoadStripeMcpTools.mockResolvedValue({});

      await hooks.onLoad?.({ skillName: 'payment/stripe', appId: 'app-1' });

      expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
    });

    it('logs warn and skips when MCP load throws (non-fatal)', async () => {
      mockLoadStripeMcpTools.mockRejectedValueOnce(new Error('mcp unreachable'));

      await expect(hooks.onLoad?.({ skillName: 'payment/stripe', appId: 'app-1' })).resolves.toBeUndefined();

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'skill.stripe.onload.mcp_load_failed',
        expect.objectContaining({ appId: 'app-1' }),
      );
      expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
    });
  });
});
