/**
 * Feedback Slack Notification API Endpoint
 *
 * Sends feedback submissions to Slack webhook (server-side only).
 *
 * Security: Webhook URL is stored in SLACK_FEEDBACK_WEBHOOK_URL (server-only env var)
 * without NEXT_PUBLIC_ prefix, preventing client exposure.
 *
 * @example
 * POST /api/slack-webhook/feedback
 * Content-Type: application/json
 * {
 *   "feedbackData": { ... },
 *   "appId": "app-123"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { sendSlackBlockMessage, sendSlackMessage, type SlackBlockMessage } from '@/lib/slack-webhook';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Feedback request payload (legacy format)
 */
interface FeedbackPayload {
  title: string;
  message: string;
}

/**
 * Feedback request payload (Block Kit format)
 */
interface FeedbackBlockPayload {
  blockMessage: SlackBlockMessage;
}

/**
 * POST handler for sending feedback to Slack
 *
 * @param request - Incoming request with feedback data
 * @param authContext - Customer authentication context
 * @returns JSON response with result
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
): Promise<NextResponse> => {
  try {
    // JWT required
    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    // CRM impersonation sessions cannot submit feedback on behalf of customers
    if (authContext.user.authType === 'e2s') {
      logger.info('feedback.slack.impersonation_blocked', {
        message: 'Feedback submission blocked for impersonation session',
        shopperId: authContext.user.shopperId,
      });
      return NextResponse.json(
        { error: 'Feedback cannot be submitted during account impersonation' },
        { status: 403 }
      );
    }
    // Get webhook URL from server-side environment variable (NOT exposed to client)
    const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;

    if (!webhookUrl) {
      logger.debug('feedback.slack.not_configured', {
        message: 'SLACK_FEEDBACK_WEBHOOK_URL not configured, skipping Slack notification',
      });
      // Return success even if not configured - feedback was still saved
      return NextResponse.json({
        success: true,
        message: 'Feedback received (Slack notification not configured)',
      });
    }

    // Parse request body
    let payload: FeedbackPayload | FeedbackBlockPayload;
    try {
      payload = await request.json();
    } catch {
      logger.warn('feedback.slack.invalid_json', {
        message: 'Invalid JSON payload received',
      });
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Determine if using Block Kit format or legacy format
    const isBlockFormat = 'blockMessage' in payload;
    let result;

    if (isBlockFormat) {
      // Block Kit format
      const blockPayload = payload as FeedbackBlockPayload;

      if (!blockPayload.blockMessage) {
        logger.warn('feedback.slack.invalid_block_payload', {
          message: 'Missing required field: blockMessage',
        });
        return NextResponse.json(
          { error: 'Missing required field: blockMessage' },
          { status: 400 }
        );
      }

      logger.info('feedback.slack.sending_blocks', {
        title: blockPayload.blockMessage.title || 'Untitled',
        fieldCount: blockPayload.blockMessage.fields?.length || 0,
        linkCount: blockPayload.blockMessage.links?.length || 0,
      });

      result = await sendSlackBlockMessage(webhookUrl, blockPayload.blockMessage);
    } else {
      // Legacy format
      const legacyPayload = payload as FeedbackPayload;

      if (!legacyPayload.title || !legacyPayload.message) {
        logger.warn('feedback.slack.invalid_payload', {
          message: 'Missing required fields in payload',
          hasTitle: !!legacyPayload.title,
          hasMessage: !!legacyPayload.message,
        });
        return NextResponse.json(
          { error: 'Missing required fields: title and message' },
          { status: 400 }
        );
      }

      logger.info('feedback.slack.sending', {
        title: legacyPayload.title,
        messageLength: legacyPayload.message.length,
      });

      result = await sendSlackMessage(webhookUrl, legacyPayload.title, legacyPayload.message);
    }

    if (!result.success) {
      const title = isBlockFormat
        ? ((payload as FeedbackBlockPayload).blockMessage.title || 'Feedback')
        : (payload as FeedbackPayload).title;

      logger.error('feedback.slack.send_failed', {
        title,
        error: result.error,
        status: result.status,
      });
      return NextResponse.json(
        { error: result.error || 'Failed to send notification to Slack' },
        { status: result.status || 500 }
      );
    }

    const title = isBlockFormat
      ? ((payload as FeedbackBlockPayload).blockMessage.title || 'Feedback')
      : (payload as FeedbackPayload).title;

    logger.info('feedback.slack.sent', {
      title,
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: 'Feedback notification sent to Slack successfully',
    });
  } catch (error) {
    logger.error('feedback.slack.error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
