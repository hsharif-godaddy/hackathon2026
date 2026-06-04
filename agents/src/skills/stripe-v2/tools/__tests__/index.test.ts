import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Local class shape that mirrors StripeService's StripeServiceError. We
// can't easily reuse the real class via vi.mock (the mock factory returns
// before the import resolves), so we define an equivalent here with the
// same constructor signature and field names. Tools detect via
// `err instanceof StripeServiceError`, which works against THIS class
// because `vi.mock` redirects the import to the value below.
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

vi.mock('../../../../services/StripeService.js', () => ({
  stripeService: {
    createSandbox: mockCreateSandbox,
    getStatus: mockGetStatus,
  },
  StripeServiceError: MockStripeServiceError,
}));

const mockLoadStripeMcpTools = vi.fn();
const mockResetStripeMcpClientCache = vi.fn();

vi.mock('../../../../services/mcp/stripe-mcp-client.js', () => ({
  loadStripeMcpTools: mockLoadStripeMcpTools,
  _resetStripeMcpClientCache: mockResetStripeMcpClientCache,
}));

const mockRegisterDynamicTools = vi.fn();

vi.mock('../../../../tools/skill-tool-manager.js', () => ({
  skillToolManager: {
    registerDynamicTools: mockRegisterDynamicTools,
  },
}));

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

const { setupTool, statusTool, hooks } = await import('../index.js');

describe('stripe-v2 skill tools', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so a persistent mockResolvedValue set in
    // one test can't leak its implementation into a later test that forgot to
    // stub the MCP loader — which would otherwise hit real backoff timers.
    vi.resetAllMocks();
  });

  describe('setupTool', () => {
    it('forwards input to stripeService.createSandbox and returns the typed sandbox shape', async () => {
      mockCreateSandbox.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
      });
      // Key already propagated → MCP tools load on the first (zero-delay)
      // attempt, so this test doesn't hit the backoff timers.
      mockLoadStripeMcpTools.mockResolvedValue({
        products_create: { description: 'create a product', execute: vi.fn() },
      });

      const result = await setupTool.execute(
        { email: 'a@b.c', country: 'US' },
        { metadata: { appId: 'app-1' } },
      );

      expect(mockCreateSandbox).toHaveBeenCalledWith({
        appId: 'app-1',
        email: 'a@b.c',
        country: 'US',
      });
      expect(result).toEqual({
        success: true,
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
        mcpToolsReadyNextTurn: true,
      });
    });

    it('loads + registers the Stripe MCP tools after provisioning (available next turn)', async () => {
      const fakeTool = { description: 'create a product', execute: vi.fn() };
      mockCreateSandbox.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
      });
      mockLoadStripeMcpTools.mockResolvedValueOnce({ products_create: fakeTool });

      const result = await setupTool.execute(
        { email: 'a@b.c', country: 'US' },
        { metadata: { appId: 'app-1' } },
      );

      // The key has propagated, so the first attempt picks the tools up and
      // registers them under the skill — callable on the agent's next turn
      // without a new conversation.
      expect(mockLoadStripeMcpTools).toHaveBeenCalledWith('app-1');
      expect(mockRegisterDynamicTools).toHaveBeenCalledWith('stripe-v2', {
        products_create: fakeTool,
      });
      expect(result).toMatchObject({ success: true, mcpToolsReadyNextTurn: true });
    });

    it('retries with backoff and registers on a later attempt when the key propagates late', async () => {
      vi.useFakeTimers();
      try {
        const fakeTool = { description: 'create a product', execute: vi.fn() };
        mockCreateSandbox.mockResolvedValueOnce({
          sandboxId: 'cbsbx_fake_X',
          accountId: 'acct_fake_X',
          claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
        });
        // Empty on attempt 0 (key not propagated yet), tools on attempt 1.
        mockLoadStripeMcpTools.mockResolvedValueOnce({});
        mockLoadStripeMcpTools.mockResolvedValueOnce({ products_create: fakeTool });

        const pending = setupTool.execute(
          { email: 'a@b.c', country: 'US' },
          { metadata: { appId: 'app-1' } },
        );

        // Attempt 0 (0ms) runs immediately; the 2nd attempt must wait the 2000ms
        // backoff — proving the delays are real, not a no-op loop.
        await vi.advanceTimersByTimeAsync(0);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(2);

        const result = await pending;
        // Registered on attempt 1; the loop stops early (no 3rd attempt).
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(2);
        expect(mockRegisterDynamicTools).toHaveBeenCalledWith('stripe-v2', {
          products_create: fakeTool,
        });
        expect(mockLoggerInfo).toHaveBeenCalledWith(
          'skill.stripe_v2.setup.mcp_tools_registered',
          expect.objectContaining({ appId: 'app-1', attempt: 1 }),
        );
        expect(result).toMatchObject({ success: true, mcpToolsReadyNextTurn: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('swallows a loadStripeMcpTools rejection and continues to the next attempt', async () => {
      vi.useFakeTimers();
      try {
        const fakeTool = { description: 'create a product', execute: vi.fn() };
        mockCreateSandbox.mockResolvedValueOnce({
          sandboxId: 'cbsbx_fake_X',
          accountId: 'acct_fake_X',
          claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
        });
        // Attempt 0 throws (guards the unexpected-throw path), attempt 1 resolves.
        mockLoadStripeMcpTools.mockRejectedValueOnce(new Error('mcp connect blip'));
        mockLoadStripeMcpTools.mockResolvedValueOnce({ products_create: fakeTool });

        const pending = setupTool.execute(
          { email: 'a@b.c', country: 'US' },
          { metadata: { appId: 'app-1' } },
        );
        await vi.runAllTimersAsync();
        const result = await pending;

        // The throw was swallowed (WARN), the loop continued, and attempt 1 won.
        expect(mockLoggerWarn).toHaveBeenCalledWith(
          'skill.stripe_v2.setup.mcp_reload_failed',
          expect.objectContaining({ appId: 'app-1', attempt: 0 }),
        );
        expect(mockRegisterDynamicTools).toHaveBeenCalledWith('stripe-v2', {
          products_create: fakeTool,
        });
        expect(result).toMatchObject({ success: true, mcpToolsReadyNextTurn: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns mcpToolsReadyNextTurn:false (and never throws) when the key never propagates, with backoff between attempts', async () => {
      vi.useFakeTimers();
      try {
        mockCreateSandbox.mockResolvedValueOnce({
          sandboxId: 'cbsbx_fake_X',
          accountId: 'acct_fake_X',
          claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
        });
        // Key absent on every attempt → loadStripeMcpTools returns {}.
        mockLoadStripeMcpTools.mockResolvedValue({});

        const pending = setupTool.execute(
          { email: 'a@b.c', country: 'US' },
          { metadata: { appId: 'app-1' } },
        );

        // Pin the backoff: no 2nd load until the 2000ms delay elapses.
        await vi.advanceTimersByTimeAsync(0);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1999);
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(1);
        await vi.runAllTimersAsync();
        const result = await pending;

        // All retry attempts exhausted, no tools registered, setup still succeeds.
        expect(mockLoadStripeMcpTools).toHaveBeenCalledTimes(3);
        expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
        // Terminal line is self-diagnosing: benign race vs swallowed error.
        expect(mockLoggerInfo).toHaveBeenCalledWith(
          'skill.stripe_v2.setup.mcp_tools_not_ready',
          expect.objectContaining({ appId: 'app-1', reason: 'key_not_propagated' }),
        );
        expect(result).toMatchObject({ success: true, mcpToolsReadyNextTurn: false });
      } finally {
        vi.useRealTimers();
      }
    });

    it('skips the reload (and still returns claimUrl) when slow provisioning ate the timeout budget', async () => {
      vi.useFakeTimers();
      try {
        // Provisioning takes 29s — past the reload deadline (30s timeout − 2s
        // margin = 28s). The reload must bail before its first attempt so the
        // setup timeout race can't fire and discard the already-created sandbox.
        mockCreateSandbox.mockImplementationOnce(
          () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    sandboxId: 'cbsbx_fake_X',
                    accountId: 'acct_fake_X',
                    claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
                  }),
                29000,
              ),
            ),
        );

        const pending = setupTool.execute(
          { email: 'a@b.c', country: 'US' },
          { metadata: { appId: 'app-1' } },
        );
        await vi.advanceTimersByTimeAsync(29000);
        const result = await pending;

        // No reload attempt was made, but the claimUrl is preserved.
        expect(mockLoadStripeMcpTools).not.toHaveBeenCalled();
        expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
        expect(mockLoggerInfo).toHaveBeenCalledWith(
          'skill.stripe_v2.setup.mcp_reload_budget_exhausted',
          expect.objectContaining({ appId: 'app-1', attempt: 0 }),
        );
        expect(result).toMatchObject({
          success: true,
          claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
          mcpToolsReadyNextTurn: false,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns a graceful-degrade shape on STRIPE_CREATE_FAILED and logs at WARN (not ERROR)', async () => {
      mockCreateSandbox.mockRejectedValueOnce(
        new MockStripeServiceError(502, 'STRIPE_CREATE_FAILED', 'preview not enabled'),
      );

      const result = await setupTool.execute(
        { email: 'a@b.c', country: 'US' },
        { metadata: { appId: 'app-1' } },
      );

      expect(result).toMatchObject({
        stripeProvisioningUnavailable: true,
        retryAfterSeconds: 30,
        upstreamCode: 'STRIPE_CREATE_FAILED',
        upstreamStatus: 502,
      });
      expect((result as { message: string }).message).toContain('your project');

      // Pin the level: degrade is expected/recoverable so it logs at WARN.
      // A regression that bumps this to ERROR would page oncall on every
      // pre-preview-enabled call. Pin the event name too — Loki dashboards
      // and alerts grep on this string.
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'skill.stripe_v2.setup.provisioning_unavailable',
        expect.objectContaining({ appId: 'app-1', upstreamStatus: 502 }),
      );
      expect(mockLoggerError).not.toHaveBeenCalledWith(
        expect.stringMatching(/^skill\.stripe_v2\.setup/),
        expect.anything(),
      );
    });

    it('logs at ERROR with upstream code/status when a non-degrade StripeServiceError throws', async () => {
      // Pin the inverse: real upstream errors page oncall (logger.error) and
      // include the upstream code/status fields so the log line is
      // self-contained — an oncall reading just this line knows the failure
      // was a stripe-service contract problem, not a tool bug.
      mockCreateSandbox.mockRejectedValueOnce(
        new MockStripeServiceError(400, 'INVALID_JSON', 'request body is not valid JSON'),
      );

      await expect(
        setupTool.execute({ email: 'a@b.c', country: 'US' }, { metadata: { appId: 'app-1' } }),
      ).rejects.toBeInstanceOf(MockStripeServiceError);

      expect(mockLoggerError).toHaveBeenCalledWith(
        'skill.stripe_v2.setup.error',
        expect.objectContaining({
          appId: 'app-1',
          upstreamCode: 'INVALID_JSON',
          upstreamStatus: 400,
        }),
      );
    });

    it('propagates non-degrade errors so the agent loop sees them', async () => {
      const boom = new Error('boom');
      mockCreateSandbox.mockRejectedValueOnce(boom);

      await expect(
        setupTool.execute({ email: 'a@b.c', country: 'US' }, { metadata: { appId: 'app-1' } }),
      ).rejects.toBe(boom);
    });

    it('propagates StripeServiceError with non-STRIPE_CREATE_FAILED codes', async () => {
      // 400 INVALID_JSON is a real, propagatable error — the agent should
      // see it (it indicates a bug in the tool, not a transient backend
      // problem) rather than the graceful-degrade message.
      const err = new MockStripeServiceError(400, 'INVALID_JSON', 'request body is not valid JSON');
      mockCreateSandbox.mockRejectedValueOnce(err);

      await expect(
        setupTool.execute({ email: 'a@b.c', country: 'US' }, { metadata: { appId: 'app-1' } }),
      ).rejects.toBe(err);
    });

    it('returns a missing-appId error without calling stripeService', async () => {
      const result = await setupTool.execute({ email: 'a@b.c', country: 'US' }, undefined);
      expect(result).toEqual({ error: 'App ID is required. Pass context.metadata.appId.' });
      expect(mockCreateSandbox).not.toHaveBeenCalled();
    });
  });

  describe('statusTool', () => {
    it('returns hasStripe:true with the sandbox state when stripeService finds a sandbox', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'provisioned',
      });

      const result = await statusTool.execute({}, { metadata: { appId: 'app-1' } });

      expect(mockGetStatus).toHaveBeenCalledWith('app-1');
      expect(result).toEqual({
        success: true,
        hasStripe: true,
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'provisioned',
      });
    });

    it('passes through liveAccountId when present', async () => {
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'live',
        liveAccountId: 'acct_live_real',
      });

      const result = await statusTool.execute({}, { metadata: { appId: 'app-1' } });
      expect(result).toMatchObject({
        success: true,
        hasStripe: true,
        liveAccountId: 'acct_live_real',
      });
    });

    it('returns hasStripe:false on null (no sandbox yet) without throwing', async () => {
      mockGetStatus.mockResolvedValueOnce(null);

      const result = await statusTool.execute({}, { metadata: { appId: 'app-without-sandbox' } });
      expect(result).toEqual({ success: true, hasStripe: false });
    });

    it('returns a missing-appId error without calling stripeService', async () => {
      const result = await statusTool.execute({}, undefined);
      expect(result).toEqual({ error: 'App ID is required. Pass context.metadata.appId.' });
      expect(mockGetStatus).not.toHaveBeenCalled();
    });

    it('propagates non-degrade errors', async () => {
      const boom = new Error('ddb unreachable');
      mockGetStatus.mockRejectedValueOnce(boom);

      await expect(statusTool.execute({}, { metadata: { appId: 'app-1' } })).rejects.toBe(boom);
    });

    it('returns graceful-degrade if stripeService surfaces STRIPE_CREATE_FAILED on status, but logs at ERROR', async () => {
      // /v1/status doesn't call Stripe so STRIPE_CREATE_FAILED here means
      // stripe-service's contract grew an unexpected passthrough — log at
      // ERROR (not WARN) so it pages oncall instead of silently degrading.
      // The graceful-degrade response shape stays consistent for the agent.
      mockGetStatus.mockRejectedValueOnce(
        new MockStripeServiceError(502, 'STRIPE_CREATE_FAILED', 'unavailable'),
      );

      const result = await statusTool.execute({}, { metadata: { appId: 'app-1' } });
      expect(result).toMatchObject({
        stripeProvisioningUnavailable: true,
        upstreamCode: 'STRIPE_CREATE_FAILED',
      });
      expect(mockLoggerError).toHaveBeenCalledWith(
        'skill.stripe_v2.status.provisioning_unavailable_unexpected',
        expect.objectContaining({ appId: 'app-1', upstreamStatus: 502 }),
      );
    });

    it('does not surface liveAccountId when it is an empty string', async () => {
      // status.liveAccountId can come back as '' from stripe-service for
      // pre-claim sandboxes (the omitempty path on the Go side strips it,
      // but a future shape change might return ''). Pin that empty string
      // is treated the same as absent — neither leaks into the agent's
      // tool result.
      mockGetStatus.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'provisioned',
        liveAccountId: '',
      });

      const result = await statusTool.execute({}, { metadata: { appId: 'app-1' } });
      expect(result).toEqual({
        success: true,
        hasStripe: true,
        sandboxId: 'cbsbx_fake_X',
        claimStatus: 'provisioned',
      });
      expect(result).not.toHaveProperty('liveAccountId');
    });
  });

  describe('input schema validation', () => {
    // setupTool.execute doesn't run the schema at runtime (the framework
    // does), so these tests pin the schema directly. A regression that drops
    // .email() or the country regex would let bad input through to
    // stripe-service; these guard the boundary.
    it('rejects non-email strings', () => {
      const result = setupTool.parameters.safeParse({ email: 'not-an-email', country: 'US' });
      expect(result.success).toBe(false);
    });

    it('rejects lowercase country code', () => {
      const result = setupTool.parameters.safeParse({ email: 'a@b.c', country: 'us' });
      expect(result.success).toBe(false);
    });

    it('rejects 3-letter country code', () => {
      const result = setupTool.parameters.safeParse({ email: 'a@b.c', country: 'USA' });
      expect(result.success).toBe(false);
    });

    it('accepts valid email + uppercase 2-letter country', () => {
      const result = setupTool.parameters.safeParse({ email: 'founder@example.com', country: 'US' });
      expect(result.success).toBe(true);
    });

    it('statusTool accepts an empty input object', () => {
      const result = statusTool.parameters.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('hooks.onLoad (Stripe MCP integration)', () => {
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('calls registerDynamicTools when MCP tools are returned', async () => {
      const fakeTool = { description: 'create a product', execute: vi.fn() };
      mockLoadStripeMcpTools.mockResolvedValueOnce({ products_create: fakeTool });

      await hooks?.onLoad?.({ skillName: 'stripe-v2' });

      expect(mockLoadStripeMcpTools).toHaveBeenCalledOnce();
      expect(mockRegisterDynamicTools).toHaveBeenCalledWith('stripe-v2', {
        products_create: fakeTool,
      });
    });

    it('skips registerDynamicTools when loadStripeMcpTools returns empty (no key)', async () => {
      mockLoadStripeMcpTools.mockResolvedValueOnce({});

      await hooks?.onLoad?.({ skillName: 'stripe-v2' });

      expect(mockLoadStripeMcpTools).toHaveBeenCalledOnce();
      expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
    });

    it('skips registerDynamicTools when loadStripeMcpTools rejects (MCP unreachable)', async () => {
      // Guard against a regression where loadStripeMcpTools starts throwing
      // instead of returning {} — a rejected onLoad bubbles through runHook
      // and kills skill activation. onLoad must swallow the error.
      mockLoadStripeMcpTools.mockRejectedValueOnce(new Error('MCP unreachable'));

      await expect(hooks?.onLoad?.({ skillName: 'stripe-v2' })).resolves.toBeUndefined();
      expect(mockRegisterDynamicTools).not.toHaveBeenCalled();
    });
  });
});
