/**
 * Feedback Slack Webhook API Route Tests
 *
 * Tests the /api/slack-webhook/feedback endpoint for sending feedback to Slack.
 * This endpoint keeps the webhook URL server-side for security.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock modules before importing the route
 */
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

const mockAuthContext = {
  jwt: 'test-jwt',
  user: {
    customerId: 'customer-123',
    shopperId: 'shopper-123',
    authType: 'basic'
  }
};

const mockSendSlackMessage = vi.fn();
const mockSendSlackBlockMessage = vi.fn();
const mockIsEmployeeAuthType = vi.fn();
const mockInjectShareTokenIntoPreviewUrl = vi.fn();
const mockGetSite = vi.fn();

vi.mock('@airo/shared/auth', () => ({
  isEmployeeAuthType: mockIsEmployeeAuthType
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest, ...rest: any[]) => handler(request, mockAuthContext, ...rest);
  }
}));

vi.mock('@/lib/slack-webhook', () => ({
  sendSlackMessage: mockSendSlackMessage,
  sendSlackBlockMessage: mockSendSlackBlockMessage,
  formatSlackBlockMessage: (data: any) => data, // Pass-through for testing
}));

vi.mock('@/lib/share/inject-preview-token', () => ({
  injectShareTokenIntoPreviewUrl: mockInjectShareTokenIntoPreviewUrl,
}));

vi.mock('@/lib/control-plane', () => ({
  getControlPlaneAdapter: vi.fn(function () { return { getSite: mockGetSite }; }),
}));

/**
 * Helper to create mock NextRequest for POST
 */
function createMockRequest(body: Record<string, unknown>): NextRequest {
  const url = new URL('http://localhost:3000/api/slack-webhook/feedback');

  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

describe('/api/slack-webhook/feedback', function feedbackWebhookTests() {
  const originalEnv = process.env.SLACK_FEEDBACK_WEBHOOK_URL;

  beforeEach(function setup() {
    vi.clearAllMocks();
    mockSendSlackMessage.mockClear();
    // Set default webhook URL for tests
    process.env.SLACK_FEEDBACK_WEBHOOK_URL = 'https://hooks.slack.com/services/TEST/WEBHOOK/URL';
    // Default to non-employee auth type (regular customer)
    mockIsEmployeeAuthType.mockReturnValue(false);
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
    // Restore original env
    if (originalEnv) {
      process.env.SLACK_FEEDBACK_WEBHOOK_URL = originalEnv;
    } else {
      delete process.env.SLACK_FEEDBACK_WEBHOOK_URL;
    }
  });

  describe('POST - Input Validation', function validationTests() {
    it('should return 400 when payload is not valid JSON', async function invalidJSON() {
      const { POST } = await import('./route');
      const url = new URL('http://localhost:3000/api/slack-webhook/feedback');

      const request = new NextRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid JSON payload');
    });

    it('should return 400 when title is missing', async function missingTitle() {
      const { POST } = await import('./route');

      const request = createMockRequest({
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields: title and message');
    });

    it('should return 400 when message is missing', async function missingMessage() {
      const { POST } = await import('./route');

      const request = createMockRequest({
        title: 'Test Title'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields: title and message');
    });
  });

  describe('POST - Webhook URL Configuration', function webhookConfigTests() {
    it('should return success when webhook URL is not configured', async function noWebhookUrl() {
      delete process.env.SLACK_FEEDBACK_WEBHOOK_URL;

      const { POST } = await import('./route');

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Feedback received (Slack notification not configured)');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'feedback.slack.not_configured',
        expect.objectContaining({
          message: 'SLACK_FEEDBACK_WEBHOOK_URL not configured, returning blockMessage to frontend'
        })
      );

      // Should not call sendSlackMessage when webhook is not configured
      expect(mockSendSlackMessage).not.toHaveBeenCalled();
    });

    it('should use webhook URL from environment variable', async function useEnvWebhookUrl() {
      process.env.SLACK_FEEDBACK_WEBHOOK_URL = 'https://hooks.slack.com/services/ENV/WEBHOOK/URL';

      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify sendSlackMessage was called with webhook URL from env
      expect(mockSendSlackMessage).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/ENV/WEBHOOK/URL',
        'Test Feedback',
        'Test Message'
      );
    });
  });

  describe('POST - Successful Feedback Submission', function successTests() {
    it('should successfully send feedback to Slack', async function successfulSend() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'New Feedback Submitted for App ID: app-123',
        message: '*Rating*: 5/7\n*Comment*: Great work!'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Feedback notification sent to Slack successfully');
    });

    it('should handle feedback with minimal data', async function minimalFeedback() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'New Feedback',
        message: '*Rating*: 3/7'
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('should handle feedback with long messages', async function longMessage() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const longComment = 'A'.repeat(2000);

      const request = createMockRequest({
        title: 'New Feedback Submitted',
        message: `*Rating*: 7/7\n*Comment*: ${longComment}`
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('POST - Error Handling', function errorTests() {
    it('should handle Slack send returning 404', async function slackSend404() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: false,
        error: 'Invalid webhook URL',
        status: 404
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Invalid webhook URL');
    });

    it('should handle Slack send returning 500', async function slackSend500() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: false,
        error: 'Failed to send message to Slack',
        status: 500
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to send message to Slack');
    });

    it('should handle Slack utility errors', async function slackUtilityError() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockRejectedValueOnce(new Error('Network error'));

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });

    it('should handle Slack send with no status code', async function noStatusCode() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: false,
        error: 'Unknown error'
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Unknown error');
    });
  });

  describe('POST - Logging', function loggingTests() {
    it('should log successful feedback send', async function logSuccess() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'New Feedback Submitted for App ID: app-123',
        message: '*Rating*: 5/7'
      });

      await POST(request);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.slack.sending',
        expect.objectContaining({
          title: 'New Feedback Submitted for App ID: app-123',
          messageLength: 13
        })
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.slack.sent',
        expect.objectContaining({
          title: 'New Feedback Submitted for App ID: app-123',
          success: true
        })
      );
    });

    it('should log feedback send failures', async function logFailure() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: false,
        error: 'Failed to send message to Slack',
        status: 500
      });

      const request = createMockRequest({
        title: 'New Feedback',
        message: 'Test Message'
      });

      await POST(request);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'feedback.slack.send_failed',
        expect.objectContaining({
          title: 'New Feedback',
          error: 'Failed to send message to Slack',
          status: 500
        })
      );
    });

    it('should log when webhook is not configured', async function logNotConfigured() {
      delete process.env.SLACK_FEEDBACK_WEBHOOK_URL;

      const { POST } = await import('./route');

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      await POST(request);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'feedback.slack.not_configured',
        expect.any(Object)
      );
    });
  });

  describe('POST - Security', function securityTests() {
    it('should require authentication', async function requiresAuth() {
      // Temporarily remove JWT from mock auth context
      const originalJwt = mockAuthContext.jwt;
      mockAuthContext.jwt = '';

      const { POST } = await import('./route');

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication token required');

      // Restore JWT
      mockAuthContext.jwt = originalJwt;
    });

    it('should not expose webhook URL in response', async function noWebhookInResponse() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();
      const responseText = JSON.stringify(data);

      // Webhook URL should never appear in response
      expect(responseText).not.toContain('hooks.slack.com');
      expect(responseText).not.toContain('WEBHOOK');
    });

    it('should not log webhook URL', async function noWebhookInLogs() {
      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      await POST(request);

      // Check all logger calls don't contain webhook URL
      const allLogCalls = [
        ...mockLogger.info.mock.calls,
        ...mockLogger.warn.mock.calls,
        ...mockLogger.error.mock.calls,
        ...mockLogger.debug.mock.calls
      ];

      allLogCalls.forEach(function checkLogCall(call) {
        const logData = JSON.stringify(call);
        expect(logData).not.toContain('hooks.slack.com');
      });
    });
  });

  describe('POST - Preview Link Share-Token Injection', function previewTokenInjectionTests() {
    // Shape returned by the link iterator for typed `.find` callbacks — the
    // route's contract is `{ url, text }` per @/lib/slack-webhook's SlackLink.
    // Declared locally to avoid pulling a real type import into the test file
    // (the rest of the module is mocked via vi.mock).
    type LinkShape = { url: string; text: string };

    // Block-format payload with a Preview link in blockMessage.links — mirrors
    // what slackBuilders.buildDiagnosticLinks() produces for feedback submissions.
    // `agentUrl` is intentionally NOT in this shape: the route handler resolves
    // agent_url server-side via the control-plane adapter (mocked via
    // mockGetSite) so a client-supplied URL can never reach the outbound fetch.
    function makeBlockPayload(overrides: {
      appId?: string;
      previewUrl?: string;
      extraLinks?: LinkShape[];
    } = {}): Record<string, unknown> {
      const { appId, previewUrl, extraLinks = [] } = overrides;
      return {
        blockMessage: {
          title: ':speech_balloon: Product Feedback',
          links: [
            { url: previewUrl ?? 'https://app-123.preview.c24.airoapp.ai', text: 'Preview' },
            ...extraLinks,
          ],
        },
        ...(appId !== undefined ? { appId } : {}),
      };
    }

    it('rewrites the Preview link with the share-token when appId resolves to an agent_url', async function rewriteOnHappyPath() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        agent_url: 'https://agents.airoapp.ai',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
      });
      mockInjectShareTokenIntoPreviewUrl.mockResolvedValueOnce(
        'https://app-123.preview.c24.airoapp.ai/?airoShareToken=tok-xyz'
      );

      const request = createMockRequest(makeBlockPayload({ appId: 'app-123' }));
      const response = await POST(request);

      expect(response.status).toBe(200);
      // adapter.getSite was called with the authenticated JWT — never a
      // client-controlled value. This is the SSRF guard.
      expect(mockGetSite).toHaveBeenCalledWith('app-123', mockAuthContext.jwt);
      expect(mockInjectShareTokenIntoPreviewUrl).toHaveBeenCalledWith(
        'app-123',
        'https://agents.airoapp.ai',
        'https://app-123.preview.c24.airoapp.ai',
      );
      // Slack receives the mutated blockMessage with the token-bearing URL.
      const [, sentBlockMessage] = mockSendSlackBlockMessage.mock.calls[0];
      const previewLink = sentBlockMessage.links.find((l: LinkShape) => l.text === 'Preview');
      expect(previewLink.url).toBe('https://app-123.preview.c24.airoapp.ai/?airoShareToken=tok-xyz');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.slack.preview_link.injected',
        expect.objectContaining({ appId: 'app-123' }),
      );
    });

    it('ignores a client-supplied agentUrl in the payload — never reaches outbound fetch (SSRF guard)', async function rejectsClientAgentUrl() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        agent_url: 'https://agents.airoapp.ai',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
      });
      mockInjectShareTokenIntoPreviewUrl.mockResolvedValueOnce(
        'https://app-123.preview.c24.airoapp.ai/?airoShareToken=tok-xyz'
      );

      // Attacker tries to inject http://169.254.169.254 — the route MUST
      // ignore it and use the adapter-resolved URL.
      const payload = {
        ...makeBlockPayload({ appId: 'app-123' }),
        agentUrl: 'http://169.254.169.254',
      };
      const request = createMockRequest(payload);
      await POST(request);

      // The helper saw ONLY the adapter-resolved trusted URL, never the
      // attacker-supplied one.
      expect(mockInjectShareTokenIntoPreviewUrl).toHaveBeenCalledWith(
        'app-123',
        'https://agents.airoapp.ai',
        expect.any(String),
      );
      expect(mockInjectShareTokenIntoPreviewUrl).not.toHaveBeenCalledWith(
        'app-123',
        'http://169.254.169.254',
        expect.any(String),
      );
    });

    it('skips injection when appId is missing', async function skipNoAppId() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });

      const request = createMockRequest(makeBlockPayload({ /* no appId */ }));
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockGetSite).not.toHaveBeenCalled();
      expect(mockInjectShareTokenIntoPreviewUrl).not.toHaveBeenCalled();
      // Slack still receives the (bare) blockMessage — delivery is not blocked.
      expect(mockSendSlackBlockMessage).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'feedback.slack.preview_link.skipped',
        expect.objectContaining({ reason: 'missing-appId' }),
      );
    });

    it('skips injection when adapter.getSite returns a site without agent_url', async function skipNoAgentUrlInSite() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      // Pre-bootstrap / archive-restoring app: site row exists but agent_url
      // hasn't been assigned yet.
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
        // no agent_url
      });

      const request = createMockRequest(makeBlockPayload({ appId: 'app-123' }));
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInjectShareTokenIntoPreviewUrl).not.toHaveBeenCalled();
      expect(mockSendSlackBlockMessage).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'feedback.slack.preview_link.skipped',
        expect.objectContaining({ reason: 'missing-agentUrl' }),
      );
    });

    it('skips injection when adapter.getSite returns null (site not found)', async function skipSiteNotFound() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockResolvedValueOnce(null);

      const request = createMockRequest(makeBlockPayload({ appId: 'app-123' }));
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInjectShareTokenIntoPreviewUrl).not.toHaveBeenCalled();
      expect(mockSendSlackBlockMessage).toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'feedback.slack.preview_link.skipped',
        expect.objectContaining({ reason: 'missing-agentUrl' }),
      );
    });

    it('falls back to bare URL when adapter.getSite throws', async function siteLookupThrows() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockRejectedValueOnce(new Error('control-plane-down'));

      const request = createMockRequest(makeBlockPayload({ appId: 'app-123' }));
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockInjectShareTokenIntoPreviewUrl).not.toHaveBeenCalled();
      // Slack still receives the bare blockMessage — delivery is not blocked
      // by a transient control-plane outage.
      expect(mockSendSlackBlockMessage).toHaveBeenCalled();
      const [, sentBlockMessage] = mockSendSlackBlockMessage.mock.calls[0];
      const previewLink = sentBlockMessage.links.find((l: LinkShape) => l.text === 'Preview');
      expect(previewLink.url).toBe('https://app-123.preview.c24.airoapp.ai');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.slack.preview_link.site_lookup_failed',
        expect.objectContaining({ appId: 'app-123', error: 'control-plane-down' }),
      );
    });

    it('falls back to bare URL when the injection helper throws', async function helperThrowsFallback() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        agent_url: 'https://agents.airoapp.ai',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
      });
      mockInjectShareTokenIntoPreviewUrl.mockRejectedValueOnce(new Error('agents-down'));

      const request = createMockRequest(makeBlockPayload({ appId: 'app-123' }));
      const response = await POST(request);

      // Slack delivery succeeded with the BARE URL — failure is not fatal.
      expect(response.status).toBe(200);
      expect(mockSendSlackBlockMessage).toHaveBeenCalled();
      const [, sentBlockMessage] = mockSendSlackBlockMessage.mock.calls[0];
      const previewLink = sentBlockMessage.links.find((l: LinkShape) => l.text === 'Preview');
      expect(previewLink.url).toBe('https://app-123.preview.c24.airoapp.ai');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.slack.preview_link.inject_failed',
        expect.objectContaining({ appId: 'app-123', error: 'agents-down' }),
      );
    });

    it('falls back to bare URL when the helper returns the bare URL (no-token case)', async function helperReturnsBareUrl() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        agent_url: 'https://agents.airoapp.ai',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
      });
      // Helper "fails open" inside itself — returns the bare URL on internal error.
      mockInjectShareTokenIntoPreviewUrl.mockResolvedValueOnce('https://app-123.preview.c24.airoapp.ai');

      const request = createMockRequest(makeBlockPayload({ appId: 'app-123' }));
      const response = await POST(request);

      expect(response.status).toBe(200);
      // The URL actually sent to Slack is the bare URL — no token snuck in.
      const [, sentBlockMessage] = mockSendSlackBlockMessage.mock.calls[0];
      const previewLink = sentBlockMessage.links.find((l: LinkShape) => l.text === 'Preview');
      expect(previewLink.url).toBe('https://app-123.preview.c24.airoapp.ai');
      // The route still warns so we have an audit trail for "we tried but got
      // nothing to inject" — distinct from "we never tried because inputs missing."
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'feedback.slack.preview_link.no_token',
        expect.objectContaining({ appId: 'app-123' }),
      );
      // No "injected" log fires since the URL didn't change.
      const injectedLogCalls = mockLogger.info.mock.calls.filter(
        (call) => call[0] === 'feedback.slack.preview_link.injected'
      );
      expect(injectedLogCalls).toHaveLength(0);
    });

    it('does not touch non-Preview links (Published, Nexus, Console)', async function leavesOtherLinksAlone() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        agent_url: 'https://agents.airoapp.ai',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
      });
      mockInjectShareTokenIntoPreviewUrl.mockResolvedValueOnce(
        'https://app-123.preview.c24.airoapp.ai/?airoShareToken=tok-xyz'
      );

      const request = createMockRequest(makeBlockPayload({
        appId: 'app-123',
        extraLinks: [
          { url: 'https://app-123.published.example.com', text: 'Published' },
          { url: 'https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=app-123', text: 'Nexus' },
          { url: 'https://console.airo-builder.godaddy.com/?appId=app-123', text: 'Console' },
        ],
      }));
      await POST(request);

      const [, sentBlockMessage] = mockSendSlackBlockMessage.mock.calls[0];
      // The injection helper was called exactly once — for the Preview link.
      expect(mockInjectShareTokenIntoPreviewUrl).toHaveBeenCalledTimes(1);
      // Non-Preview URLs are untouched.
      expect(sentBlockMessage.links.find((l: LinkShape) => l.text === 'Published').url)
        .toBe('https://app-123.published.example.com');
      expect(sentBlockMessage.links.find((l: LinkShape) => l.text === 'Nexus').url)
        .toBe('https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=app-123');
      expect(sentBlockMessage.links.find((l: LinkShape) => l.text === 'Console').url)
        .toBe('https://console.airo-builder.godaddy.com/?appId=app-123');
    });

    it('overwrites an existing airoShareToken query param cleanly (idempotent)', async function idempotentOverwrite() {
      const { POST } = await import('./route');
      mockSendSlackBlockMessage.mockResolvedValueOnce({ success: true });
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        agent_url: 'https://agents.airoapp.ai',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
      });
      // Helper always returns a token-bearing URL (its internal URL.searchParams.set
      // handles pre-existing token cleanly).
      mockInjectShareTokenIntoPreviewUrl.mockResolvedValueOnce(
        'https://app-123.preview.c24.airoapp.ai/?airoShareToken=fresh-token'
      );

      const request = createMockRequest(makeBlockPayload({
        appId: 'app-123',
        // URL already has a stale token from the BFF's /api/sites injection
        previewUrl: 'https://app-123.preview.c24.airoapp.ai/?airoShareToken=stale-token',
      }));
      await POST(request);

      const [, sentBlockMessage] = mockSendSlackBlockMessage.mock.calls[0];
      const previewLink = sentBlockMessage.links.find((l: LinkShape) => l.text === 'Preview');
      expect(previewLink.url).toBe('https://app-123.preview.c24.airoapp.ai/?airoShareToken=fresh-token');
      // The helper was invoked with the original (already-tokened) URL — it
      // owns the overwrite via URL.searchParams.set().
      expect(mockInjectShareTokenIntoPreviewUrl).toHaveBeenCalledWith(
        'app-123',
        'https://agents.airoapp.ai',
        'https://app-123.preview.c24.airoapp.ai/?airoShareToken=stale-token',
      );
    });

    it('leaves legacy (non-block) FeedbackPayload requests unaffected', async function legacyFormatUntouched() {
      const { POST } = await import('./route');
      mockSendSlackMessage.mockResolvedValueOnce({ success: true });

      const request = createMockRequest({
        title: 'Legacy Feedback',
        message: 'Some message body',
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      // Injection helper never runs for the legacy format — there's no
      // blockMessage to mutate. adapter.getSite also untouched.
      expect(mockGetSite).not.toHaveBeenCalled();
      expect(mockInjectShareTokenIntoPreviewUrl).not.toHaveBeenCalled();
      expect(mockSendSlackMessage).toHaveBeenCalled();
    });

    it('rewrites the Preview link even when the webhook is not configured (dev echo)', async function devEchoStillInjected() {
      delete process.env.SLACK_FEEDBACK_WEBHOOK_URL;
      const { POST } = await import('./route');
      mockGetSite.mockResolvedValueOnce({
        id: 'app-123',
        agent_url: 'https://agents.airoapp.ai',
        preview_url: 'https://app-123.preview.c24.airoapp.ai',
      });
      mockInjectShareTokenIntoPreviewUrl.mockResolvedValueOnce(
        'https://app-123.preview.c24.airoapp.ai/?airoShareToken=tok-xyz'
      );

      const request = createMockRequest(makeBlockPayload({ appId: 'app-123' }));
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      // The echoed blockMessage carries the injected URL so devs can verify
      // the rewrite from app/dev.log without configuring a Slack webhook.
      const previewLink = data.blockMessage.links.find((l: LinkShape) => l.text === 'Preview');
      expect(previewLink.url).toBe('https://app-123.preview.c24.airoapp.ai/?airoShareToken=tok-xyz');
      expect(mockSendSlackBlockMessage).not.toHaveBeenCalled();
    });
  });

  describe('POST - TLA Detection and Impersonation Logging', function tlaDetectionTests() {
    it('should log when feedback is from impersonation session', async function logImpersonationSession() {
      // Set authType to e2s (impersonation)
      const originalAuthType = mockAuthContext.user.authType;
      mockAuthContext.user.authType = 'e2s';
      mockIsEmployeeAuthType.mockReturnValueOnce(true);

      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.slack.internal_user',
        expect.objectContaining({
          message: 'Feedback from impersonation account',
          shopperId: mockAuthContext.user.shopperId
        })
      );

      // Reset authType after test
      mockAuthContext.user.authType = originalAuthType;
    });

    it('should log when feedback is from TLA account', async function logTlaAccount() {
      // Set 3-character shopper ID (TLA account)
      mockAuthContext.user.shopperId = 'abc';

      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      await POST(request);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'feedback.slack.internal_user',
        expect.any(Object)
      );

      // Reset shopper ID after test
      mockAuthContext.user.shopperId = 'shopper-123';
    });

    it('should not log TLA for regular customer', async function noLogForRegularCustomer() {
      // Set long shopper ID (regular customer)
      mockAuthContext.user.shopperId = 'customer-12345';

      const { POST } = await import('./route');

      mockSendSlackMessage.mockResolvedValueOnce({
        success: true
      });

      const request = createMockRequest({
        title: 'Test Feedback',
        message: 'Test Message'
      });

      await POST(request);

      // Get all info log calls
      const infoLogCalls = mockLogger.info.mock.calls;
      const hasInternalUserLog = infoLogCalls.some((call) => call[0] === 'feedback.slack.internal_user');

      expect(hasInternalUserLog).toBe(false);

      // Reset shopper ID after test
      mockAuthContext.user.shopperId = 'shopper-123';
    });
  });

});
