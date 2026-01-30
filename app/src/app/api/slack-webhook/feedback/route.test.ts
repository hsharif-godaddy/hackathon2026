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
    shopperId: 'shopper-123'
  }
};

const mockSendSlackMessage = vi.fn();

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return async (request: NextRequest, ...rest: any[]) => handler(request, mockAuthContext, ...rest);
  }
}));

vi.mock('@/lib/slack-webhook', () => ({
  sendSlackMessage: mockSendSlackMessage
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
          message: 'SLACK_FEEDBACK_WEBHOOK_URL not configured, skipping Slack notification'
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
});
