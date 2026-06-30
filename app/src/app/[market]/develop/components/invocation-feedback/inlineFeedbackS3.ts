import { storeToS3 } from '@/components/feedback/submitFeedback';
import type { FeedbackStorePayload } from '@/components/feedback/types';
import { getFullStorySessionUrl } from '@/components/feedback/utils';
import { logger } from '@/lib/request-context';
import type { CreditGrantsResponse, SubscriptionPlan, SubscriptionStatus } from '@/types/credits';
import { getTotalCreditsFromGrants } from '@/utils/credits';
import { feedbackCategoryForReason, type FeedbackReason } from './types';

interface SubscriptionSnapshot {
  planType: SubscriptionPlan | null;
  subscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  totalCredits: number | null;
  availableCredits: number | null;
  subscriptionInfo: string | null;
}

async function fetchSubscription(appId: string): Promise<SubscriptionSnapshot> {
  try {
    const subResponse = await fetch('/api/subscriptions', { credentials: 'include' });
    if (!subResponse.ok) {
      logger.warn('invocation_feedback.subscription_fetch_failed', {
        status: subResponse.status,
        appId,
      });
      return nullSnapshot();
    }

    const subData = await subResponse.json();
    const active = subData.data?.active;
    if (!active) return nullSnapshot();

    const plan: string = active.plan || 'Unknown';
    const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
    const planType = (active.plan as SubscriptionPlan) || null;
    const subscriptionId: string | null = active.id || null;
    const subscriptionStatus = (active.status as SubscriptionStatus) || null;

    if (!active.id) {
      return {
        planType,
        subscriptionId,
        subscriptionStatus,
        totalCredits: null,
        availableCredits: null,
        subscriptionInfo: null,
      };
    }

    const creditsResponse = await fetch(
      `/api/credits/grants?subscriptionId=${encodeURIComponent(active.id)}&syncSpend=false`,
      { credentials: 'include' }
    );
    if (!creditsResponse.ok) {
      logger.warn('invocation_feedback.credits_fetch_failed', {
        status: creditsResponse.status,
        appId,
      });
      return {
        planType,
        subscriptionId,
        subscriptionStatus,
        totalCredits: null,
        availableCredits: null,
        subscriptionInfo: null,
      };
    }

    const creditsData: CreditGrantsResponse = await creditsResponse.json();
    if (!creditsData.success || !Array.isArray(creditsData.data)) {
      return {
        planType,
        subscriptionId,
        subscriptionStatus,
        totalCredits: null,
        availableCredits: null,
        subscriptionInfo: null,
      };
    }

    const { totalCreditsSpent, totalCreditsMax } = getTotalCreditsFromGrants(creditsData.data);

    return {
      planType,
      subscriptionId,
      subscriptionStatus,
      totalCredits: totalCreditsMax,
      availableCredits: totalCreditsMax - totalCreditsSpent,
      subscriptionInfo: `${planName} - ${totalCreditsSpent}/${totalCreditsMax}`,
    };
  } catch (err) {
    logger.warn('invocation_feedback.subscription_fetch_failed', {
      error: err instanceof Error ? err.message : String(err),
      appId,
    });
    return nullSnapshot();
  }
}

function nullSnapshot(): SubscriptionSnapshot {
  return {
    planType: null,
    subscriptionId: null,
    subscriptionStatus: null,
    totalCredits: null,
    availableCredits: null,
    subscriptionInfo: null,
  };
}

function build(
  appId: string,
  feedbackText: string,
  fullStoryUrl: string | null,
  sub: SubscriptionSnapshot,
  reason: FeedbackReason
): FeedbackStorePayload {
  return {
    app_id: appId,
    feedback_text: feedbackText,
    // Inline invocation feedback has no consent control in the UI today.
    // Persist explicit non-consent (false) rather than null to avoid
    // implying "consent unknown" in downstream fanout consumers.
    consent_flag: false,
    rating: null,
    plan_type_name: sub.planType,
    subscription_id: sub.subscriptionId,
    subscription_status: sub.subscriptionStatus,
    total_credit_cnt: sub.totalCredits,
    available_credit_cnt: sub.availableCredits,
    subscription_info: sub.subscriptionInfo,
    feedback_topic_list: JSON.stringify([feedbackCategoryForReason(reason)]),
    feedback_origin_name: 'inline-customer-feedback',
    feedback_category: 'customer-feedback',
    app_publish_flag: null,
    publish_url: null,
    experiments_line: null,
    preview_url: null,
    published_url_full: null,
    full_story_url: fullStoryUrl,
  };
}

export async function store({
  appId,
  feedbackText = '',
  flow,
  reason,
}: {
  appId: string;
  feedbackText?: string;
  flow: 'per-message' | 'skill-invoke' | 'artifact';
  reason: FeedbackReason;
}): Promise<void> {
  try {
    const [subResult, fullStoryResult] = await Promise.allSettled([
      fetchSubscription(appId),
      getFullStorySessionUrl(true),
    ]);
    const sub = subResult.status === 'fulfilled' ? subResult.value : nullSnapshot();
    const fullStoryUrl = fullStoryResult.status === 'fulfilled' ? fullStoryResult.value : null;
    const s3Result = await storeToS3(build(appId, feedbackText, fullStoryUrl, sub, reason));
    if (!s3Result.ok) {
      logger.warn('invocation_feedback.s3_store.failed', {
        appId,
        flow,
        feedbackTextLength: feedbackText.length,
        status: s3Result.status,
      });
    }
  } catch (error) {
    logger.warn('invocation_feedback.s3_store.error', {
      appId,
      flow,
      feedbackTextLength: feedbackText.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
