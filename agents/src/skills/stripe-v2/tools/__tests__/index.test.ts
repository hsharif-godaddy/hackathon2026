import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const { setupTool, statusTool } = await import('../index.js');

describe('stripe-v2 skill tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setupTool', () => {
    it('forwards input to stripeService.createSandbox and returns the typed sandbox shape', async () => {
      mockCreateSandbox.mockResolvedValueOnce({
        sandboxId: 'cbsbx_fake_X',
        accountId: 'acct_fake_X',
        claimUrl: 'https://dashboard.stripe.com/fake-claim/cbsbx_fake_X',
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
      });
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
        upstreamCode: 'STRIPE_CREATE_FAILED',
        upstreamStatus: 502,
      });
      // No retryAfterSeconds — degrade cause is a deploy-time config gap
      // (preview API not enabled), not a transient failure. The skill prose
      // tells the agent not to retry within the conversation; advertising a
      // retry budget here would contradict that.
      expect(result).not.toHaveProperty('retryAfterSeconds');
      expect((result as { message: string }).message).toContain("isn't available in this Airo Builder environment");

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
});
