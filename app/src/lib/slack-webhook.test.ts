/**
 * Slack Webhook Utility Tests
 *
 * Tests the shared sendSlackMessage function for sending messages to Slack webhooks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mock modules before importing
 */
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn()
};

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('slack-webhook', function slackWebhookTests() {
  let sendSlackMessage: any;

  beforeEach(async function setup() {
    vi.clearAllMocks();
    vi.resetModules();
    mockFetch.mockClear();

    // Dynamically import to get fresh module
    const module = await import('./slack-webhook'); // eslint-disable-line @next/next/no-assign-module-variable
    sendSlackMessage = module.sendSlackMessage;
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
  });

  describe('URL validation', function urlValidation() {
    it('should reject non-Slack URLs', async function rejectInvalidUrl() {
      const result = await sendSlackMessage(
        'https://example.com/webhook',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid Slack webhook URL');
      expect(result.status).toBe(400);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'slack.webhook.invalid_url',
        expect.objectContaining({
          message: 'Invalid Slack webhook URL format'
        })
      );

      // Should not call fetch for invalid URLs
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject HTTP URLs', async function rejectHttpUrl() {
      const result = await sendSlackMessage(
        'http://hooks.slack.com/services/TEST/WEBHOOK',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid Slack webhook URL');
      expect(result.status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject empty URLs', async function rejectEmptyUrl() {
      const result = await sendSlackMessage('', 'Test Title', 'Test Message');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid Slack webhook URL');
      expect(result.status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should accept valid Slack webhook URLs', async function acceptValidUrl() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('successful message sending', function successTests() {
    it('should successfully send message to Slack', async function sendSuccess() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.status).toBeUndefined();
    });

    it('should format message correctly', async function formatMessage() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );

      const callBody = mockFetch.mock.calls[0][1]?.body;
      const parsedBody = JSON.parse(callBody);

      expect(parsedBody).toEqual({
        text: 'Test Title',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*Test Title*\n\nTest Message'
            }
          }
        ]
      });
    });

    it('should handle messages with special characters', async function specialChars() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Title with *bold* and _italic_',
        'Message with\nnewlines\nand\ttabs'
      );

      expect(result.success).toBe(true);
    });

    it('should handle long messages', async function longMessage() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const longMessage = 'A'.repeat(10000);

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        longMessage
      );

      expect(result.success).toBe(true);
    });
  });

  describe('error handling', function errorTests() {
    it('should handle Slack API errors', async function slackApiError() {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'invalid_payload'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to send message to Slack');
      expect(result.status).toBe(400);
    });

    it('should handle 404 errors', async function handle404() {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'channel_not_found'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to send message to Slack');
      expect(result.status).toBe(404);
    });

    it('should handle 500 errors', async function handle500() {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Internal error'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to send message to Slack');
      expect(result.status).toBe(500);
    });

    it('should handle network errors', async function networkError() {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error sending message to Slack');
      expect(result.status).toBe(500);
    });

    it('should handle timeout errors', async function timeoutError() {
      mockFetch.mockRejectedValueOnce(new Error('Request timeout'));

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error sending message to Slack');
      expect(result.status).toBe(500);
    });

    it('should handle malformed response text', async function malformedResponse() {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: vi.fn().mockRejectedValue(new Error('Failed to parse'))
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to send message to Slack');
      expect(result.status).toBe(500);

      // Should log with "Unknown error" when text parsing fails
      expect(mockLogger.error).toHaveBeenCalledWith(
        'slack.webhook.send_failed',
        expect.objectContaining({
          error: 'Unknown error'
        })
      );
    });

    it('should handle non-Error exceptions', async function nonErrorException() {
      mockFetch.mockRejectedValueOnce('String error');

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal error sending message to Slack');
      expect(result.status).toBe(500);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'slack.webhook.error',
        expect.objectContaining({
          error: 'String error'
        })
      );
    });
  });

  describe('logging', function loggingTests() {
    it('should log before sending', async function logBeforeSend() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'slack.webhook.sending',
        expect.objectContaining({
          title: 'Test Title',
          messageLength: 12
        })
      );
    });

    it('should log successful sends', async function logSuccess() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'slack.webhook.sent',
        expect.objectContaining({
          title: 'Test Title',
          success: true
        })
      );
    });

    it('should log failed sends', async function logFailure() {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Error details'
      });

      await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'slack.webhook.send_failed',
        expect.objectContaining({
          title: 'Test Title',
          status: 500,
          statusText: 'Internal Server Error',
          error: 'Error details'
        })
      );
    });

    it('should log exceptions with stack traces', async function logExceptions() {
      const testError = new Error('Test error');
      mockFetch.mockRejectedValueOnce(testError);

      await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        'Test Message'
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'slack.webhook.error',
        expect.objectContaining({
          error: 'Test error',
          stack: expect.any(String)
        })
      );
    });

    it('should not log webhook URLs', async function noWebhookInLogs() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      await sendSlackMessage(
        'https://hooks.slack.com/services/SECRET/WEBHOOK/TOKEN',
        'Test Title',
        'Test Message'
      );

      // Check all logger calls don't contain webhook URL parts
      const allLogCalls = [
        ...mockLogger.info.mock.calls,
        ...mockLogger.warn.mock.calls,
        ...mockLogger.error.mock.calls,
        ...mockLogger.debug.mock.calls
      ];

      allLogCalls.forEach(function checkLogCall(call) {
        const logData = JSON.stringify(call);
        expect(logData).not.toContain('SECRET');
        expect(logData).not.toContain('TOKEN');
      });
    });
  });

  describe('edge cases', function edgeCases() {
    it('should handle empty title', async function emptyTitle() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        '',
        'Test Message'
      );

      expect(result.success).toBe(true);
    });

    it('should handle empty message', async function emptyMessage() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test Title',
        ''
      );

      expect(result.success).toBe(true);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'slack.webhook.sending',
        expect.objectContaining({
          messageLength: 0
        })
      );
    });

    it('should handle Unicode characters', async function unicodeChars() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Test with 日本語',
        'Message with 中文 and emoji 🎉'
      );

      expect(result.success).toBe(true);
    });

    it('should handle JSON special characters', async function jsonSpecialChars() {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok'
      });

      const result = await sendSlackMessage(
        'https://hooks.slack.com/services/TEST/WEBHOOK/URL',
        'Title with "quotes"',
        'Message with \\ backslash and \n newline'
      );

      expect(result.success).toBe(true);

      const callBody = mockFetch.mock.calls[0][1]?.body;
      expect(() => JSON.parse(callBody)).not.toThrow();
    });
  });
});
