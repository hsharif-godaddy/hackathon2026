/**
 * Generic Slack Webhook API Endpoint
 *
 * Sends messages to Slack via webhook URLs.
 * Can be used for any notification purpose (feedback, alerts, etc.)
 *
 * @example
 * POST /api/slack-webhook
 * Content-Type: application/json
 * {
 *   "title": "New Feedback",
 *   "message": "User submitted feedback with rating 5"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/request-context';

/**
 * Slack webhook request payload
 */
interface SlackWebhookPayload {
  webhookUrl: string;
  title: string;
  message: string;
}

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
 * POST handler for sending messages to Slack
 *
 * @param request - Incoming request with webhook data
 * @returns JSON response with result
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let payload: SlackWebhookPayload;
    try {
      payload = await request.json();
    } catch {
      logger.warn('slack.webhook.invalid_json', {
        message: 'Invalid JSON payload received',
      });
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!payload.webhookUrl || !payload.title || !payload.message) {
      logger.warn('slack.webhook.invalid_payload', {
        message: 'Missing required fields in payload',
        hasWebhookUrl: !!payload.webhookUrl,
        hasTitle: !!payload.title,
        hasMessage: !!payload.message,
      });
      return NextResponse.json(
        { error: 'Missing required fields: webhookUrl, title, and message are required' },
        { status: 400 }
      );
    }

    // Validate webhook URL format
    if (!payload.webhookUrl.startsWith('https://hooks.slack.com/')) {
      logger.warn('slack.webhook.invalid_url', {
        message: 'Invalid Slack webhook URL format',
      });
      return NextResponse.json(
        { error: 'Invalid Slack webhook URL' },
        { status: 400 }
      );
    }

    logger.info('slack.webhook.sending', {
      title: payload.title,
      messageLength: payload.message.length,
    });

    const slackMessage = formatSlackMessage(payload.title, payload.message);

    const response = await fetch(payload.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error('slack.webhook.send_failed', {
        title: payload.title,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'Failed to send message to Slack', status: response.status },
        { status: response.status }
      );
    }

    logger.info('slack.webhook.sent', {
      title: payload.title,
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: 'Message sent to Slack successfully',
    });
  } catch (error) {
    logger.error('slack.webhook.error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
