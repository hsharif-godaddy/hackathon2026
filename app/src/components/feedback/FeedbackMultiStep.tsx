import { useCallback, useRef, useState } from 'react';
import { isEmployeeAuthType } from '@airo/shared/auth';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useExperimentsLine } from '@/components/feedback/experimentsLine';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { useSiteStore } from '@/stores/useSiteStore';
import { logClickEvent } from '@/utils/instrumentation';
import { hasBeenPublished } from '@/utils/site';
import { buildBugReportBlocks, buildFeedbackBlocks, buildSupportRequestBlocks } from './slackBuilders';
import { CategorySelectStep } from './steps/CategorySelectStep';
import { GetSupportStep } from './steps/GetSupportStep';
import { ReportIssueStep } from './steps/ReportIssueStep';
import { ShareFeedbackStep } from './steps/ShareFeedbackStep';
import { fetchDiagnosticContext, saveToCompanionHub, sendFeedbackToSlack, storeToS3 } from './submitFeedback';
import type {
  FeedbackCategory,
  FeedbackProps,
  FeedbackStep,
  IssueFormData,
  ShareFeedbackFormData,
  SupportFormData,
} from './types';
import { BUG_REPORT_FEEDBACK_ID, getAppIdFromUrl, SUPPORT_FEEDBACK_ID } from './utils';

// Map rating number to companion hub API format (preserves backward compat)
const RATING_TO_API_VALUE: Record<number, string> = {
  7: '7 - Very Positive',
  6: '6',
  5: '5',
  4: '4 - Neutral',
  3: '3',
  2: '2',
  1: '1 - Very Negative',
};

enum RatingBucket {
  Displeased = 'displeased',
  Neutral = 'neutral',
  Satisfied = 'satisfied',
  None = 'none',
}

function bucketRating(rating: number | null | undefined): RatingBucket {
  if (rating == null) return RatingBucket.None;
  if (rating <= 3) return RatingBucket.Displeased;
  if (rating === 4) return RatingBucket.Neutral;
  return RatingBucket.Satisfied;
}

function captureActiveElement() {
  return typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
}

export function FeedbackMultiStep(props: FeedbackProps) {
  const { feedbackId, onClose, onSubmitSuccess, origin, initialStep } = props;
  const t = useTranslations();
  const preMountFocusRef = useRef<HTMLElement | null>(captureActiveElement());

  const { authState, getUserInfo } = useAuthContext();
  const isImpersonating = isEmployeeAuthType((authState as any)?.authType);
  const userInfo = getUserInfo();
  const shopperId = userInfo?.shopperId as string | undefined;
  // GoDaddy TLA (three-letter acronym) accounts have 3-char shopperIds — these are internal employees
  const isInternalUser = shopperId?.length === 3;

  const experimentsLine = useExperimentsLine();

  // initialStep lets callers (e.g. FeedbackBanner) skip the category screen
  const [step, setStep] = useState<FeedbackStep>(initialStep ?? 'category');

  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const getSite = useCallback((id: string) => {
    return useSiteStore.getState().getSite(id) ?? useSitesStore.getState().getSite(id) ?? null;
  }, []);

  const handleSelectCategory = useCallback((category: FeedbackCategory) => {
    setStep(category);
  }, []);

  const handleBack = useCallback(() => {
    if (initialStep) {
      // callers that bypassed category selection — back closes the modal
      onClose();
    } else {
      setStep('category');
    }
  }, [initialStep, onClose]);

  const handleSuccess = useCallback(() => {
    if (onSubmitSuccess) {
      onSubmitSuccess({ success: true, message: 'Feedback submitted successfully' });
    } else {
      onClose();
    }
  }, [onSubmitSuccess, onClose]);

  const handleSupportSubmit = useCallback(async (data: SupportFormData) => {
    let outcome: 'success' | 'failed' = 'failed';
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId, experimentsLine);
      const blockMessage = buildSupportRequestBlocks(data, origin, ctx);

      // Save to companion hub under support PK
      try {
        const customerId = (userInfo?.customerId as string) ?? '';
        const apiData: Record<string, any> = {
          'type': 'support',
          'topics': data.topics.join(', '),
          'description': data.description,
          'follow-up-consent': data.followUp,
        };
        await saveToCompanionHub(SUPPORT_FEEDBACK_ID, apiData, customerId);
      } catch (err) {
        logger.warn('feedback.companion_hub.save_failed', {
          feedbackId: SUPPORT_FEEDBACK_ID,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await sendFeedbackToSlack(blockMessage, currentAppId);
      outcome = 'success';
      // Durable Loki record for Grafana runbooks — shipAnalyticsLog is a best-effort
      // client-side queue (ClientLogBuffer) that drops events under degraded conditions.
      logger.info('feedback.support.submit.success', { appId: currentAppId });
      return true;
    } catch (err) {
      logger.error('feedback.support.submit.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      // Telemetry fires regardless of Slack/companion hub outcome so user-intent events
      // are not under-counted when downstream services are degraded. The `outcome` field
      // distinguishes full success from partial/failed submissions.
      logClickEvent('feedback.support.submit', { appId: currentAppId ?? '', origin: origin ?? '' })();
      shipAnalyticsLog('feedback.support.submit', {
        appId: currentAppId ?? '',
        origin: origin ?? '',
        outcome,
      });
    }
  }, [currentAppId, experimentsLine, getSite, isInternalUser, isImpersonating, origin, userInfo]);

  const handleIssueSubmit = useCallback(async (data: IssueFormData) => {
    let outcome: 'success' | 'failed' = 'failed';
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId, experimentsLine);
      const blockMessage = buildBugReportBlocks(data, origin, ctx);

      // Save to companion hub under bug report PK
      try {
        const customerId = (userInfo?.customerId as string) ?? '';
        const apiData: Record<string, any> = {
          'type': 'bug-report',
          'topics': data.topics.join(', '),
          'description': data.description,
          'follow-up-consent': data.followUp,
        };
        await saveToCompanionHub(BUG_REPORT_FEEDBACK_ID, apiData, customerId);
      } catch (err) {
        logger.warn('feedback.companion_hub.save_failed', {
          feedbackId: BUG_REPORT_FEEDBACK_ID,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await sendFeedbackToSlack(blockMessage, currentAppId);
      outcome = 'success';
      logger.info('feedback.issue.submit.success', { appId: currentAppId });
      return true;
    } catch (err) {
      logger.error('feedback.issue.submit.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      logClickEvent('feedback.issue.submit', { appId: currentAppId ?? '', origin: origin ?? '' })();
      shipAnalyticsLog('feedback.issue.submit', {
        appId: currentAppId ?? '',
        origin: origin ?? '',
        outcome,
      });
    }
  }, [currentAppId, experimentsLine, getSite, isInternalUser, isImpersonating, origin, userInfo]);

  const handleFeedbackSubmit = useCallback(async (data: ShareFeedbackFormData) => {
    let outcome: 'success' | 'failed' = 'failed';
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId, experimentsLine);
      const blockMessage = buildFeedbackBlocks(data, origin, ctx);

      // Save to companion hub API (production only, backward compat with existing PK)
      try {
        const customerId = (userInfo?.customerId as string) ?? '';
        const apiData: Record<string, any> = {};
        if (data.rating) {
          apiData['rate-overal-experience'] = RATING_TO_API_VALUE[data.rating] || String(data.rating);
        }
        if (data.comment) {
          apiData['improvemets-free-text'] = data.comment; // expected typo from DB
        }
        if (data.topics.length > 0) {
          apiData['topics'] = data.topics.join(', ');
        }
        apiData['customer-consent'] = data.customerConsent;

        await saveToCompanionHub(feedbackId, apiData, customerId);
      } catch (err) {
        logger.warn('feedback.companion_hub.save_failed', {
          feedbackId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      await sendFeedbackToSlack(blockMessage, currentAppId);
      outcome = 'success';
      logger.info('feedback.share.submit.success', { feedbackId, appId: currentAppId });

      // Fire after all awaited ops succeed — prevents duplicate S3 records on retry
      const effectiveAppId = currentAppId ?? getAppIdFromUrl();
      const site = effectiveAppId ? getSite(effectiveAppId) ?? null : null;
      const appPublishFlag =
        site != null
          ? hasBeenPublished(site)
          : effectiveAppId
            ? null
            : false;
      const publishedUrlRaw = site?.published_url?.trim();
      const topicJson = data.topics.length > 0
        ? JSON.stringify([...new Set(data.topics.map(t => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
        : null;
      storeToS3({
        app_id: effectiveAppId,
        feedback_text: data.comment ?? null,
        consent_flag: data.customerConsent,
        rating: data.rating ?? null,
        plan_type_name: ctx.planType,
        subscription_id: ctx.subscriptionId,
        subscription_status: ctx.subscriptionStatus,
        total_credit_cnt: ctx.totalCredits,
        available_credit_cnt: ctx.availableCredits,
        feedback_topic_list: topicJson,
        feedback_origin_name: origin?.trim() ? origin.trim() : null,
        app_publish_flag: appPublishFlag,
        publish_url: appPublishFlag === true && publishedUrlRaw ? publishedUrlRaw : null,
      });
      return true;
    } catch (err) {
      logger.error('feedback.share.submit.failed', {
        feedbackId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    } finally {
      // ratingBucket ships as a customProperty on the pre-existing registered EID
      // (feedback.share.submit). Interpolating it into the EID string creates
      // catalog-unregistered variants that silently drop Hivemind attribution.
      const ratingBucket = bucketRating(data.rating);
      logClickEvent('feedback.share.submit', {
        appId: currentAppId ?? '',
        origin: origin ?? '',
        ratingBucket,
      })();
      shipAnalyticsLog('feedback.share.submit', {
        appId: currentAppId ?? '',
        feedbackId,
        origin: origin ?? '',
        outcome,
        // Omit rating entirely when absent — encoding null as 0 corrupts any
        // AVG(rating) or COUNT WHERE rating > 0 aggregation in ESSP, because
        // internal/impersonating users never see the rating widget.
        ...(data.rating != null ? { rating: data.rating } : {}),
        ratingBucket,
      });
    }
  }, [currentAppId, experimentsLine, getSite, isInternalUser, isImpersonating, origin, feedbackId, userInfo]);

  // CRM skip / impersonation sessions cannot submit any feedback.
  // Mirror the legacy Feedback.tsx contract: show a read-only message and no form.
  if (isImpersonating) {
    return (
      <Modal
        className="w-full max-w-2xl"
        title={t('builder_feedback_modal_title')}
        id="feedback-modal"
        onClose={onClose}
      >
        <text.p size={-1} emphasis="passive">
          {t('builder_feedback_impersonation_message')}
        </text.p>
      </Modal>
    );
  }

  const modalTitle = step === 'category'
    ? t('builder_feedback_modal_title')
    : step === 'support'
      ? t('builder_feedback_support_title')
      : step === 'issue'
        ? t('builder_feedback_issue_title')
        : t('builder_feedback_share_title');

  return (
    <Modal
      className="w-full max-w-2xl"
      title={modalTitle}
      id="feedback-modal"
      onClose={onClose}
      focusLock={{ autoFocus: true, returnFocus: () => { preMountFocusRef.current?.focus(); return false; } }}
    >
      <div className="flex flex-col min-h-[20rem] max-h-[70vh] w-full overflow-hidden">
        {step === 'category' && (
          <CategorySelectStep onSelectCategory={handleSelectCategory} />
        )}

        {step === 'support' && (
          <GetSupportStep onBack={handleBack} onSubmit={handleSupportSubmit} onDone={handleSuccess} />
        )}

        {step === 'issue' && (
          <ReportIssueStep onBack={handleBack} onSubmit={handleIssueSubmit} onDone={handleSuccess} />
        )}

        {step === 'feedback' && (
          <ShareFeedbackStep
            onBack={handleBack}
            onSubmit={handleFeedbackSubmit}
            onDone={handleSuccess}
            hideRating={isInternalUser}
          />
        )}
      </div>
    </Modal>
  );
}
