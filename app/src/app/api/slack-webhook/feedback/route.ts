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
import { sendSlackMessage } from '@/lib/slack-webhook';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * Feedback request payload
 */
interface FeedbackPayload {
  title: string;
  message: string;
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
    let payload: FeedbackPayload;
    try {
      payload = await request.json();
    } catch {
      logger.warn('feedback.slack.invalid_json', {
        message: 'Invalid JSON payload received',
      });
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Validate required fields
    if (!payload.title || !payload.message) {
      logger.warn('feedback.slack.invalid_payload', {
        message: 'Missing required fields in payload',
        hasTitle: !!payload.title,
        hasMessage: !!payload.message,
      });
      return NextResponse.json(
        { error: 'Missing required fields: title and message' },
        { status: 400 }
      );
    }

    logger.info('feedback.slack.sending', {
      title: payload.title,
      messageLength: payload.message.length,
    });

    // Send message to Slack directly using shared utility
    const result = await sendSlackMessage(webhookUrl, payload.title, payload.message);

    if (!result.success) {
      logger.error('feedback.slack.send_failed', {
        title: payload.title,
        error: result.error,
        status: result.status,
      });
      return NextResponse.json(
        { error: result.error || 'Failed to send notification to Slack' },
        { status: result.status || 500 }
      );
    }

    logger.info('feedback.slack.sent', {
      title: payload.title,
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
