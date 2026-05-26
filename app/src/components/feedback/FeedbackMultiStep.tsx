import { useCallback, useRef, useState } from 'react';
import { isEmployeeAuthType } from '@airo/shared/auth';
import Modal from '@ux/modal';
import text from '@ux/text';

import { useExperimentsLine } from '@/components/feedback/experimentsLine';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useSwitchboard } from '@/hooks/useSwitchboard';
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
import { fetchDiagnosticContext, logDevFeedbackBlockMessage, openCrmCaseForIssue, saveToCompanionHub, sendFeedbackToSlack, storeToS3 } from './submitFeedback';
import type {
  DiagnosticContext,
  FeedbackCategory,
  FeedbackProps,
  FeedbackStep,
  FeedbackStorePayload,
  IssueFormData,
  ShareFeedbackFormData,
  SupportFormData,
} from './types';
import { BUG_REPORT_FEEDBACK_ID, getAppIdFromUrl, SUPPORT_FEEDBACK_ID } from './utils';

type SiteShape = {
  published_url?: string;
  variants?: string[];
  variantsWithLifecycle?: Array<{ variant: string; status: string }>;
};

interface SiteLookup {
  (id: string): SiteShape | null | undefined;
}

/**
 * Construct the parquet-row payload posted to /api/feedback/s3-store.
 *
 * The three submit handlers (support / issue / share-feedback) all build
 * essentially the same shape — only `feedback_category`, `feedback_text`,
 * `consent_flag`, and (for NPS) `rating` differ. Centralizing here so adding
 * a column or changing field-derivation logic happens in one place; the
 * three call-sites previously diverged on whether `topicJson` sorted
 * stably, on null-vs-undefined for absent fields, etc.
 */
function buildFanoutPayload(
  category: FeedbackCategory,
  fields: {
    feedbackText: string | null;
    consent: boolean;
    rating: number | null;
    topics: readonly string[];
  },
  currentAppId: string | null,
  getSite: SiteLookup,
  ctx: DiagnosticContext,
  origin: string | undefined,
): FeedbackStorePayload {
  const effectiveAppId = currentAppId ?? getAppIdFromUrl();
  const site = effectiveAppId ? getSite(effectiveAppId) ?? null : null;
  const appPublishFlag =
    site != null
      ? hasBeenPublished(site)
      : effectiveAppId
        ? null
        : false;
  const publishedUrlRaw = site?.published_url?.trim();
  const topicJson = fields.topics.length > 0
    ? JSON.stringify([...new Set(fields.topics.map(t => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
    : null;

  return {
    app_id: effectiveAppId,
    feedback_text: fields.feedbackText,
    consent_flag: fields.consent,
    rating: fields.rating,
    plan_type_name: ctx.planType,
    subscription_id: ctx.subscriptionId,
    subscription_status: ctx.subscriptionStatus,
    total_credit_cnt: ctx.totalCredits,
    available_credit_cnt: ctx.availableCredits,
    feedback_topic_list: topicJson,
    feedback_origin_name: origin?.trim() ? origin.trim() : null,
    feedback_category: category,
    app_publish_flag: appPublishFlag,
    publish_url: appPublishFlag === true && publishedUrlRaw ? publishedUrlRaw : null,
    experiments_line: ctx.experimentsLine ?? null,
    preview_url: ctx.previewUrl ?? null,
    published_url_full: ctx.publishedUrl ?? null,
    full_story_url: ctx.fullStoryUrl,
    subscription_info: ctx.subscriptionInfo || null,
  };
}

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
  const customerId = userInfo?.customerId as string | undefined;
  // GoDaddy TLA (three-letter acronym) accounts have 3-char shopperIds — these are internal employees
  const isInternalUser = shopperId?.length === 3;

  const experimentsLine = useExperimentsLine();
  const isCrmCaseEnabled = useSwitchboard('appbuilder-crm-case-create') === true;
  // When ON, the fanout Lambda owns Slack + CRM + investigator (and Jira) end-to-end
  // from the parquet write — UI just calls storeToS3 and short-circuits the BFF flow.
  // When OFF (default, or SSR `undefined`), the existing legacy/3946 flow runs.
  const fanoutViaLambda = useSwitchboard('appbuilder-fanout-via-lambda') === true;

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
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId, experimentsLine, customerId);

      if (fanoutViaLambda) {
        // Switchboard-flag ON: the fanout Lambda owns Slack + CRM + investigator
        // for support submissions — keyed off the `fanout_via_lambda=true`
        // field the BFF stamps into the parquet. The UI must NOT also call
        // /api/crm/case + /api/slack-webhook/feedback here, or recipients
        // get duplicate messages / cases during cutover.
        logDevFeedbackBlockMessage(buildSupportRequestBlocks(data, origin, ctx));
        const storeResult = await storeToS3(buildFanoutPayload(
          'support',
          { feedbackText: data.description, consent: data.followUp, rating: null, topics: data.topics },
          currentAppId, getSite, ctx, origin,
        ));
        // When fanout-via-lambda is ON, the BFF call is the entire fanout —
        // a 4xx/5xx means NOTHING fanned out (no Slack, no CRM, no Jira, no
        // investigator). Surface that to the user as a failure rather than
        // showing a misleading "success" toast.
        if (!storeResult.ok) {
          logger.error('feedback.support.submit.fanout_failed', { appId: currentAppId, status: storeResult.status });
          return false;
        }
        logger.info('feedback.support.submit.fanout_via_lambda', { appId: currentAppId });
        outcome = 'success';
        logger.info('feedback.support.submit.success', { appId: currentAppId });
        return true;
      }

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

      // CRM case creation via legacy /api/crm/case route. followUp is dropped
      // from the CRM call (CMAPI spec rejected it).
      // Attach .catch at creation time. supportFanoutPromise starts executing
      // synchronously; if sendFeedbackToSlack below throws, control jumps
      // to outer catch and `await ...catch(() => null)` is never reached,
      // leaving a rejecting Promise with no handler (UnhandledPromiseRejection).
      const supportFanoutPromise = (!isInternalUser && isCrmCaseEnabled
        ? openCrmCaseForIssue({
            description: data.description,
            appId: currentAppId,
          }).then((r) => ({
            success: true as const,
            caseId: r.caseId ?? null,
            caseNumber: r.caseNumber ?? null,
            investigationId: null,
          }))
        : Promise.resolve(null)
      ).catch(() => null);

      await sendFeedbackToSlack(blockMessage, currentAppId);
      outcome = 'success';
      // Durable Loki record for Grafana runbooks — shipAnalyticsLog is a best-effort
      // client-side queue (ClientLogBuffer) that drops events under degraded conditions.
      logger.info('feedback.support.submit.success', { appId: currentAppId });

      const supportFanoutResult = await supportFanoutPromise;
      if (supportFanoutResult?.caseId) {
        logger.info('feedback.crm.case.created', {
          appId: currentAppId,
          caseId: supportFanoutResult.caseId,
        });
      }

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
  }, [currentAppId, experimentsLine, getSite, isInternalUser, isImpersonating, isCrmCaseEnabled, origin, userInfo, fanoutViaLambda]);

  const handleIssueSubmit = useCallback(async (data: IssueFormData) => {
    let outcome: 'success' | 'failed' = 'failed';
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId, experimentsLine, customerId);

      if (fanoutViaLambda) {
        // Switchboard-flag ON: the fanout Lambda owns Slack + CRM + investigator
        // for issue submissions. UI just writes the parquet; Lambda fans out.
        logDevFeedbackBlockMessage(buildBugReportBlocks(data, origin, ctx));
        const storeResult = await storeToS3(buildFanoutPayload(
          'issue',
          { feedbackText: data.description, consent: data.followUp, rating: null, topics: data.topics },
          currentAppId, getSite, ctx, origin,
        ));
        // Flag-ON: BFF call IS the fanout. Treat any failure as user-visible.
        if (!storeResult.ok) {
          logger.error('feedback.issue.submit.fanout_failed', { appId: currentAppId, status: storeResult.status });
          return false;
        }
        logger.info('feedback.issue.submit.fanout_via_lambda', { appId: currentAppId });
        outcome = 'success';
        logger.info('feedback.issue.submit.success', { appId: currentAppId });
        return true;
      }

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

      // CRM case creation via legacy /api/crm/case route. Internal TLA
      // accounts are excluded client-side (the route also 403s them
      // defensively). followUp is not in the CRM payload (CMAPI spec
      // rejected it).
      // Attach .catch at creation time — see support handler above for rationale.
      const fanoutPromise = (!isInternalUser && isCrmCaseEnabled
        ? openCrmCaseForIssue({
            description: data.description,
            appId: currentAppId,
          }).then((r) => ({
            success: true as const,
            caseId: r.caseId ?? null,
            caseNumber: r.caseNumber ?? null,
            investigationId: null,
          }))
        : Promise.resolve(null)
      ).catch(() => null);

      await sendFeedbackToSlack(blockMessage, currentAppId);
      outcome = 'success';
      logger.info('feedback.issue.submit.success', { appId: currentAppId });

      const fanoutResult = await fanoutPromise;
      if (fanoutResult?.caseId) {
        logger.info('feedback.crm.case.created', {
          appId: currentAppId,
          caseId: fanoutResult.caseId,
        });
      }

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
  }, [currentAppId, experimentsLine, getSite, isInternalUser, isImpersonating, isCrmCaseEnabled, onSubmitSuccess, origin, userInfo, fanoutViaLambda]);

  const handleFeedbackSubmit = useCallback(async (data: ShareFeedbackFormData) => {
    let outcome: 'success' | 'failed' = 'failed';
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId, experimentsLine, customerId);

      if (fanoutViaLambda) {
        // Switchboard-flag ON: the fanout Lambda owns Slack + companion-hub + CRM
        // + investigator end-to-end from the parquet write. UI must NOT also
        // call Slack/companionHub here, or recipients get duplicates.
        logDevFeedbackBlockMessage(buildFeedbackBlocks(data, origin, ctx));
        const storeResult = await storeToS3(buildFanoutPayload(
          'feedback',
          { feedbackText: data.comment ?? null, consent: data.customerConsent, rating: data.rating ?? null, topics: data.topics },
          currentAppId, getSite, ctx, origin,
        ));
        // Flag-ON: BFF call IS the fanout. Treat any failure as user-visible.
        if (!storeResult.ok) {
          logger.error('feedback.share.submit.fanout_failed', { feedbackId, appId: currentAppId, status: storeResult.status });
          return false;
        }
        logger.info('feedback.share.submit.fanout_via_lambda', { feedbackId, appId: currentAppId });
        outcome = 'success';
        logger.info('feedback.share.submit.success', { feedbackId, appId: currentAppId });
        return true;
      }

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

      // Flag-OFF legacy NPS path: parquet write is enrichment-only (lake
      // analytics) and Slack/companion-hub already ran above. Fire-and-
      // forget — `void` makes intent explicit. storeToS3 catches network
      // and HTTP errors internally and logs them, so floating this Promise
      // doesn't hide failures from observability.
      void storeToS3(buildFanoutPayload(
        'feedback',
        { feedbackText: data.comment ?? null, consent: data.customerConsent, rating: data.rating ?? null, topics: data.topics },
        currentAppId, getSite, ctx, origin,
      ));

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
  }, [currentAppId, experimentsLine, getSite, isInternalUser, isImpersonating, origin, feedbackId, userInfo, fanoutViaLambda]);

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
