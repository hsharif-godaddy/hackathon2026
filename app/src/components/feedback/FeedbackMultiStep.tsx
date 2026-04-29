import { useCallback, useState } from 'react';
import { isEmployeeAuthType } from '@airo/shared/auth';
import Modal from '@ux/modal';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
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

export function FeedbackMultiStep(props: FeedbackProps) {
  const { feedbackId, onClose, onSubmitSuccess, origin, initialStep } = props;
  const t = useTranslations();

  const { authState, getUserInfo } = useAuthContext();
  const isImpersonating = isEmployeeAuthType((authState as any)?.authType);
  const userInfo = getUserInfo();
  const shopperId = userInfo?.shopperId as string | undefined;
  // GoDaddy TLA (three-letter acronym) accounts have 3-char shopperIds — these are internal employees
  const isInternalUser = shopperId?.length === 3;

  // CRM skip / impersonation sessions can only file bug reports — start directly on the issue step
  // initialStep lets callers (e.g. FeedbackBanner) skip the category screen
  const [step, setStep] = useState<FeedbackStep>(isImpersonating ? 'issue' : (initialStep ?? 'category'));

  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const getSite = useSitesStore((state) => state.getSite);

  const handleSelectCategory = useCallback((category: FeedbackCategory) => {
    setStep(category);
  }, []);

  const handleBack = useCallback(() => {
    if (isImpersonating || initialStep) {
      // CRM skip users and callers that bypassed category selection — back closes the modal
      onClose();
    } else {
      setStep('category');
    }
  }, [isImpersonating, initialStep, onClose]);

  const handleSuccess = useCallback(() => {
    if (onSubmitSuccess) {
      onSubmitSuccess({ success: true, message: 'Feedback submitted successfully' });
    } else {
      onClose();
    }
  }, [onSubmitSuccess, onClose]);

  const handleSupportSubmit = useCallback(async (data: SupportFormData) => {
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId);
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

      logger.info('feedback.support.submit.success', { appId: currentAppId });
      return true;
    } catch (err) {
      logger.error('feedback.support.submit.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, [currentAppId, getSite, isInternalUser, isImpersonating, origin, userInfo]);

  const handleIssueSubmit = useCallback(async (data: IssueFormData) => {
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId);
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

      logger.info('feedback.issue.submit.success', { appId: currentAppId });
      return true;
    } catch (err) {
      logger.error('feedback.issue.submit.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, [currentAppId, getSite, isInternalUser, isImpersonating, origin, userInfo]);

  const handleFeedbackSubmit = useCallback(async (data: ShareFeedbackFormData) => {
    try {
      const ctx = await fetchDiagnosticContext(currentAppId, getSite, isInternalUser, isImpersonating, shopperId);
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

      // Fire after all awaited ops succeed — prevents duplicate S3 records on retry
      storeToS3({
        app_id: currentAppId ?? getAppIdFromUrl(),
        feedback_text: data.comment ?? null,
        consent_flag: data.customerConsent,
        rating: data.rating ?? null,
      });

      logger.info('feedback.share.submit.success', { feedbackId, appId: currentAppId });
      return true;
    } catch (err) {
      logger.error('feedback.share.submit.failed', {
        feedbackId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }, [currentAppId, getSite, isInternalUser, isImpersonating, origin, feedbackId, userInfo]);

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
            hideRating={isInternalUser || isImpersonating}
          />
        )}
      </div>
    </Modal>
  );
}
