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

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { injectShareTokenIntoPreviewUrl } from '@/lib/share/inject-preview-token';
import { sendSlackBlockMessage, sendSlackMessage, type SlackBlockMessage } from '@/lib/slack-webhook';

/**
 * Mutate the "Preview" link in a SlackBlockMessage to include
 * `?airoShareToken=<token>` so support staff (who have no builder session)
 * can open the preview from the Slack notification.
 *
 * Bypasses the shopper-scoped `appbuilder-share-links` Switchboard flag —
 * the Slack audience is internal support, so flag state on the customer's
 * side is the wrong gate. Always inject when we have what we need.
 *
 * agent_url is looked up SERVER-SIDE via the control-plane adapter using the
 * authenticated session's JWT — never trusted from the client request body.
 * Trusting a client-supplied agentUrl would be an SSRF vector: the BFF
 * issues an authenticated S2S fetch to it, so a malicious caller could
 * point it at EC2 metadata (169.254.169.254) or any internal host.
 *
 * Fails open at every level: missing inputs, missing Preview link, adapter
 * miss, helper throws, etc. — the original blockMessage is returned untouched
 * so Slack delivery never depends on this best-effort enhancement.
 */
async function injectShareTokenIntoPreviewLink(
  blockMessage: SlackBlockMessage,
  appId: string | undefined,
  jwt: string,
): Promise<void> {
  if (!appId) {
    logger.debug('feedback.slack.preview_link.skipped', {
      appId: null,
      reason: 'missing-appId',
    });
    return;
  }

  const links = blockMessage.links;
  if (!links || links.length === 0) {
    return;
  }

  // Find by label, not by URL pattern — the URL may already carry the token
  // (the BFF's /api/sites injection runs first for flag-on shoppers) or not.
  // The label is the stable identifier for "this is the customer-preview link."
  const previewLink = links.find((l) => l.text === 'Preview');
  if (!previewLink) {
    return;
  }

  // Look up agent_url via the authenticated control-plane adapter call. This
  // is the trusted source — adapter.getSite enforces ownership against the
  // shopper's JWT, so callers can only resolve agent_url for sites they
  // legitimately access.
  let agentUrl: string | undefined;
  try {
    const adapter = getControlPlaneAdapter();
    const site = await adapter.getSite(appId, jwt);
    agentUrl = site?.agent_url;
  } catch (err) {
    logger.warn('feedback.slack.preview_link.site_lookup_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!agentUrl) {
    // Pre-bootstrap / archive-restoring / 404 — non-fatal, just no injection.
    logger.debug('feedback.slack.preview_link.skipped', {
      appId,
      reason: 'missing-agentUrl',
    });
    return;
  }

  try {
    const augmentedUrl = await injectShareTokenIntoPreviewUrl(appId, agentUrl, previewLink.url);
    // The helper returns the bare URL on any internal failure — overwriting
    // with the same value is a no-op. Only log "injected" if the URL was
    // actually mutated to include the token.
    if (augmentedUrl !== previewLink.url) {
      previewLink.url = augmentedUrl;
      logger.info('feedback.slack.preview_link.injected', { appId });
    } else {
      logger.warn('feedback.slack.preview_link.no_token', { appId });
    }
  } catch (err) {
    // Helper has its own try/catch and shouldn't throw, but belt-and-suspenders
    // — a thrown error here must NOT block Slack delivery.
    logger.warn('feedback.slack.preview_link.inject_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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
 *
 * `agent_url` is intentionally NOT in this shape — the route handler resolves
 * it server-side via the control-plane adapter (gated by the customer's JWT)
 * to avoid SSRF. The client only needs to identify which app the feedback
 * is for.
 */
interface FeedbackBlockPayload {
  blockMessage: SlackBlockMessage;
  appId?: string; // Used to look up agent_url server-side for share-token injection.
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

    // Mint a share-token and rewrite the "Preview" link in blockMessage.links
    // BEFORE the dev-echo / send-to-Slack branches below — both consume the
    // (potentially mutated) blockMessage. Mutation is in-place; the helper
    // fails open so Slack delivery is never blocked by this enhancement.
    // agent_url is resolved server-side (NOT from the request body) to keep
    // outbound S2S fetches pinned to control-plane-trusted hosts.
    if (isBlockFormat) {
      const blockPayload = payload as FeedbackBlockPayload;
      await injectShareTokenIntoPreviewLink(
        blockPayload.blockMessage,
        blockPayload.appId,
        authContext.jwt,
      );
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
