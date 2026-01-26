/**
 * Slack Webhook API Route Tests
 *
 * Tests the /api/slack-webhook endpoint for sending messages to Slack.
 * Covers validation, error handling, and successful webhook delivery.
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock modules before importing the route
 */
vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

/**
 * Helper to create mock NextRequest for POST
 */
function createMockRequest(body: Record<string, unknown>): NextRequest {
  const url = new URL('http://localhost:3000/api/slack-webhook');

  return new NextRequest(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

describe('/api/slack-webhook', function slackWebhookTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
  });

  describe('POST - Input Validation', function validationTests() {
    it('should return 400 when payload is not valid JSON', async function invalidJSON() {
      const { POST } = await import('./route');
      const url = new URL('http://localhost:3000/api/slack-webhook');

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

    it('should return 400 when webhookUrl is missing', async function missingWebhookUrl() {
      const { POST } = await import('./route');

      const request = createMockRequest({
        title: 'Test Title',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields: webhookUrl, title, and message are required');
    });

    it('should return 400 when title is missing', async function missingTitle() {
      const { POST } = await import('./route');

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields: webhookUrl, title, and message are required');
    });

    it('should return 400 when message is missing', async function missingMessage() {
      const { POST } = await import('./route');

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Test Title'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Missing required fields: webhookUrl, title, and message are required');
    });

    it('should return 400 when webhookUrl is not a Slack URL', async function invalidWebhookUrl() {
      const { POST } = await import('./route');

      const request = createMockRequest({
        webhookUrl: 'https://evil.com/webhook',
        title: 'Test Title',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid Slack webhook URL');
    });
  });

  describe('POST - Slack API Interaction', function slackAPITests() {
    it('should successfully send message to Slack', async function successfulSend() {
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Test Title',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe('Message sent to Slack successfully');

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Test Title')
        })
      );

      // Verify the body structure
      const fetchCall = mockFetch.mock.calls[0];
      const bodyData = JSON.parse(fetchCall[1].body);
      expect(bodyData.text).toBe('Test Title');
      expect(bodyData.blocks[0].text.text).toContain('*Test Title*');
      expect(bodyData.blocks[0].text.text).toContain('Test Message');
    });

    it('should return error when Slack API returns 404', async function slack404Error() {
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'channel_not_found'
      });

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Test Title',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Failed to send message to Slack');
      expect(data.status).toBe(404);
    });

    it('should return error when Slack API returns 500', async function slack500Error() {
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Internal server error'
      });

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Test Title',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to send message to Slack');
    });

    it('should handle fetch network errors', async function networkError() {
      const { POST } = await import('./route');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Test Title',
        message: 'Test Message'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });

  describe('POST - Message Formatting', function formattingTests() {
    it('should format message with markdown blocks', async function markdownFormatting() {
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Feedback Submitted',
        message: '*Rating*: 5/7\n*Comment*: Great work!'
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify fetch was called
      const fetchCall = mockFetch.mock.calls[0];
      const bodyData = JSON.parse(fetchCall[1].body);

      expect(bodyData.blocks[0].type).toBe('section');
      expect(bodyData.blocks[0].text.type).toBe('mrkdwn');
      expect(bodyData.blocks[0].text.text).toContain('*Rating*: 5/7');
      expect(bodyData.blocks[0].text.text).toContain('*Comment*: Great work!');
    });

    it('should handle long messages', async function longMessage() {
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const longMessage = 'A'.repeat(3000);

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Long Message Test',
        message: longMessage
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should handle special characters in messages', async function specialCharacters() {
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Special Chars: <>&"\'',
        message: 'Message with special chars: <script>alert("xss")</script>'
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });

  describe('POST - Logging', function loggingTests() {
    it('should log successful webhook send', async function logSuccess() {
      const { logger } = await import('@/lib/request-context');
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Test Title',
        message: 'Test Message'
      });

      await POST(request);

      expect(logger.info).toHaveBeenCalledWith(
        'slack.webhook.sending',
        expect.objectContaining({
          title: 'Test Title',
          messageLength: 12
        })
      );

      expect(logger.info).toHaveBeenCalledWith(
        'slack.webhook.sent',
        expect.objectContaining({
          title: 'Test Title',
          success: true
        })
      );
    });

    it('should log webhook send failures', async function logFailure() {
      const { logger } = await import('@/lib/request-context');
      const { POST } = await import('./route');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Server error'
      });

      const request = createMockRequest({
        webhookUrl: 'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        title: 'Test Title',
        message: 'Test Message'
      });

      await POST(request);

      expect(logger.error).toHaveBeenCalledWith(
        'slack.webhook.send_failed',
        expect.objectContaining({
          title: 'Test Title',
          status: 500
        })
      );
    });
  });
});
