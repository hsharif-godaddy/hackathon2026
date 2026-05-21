import type { FanoutSubmitRequest, FanoutSubmitResponse } from '@/lib/feedback/fanout-types';
import { logger } from '@/lib/request-context';
import { formatSlackBlockMessage, type SlackBlockMessage } from '@/lib/slack-webhook';
import { SubscriptionPlan, SubscriptionStatus } from '@/types/credits';
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

export interface CrmCaseClientInput {
  description: string;
  appId: string | null;
}

export async function openCrmCaseForIssue(
  input: CrmCaseClientInput,
): Promise<{ caseId?: string; caseNumber?: string }> {
  if (isLocalDev()) return {};
  const res = await fetch('/api/crm/case', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`CRM case creation failed: ${res.status}`);
  }
  return res.json();
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

export async function submitFeedbackFanout(
  payload: FanoutSubmitRequest,
): Promise<FanoutSubmitResponse | null> {
  if (isLocalDev()) return null;
  let res: Response;
  try {
    res = await fetch('/api/feedback/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logger.warn('feedback.fanout.client.network_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!res.ok) {
    logger.warn('feedback.fanout.client.bad_status', { status: res.status });
    return null;
  }
  try {
    return (await res.json()) as FanoutSubmitResponse;
  } catch (err) {
    // 200 with garbled body is distinct from "200 with null payload" —
    // a missing log here would mask a real BFF shape regression. Warn
    // (not error) because the client side has no recovery action; the
    // submission already succeeded as far as the BFF is concerned.
    logger.warn('feedback.fanout.client.parse_failed', {
      status: res.status,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
