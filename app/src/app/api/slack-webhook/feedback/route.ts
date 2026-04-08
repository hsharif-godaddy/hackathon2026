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
import { isEmployeeAuthType } from '@airo/shared/auth';

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
  appId?: string; // Optional appId for agent JWT token generation
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

    // Detect internal users (TLA accounts and impersonation sessions)
    const shopperId = authContext.user.shopperId;
    const isTLA = shopperId?.length === 3;
    const isImpersonating = isEmployeeAuthType(authContext.user?.authType);

    // Log internal feedback for tracking
    if (isTLA || isImpersonating) {
      logger.info('feedback.slack.internal_user', {
        message: isTLA ? 'Feedback from TLA account' : 'Feedback from impersonation account',
        shopperId,
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

    logger.debug('feedback.payload.received', {
      isBlockFormat,
      hasBlockMessage: 'blockMessage' in payload,
      payloadKeys: Object.keys(payload),
      blockMessageKeys: isBlockFormat ? Object.keys((payload as any).blockMessage) : [],
    });

    // Validate Block Kit format
    if (isBlockFormat) {
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
    } else {
      // Legacy format validation
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
    }

    // Get webhook URL from server-side environment variable (NOT exposed to client)
    const webhookUrl = process.env.SLACK_FEEDBACK_WEBHOOK_URL;

    if (!webhookUrl) {
      logger.debug('feedback.slack.not_configured', {
        message: 'SLACK_FEEDBACK_WEBHOOK_URL not configured, returning blockMessage to frontend',
      });
      // Return success with translated blockMessage for frontend to log
      if (isBlockFormat) {
        const blockPayload = payload as FeedbackBlockPayload;
        return NextResponse.json({
          success: true,
          message: 'Feedback received (Slack notification not configured)',
          blockMessage: blockPayload.blockMessage, // Return translated blockMessage
        });
      }
      return NextResponse.json({
        success: true,
        message: 'Feedback received (Slack notification not configured)',
      });
    }

    // Send to Slack based on format
    let result;

    if (isBlockFormat) {
      // Block Kit format - already translated above
      const blockPayload = payload as FeedbackBlockPayload;

      logger.info('feedback.slack.sending_blocks', {
        title: blockPayload.blockMessage.title || 'Untitled',
        fieldCount: blockPayload.blockMessage.fields?.length || 0,
        linkCount: blockPayload.blockMessage.links?.length || 0,
      });

      result = await sendSlackBlockMessage(webhookUrl, blockPayload.blockMessage);
    } else {
      // Legacy format - already validated above
      const legacyPayload = payload as FeedbackPayload;

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
