/**
 * Shared Slack Webhook Utility
 *
 * Provides reusable functions for sending messages to Slack webhooks.
 * Used by API routes that need to send Slack notifications.
 */

import { logger } from '@/lib/request-context';

/**
 * Format message for Slack with rich formatting
 */
function formatSlackMessage(title: string, message: string): Record<string, unknown> {
  return {
    text: title,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*\n\n${message}`,
        },
      },
    ],
  };
}

/**
 * Result of sending a message to Slack
 */
export interface SlackSendResult {
  success: boolean;
  error?: string;
  status?: number;
}

/**
 * Send a message to a Slack webhook URL
 *
 * @param webhookUrl - The Slack webhook URL to send the message to
 * @param title - The title of the message
 * @param message - The message content
 * @returns Result object indicating success or failure
 */
export async function sendSlackMessage(
  webhookUrl: string,
  title: string,
  message: string
): Promise<SlackSendResult> {
  try {
    // Validate webhook URL format
    if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
      logger.warn('slack.webhook.invalid_url', {
        message: 'Invalid Slack webhook URL format',
      });
      return {
        success: false,
        error: 'Invalid Slack webhook URL',
        status: 400,
      };
    }

    logger.info('slack.webhook.sending', {
      title,
      messageLength: message.length,
    });

    const slackMessage = formatSlackMessage(title, message);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error('slack.webhook.send_failed', {
        title,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: 'Failed to send message to Slack',
        status: response.status,
      };
    }

    logger.info('slack.webhook.sent', {
      title,
      success: true,
    });

    return { success: true };
  } catch (error) {
    logger.error('slack.webhook.error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      error: 'Internal error sending message to Slack',
      status: 500,
    };
  }
}
