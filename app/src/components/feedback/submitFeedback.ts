import { logger } from '@/lib/request-context';
import { formatSlackBlockMessage, type SlackBlockMessage } from '@/lib/slack-webhook';
import { SubscriptionPlan, SubscriptionStatus } from '@/types/credits';
import { getEffectiveCreditsSpent } from '@/utils/credits';
import { isLocalDev } from '@/utils/is-local-dev';
import type { DiagnosticContext, FeedbackStorePayload } from './types';
import { getBaseUrl, getFullStorySessionUrl } from './utils';

/**
 * Dev-only console preview of a feedback Slack message. On the Lambda-fanout
 * path the BFF short-circuits when FEEDBACK_BUCKET is unset, so the client
 * echoes the Block Kit payload locally for pasting into the Block Kit Builder.
 * No-op outside local dev so it never leaks in test/prod.
 */
export function logDevFeedbackBlockMessage(blockMessage: SlackBlockMessage | undefined | null): void {
  if (!isLocalDev() || !blockMessage) return;
  // Block Kit Builder rejects top-level fields other than `blocks`; strip the
  // `text` fallback that Slack uses for push notifications so the dev can
  // paste the output straight into https://app.slack.com/block-kit-builder.
  const { blocks } = formatSlackBlockMessage(blockMessage);
   
  console.log(
    '📧 [DEV MODE] Feedback Slack payload (paste into https://app.slack.com/block-kit-builder):\n',
    JSON.stringify({ blocks }, null, 2),
  );
}

interface SiteInfo {
  preview_url?: string;
  published_url?: string;
}

export async function fetchDiagnosticContext(
  currentAppId: string | null,
  getSite: (id: string) => SiteInfo | null | undefined,
  isInternalUser: boolean,
  isImpersonating: boolean,
  shopperId: string | undefined,
  experimentsLine?: string,
  customerId?: string,
): Promise<DiagnosticContext> {
  const site = currentAppId ? getSite(currentAppId) : null;
  const fullStoryUrl = await getFullStorySessionUrl(true);

  let subscriptionInfo = '';
  let planType: SubscriptionPlan | null = null;
  let subscriptionId: string | null = null;
  let subscriptionStatus: SubscriptionStatus | null = null;
  let totalCredits: number | null = null;
  let availableCredits: number | null = null;

  try {
    const subscriptionResponse = await fetch('/api/subscriptions', {
      credentials: 'include',
    });
    if (!subscriptionResponse.ok) {
      logger.warn('feedback.diagnostic.subscription_fetch_failed', {
        status: subscriptionResponse.status,
        appId: currentAppId,
      });
    } else {
      const subscriptionData = await subscriptionResponse.json();
      const activeSubscription = subscriptionData.data?.active;

      if (activeSubscription) {
        const plan = activeSubscription.plan || 'Unknown';
        const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
        planType = (activeSubscription.plan as SubscriptionPlan) || null;
        subscriptionId = activeSubscription.id || null;
        subscriptionStatus = (activeSubscription.status as SubscriptionStatus) || null;

        if (activeSubscription.id) {
          const creditsResponse = await fetch(
            `/api/credits/grants?subscriptionId=${encodeURIComponent(activeSubscription.id)}&syncSpend=false`,
            { credentials: 'include' },
          );
          if (!creditsResponse.ok) {
            logger.warn('feedback.diagnostic.credits_fetch_failed', {
              status: creditsResponse.status,
              appId: currentAppId,
            });
          } else {
            const creditsData = await creditsResponse.json();
            if (creditsData.success && Array.isArray(creditsData.data)) {
              const totalCreditsMax = creditsData.data.reduce(
                (sum: number, grant: any) => sum + (grant.creditsMax || 0),
                0,
              );
              const totalCreditsSpent = creditsData.data.reduce(
                (sum: number, grant: any) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
                0,
              );
              subscriptionInfo = `${planName} - ${totalCreditsSpent}/${totalCreditsMax}`;
              totalCredits = totalCreditsMax;
              availableCredits = totalCreditsMax - totalCreditsSpent;
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn('feedback.diagnostic.subscription_fetch_failed', {
      error: err instanceof Error ? err.message : String(err),
      appId: currentAppId,
    });
  }

  return {
    currentAppId,
    previewUrl: site?.preview_url,
    publishedUrl: site?.published_url,
    fullStoryUrl,
    subscriptionInfo,
    planType,
    subscriptionId,
    subscriptionStatus,
    totalCredits,
    availableCredits,
    isInternalUser,
    isImpersonating,
    shopperId,
    experimentsLine,
    customerId,
  };
}

/**
 * Result of a `storeToS3` call. The parquet write is the entire fanout
 * trigger, so callers MUST await it and treat `ok: false` as a submission
 * failure (surface a failure toast).
 */
export interface StoreToS3Result {
  ok: boolean;
  status?: number;
}

/**
 * Submit a parquet row to the BFF for S3 persistence + downstream Lambda
 * fanout. Returns a Promise that resolves with the outcome — does NOT throw
 * on HTTP errors (callers can branch on `result.ok`). Network errors are
 * caught and logged as `network_error`; the Promise still resolves with
 * `ok: false` so callers can show the user a failure toast.
 *
 * Critical: the entire fanout (Slack/CRM/Jira/investigator) hinges on this
 * call succeeding — the Lambda is triggered by the parquet write. Callers
 * MUST `await` the result and treat `ok: false` as submission failure. The
 * previous fire-and-forget shape (returning `void` synchronously) silently
 * swallowed BFF 4xx/5xx errors, leaving the customer with a "success" toast
 * even when no fanout happened.
 */
export async function storeToS3(payload: FeedbackStorePayload): Promise<StoreToS3Result> {
  let response: Response;
  try {
    response = await fetch('/api/feedback/s3-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch (err) {
    logger.warn('feedback.store.s3.network_error', {
      error: err instanceof Error ? err.message : String(err),
      context: 'navigation_or_network',
    });
    return { ok: false };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.warn('feedback.store.s3.server_error', {
      status: response.status,
      statusText: response.statusText,
      body,
    });
    return { ok: false, status: response.status };
  }

  return { ok: true, status: response.status };
}

export async function saveToCompanionHub(
  feedbackId: string,
  data: Record<string, any>,
  customerId: string,
): Promise<void> {
  if (isLocalDev()) return;

  const baseUrl = getBaseUrl();

  const keys = [...Object.keys(data), 'customerId'];
  const values = [...Object.values(data), customerId];

  const response = await fetch(baseUrl + 'feedbacks/' + encodeURIComponent(feedbackId), {
    mode: 'cors',
    method: 'POST',
    credentials: 'include',
    headers: {
      'X-XSRF-TOKEN': '1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: window?.location?.href,
      keys,
      values,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save feedback: ${response.status}`);
  }
  // Response body intentionally not consumed.
}

