import { logger } from '@/lib/request-context';
import { formatSlackBlockMessage, type SlackBlockMessage } from '@/lib/slack-webhook';
import { getEffectiveCreditsSpent } from '@/utils/credits';
import { isLocalDev } from '@/utils/is-local-dev';
import type { DiagnosticContext, FeedbackStorePayload } from './types';
import { getBaseUrl, getFullStorySessionUrl } from './utils';

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
): Promise<DiagnosticContext> {
  const site = currentAppId ? getSite(currentAppId) : null;
  const fullStoryUrl = await getFullStorySessionUrl(true);

  let subscriptionInfo = '';
  try {
    const subscriptionResponse = await fetch('/api/subscriptions', {
      credentials: 'include',
    });
    if (subscriptionResponse.ok) {
      const subscriptionData = await subscriptionResponse.json();
      const activeSubscription = subscriptionData.data?.active;

      if (activeSubscription) {
        const plan = activeSubscription.plan || 'Unknown';
        const planName = plan.charAt(0).toUpperCase() + plan.slice(1);

        if (activeSubscription.id) {
          const creditsResponse = await fetch(
            `/api/credits/grants?subscriptionId=${encodeURIComponent(activeSubscription.id)}&syncSpend=false`,
            { credentials: 'include' },
          );
          if (creditsResponse.ok) {
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
            }
          }
        }
      }
    }
  } catch (err) {
    logger.warn('feedback.diagnostic.subscription_fetch_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    currentAppId,
    previewUrl: site?.preview_url,
    publishedUrl: site?.published_url,
    fullStoryUrl,
    subscriptionInfo,
    isInternalUser,
    isImpersonating,
    shopperId,
    experimentsLine,
  };
}

export async function sendFeedbackToSlack(
  blockMessage: SlackBlockMessage,
  currentAppId: string | null,
): Promise<void> {
  const response = await fetch('/api/slack-webhook/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blockMessage,
      appId: currentAppId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook failed: ${response.status}`);
  }

  if (isLocalDev()) {
    try {
      const result = await response.json();
      if (result.blockMessage) {
        console.log('📧 [DEV MODE] Feedback Slack payload:', JSON.stringify(formatSlackBlockMessage(result.blockMessage), null, 2));
      }
    } catch {
      // JSON parse failure is non-fatal in dev — Slack delivery already succeeded.
    }
  }
}

export function storeToS3(payload: FeedbackStorePayload): void {
  fetch('/api/feedback/s3-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  })
    .then(async response => {
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        logger.warn('feedback.store.s3.server_error', {
          status: response.status,
          statusText: response.statusText,
          body,
        });
      }
    })
    .catch(err => {
      logger.warn('feedback.store.s3.network_error', {
        error: err instanceof Error ? err.message : String(err),
        context: 'navigation_or_network',
      });
    });
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
