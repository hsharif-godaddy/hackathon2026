import { useEffect, useState } from "react";
import { isEmployeeAuthType } from '@airo/shared/auth';
import Modal from "@ux/modal";
import Spinner from "@ux/spinner";
import text from "@ux/text";

import { FeedbackDescription } from '@/components/feedback/FeedbackDescription';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import type { FeedbackProps } from '@/components/feedback/types';
import { getBaseUrl, getMockFeedbackConfig } from '@/components/feedback/utils';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from "@/hooks/useTranslations";
import { logger } from '@/lib/request-context';
import { isLocalDev } from '@/utils/is-local-dev';
import { FeedbackMultiStep } from './FeedbackMultiStep';

export function Feedback(props: FeedbackProps) {
  const { isAuthenticated } = useAuthContext();
  const { data: isMultiStepEnabled } = useSwitchboard('airo-builder-feedback-multistep', { enabled: isAuthenticated });

  if (isMultiStepEnabled) {
    return <FeedbackMultiStep {...props} />;
  }

  return <FeedbackLegacy {...props} />;
}

function FeedbackLegacy(props: FeedbackProps) {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState<any>(null);
  const { authState } = useAuthContext();
  // Gasket Auth spreads the full /api/auth/validate response onto authState,
  // so authType is available directly (same pattern as authReason in useAuth.ts)

  const isImpersonating = isEmployeeAuthType((authState as any)?.authType);

  const { feedbackId, onClose, onSubmitSuccess, origin } = props;

  useEffect(() => {
    // CRM impersonation sessions cannot submit feedback
    if (isImpersonating) {
      setIsLoading(false);
      return;
    }

    // Use mock data on localhost
    if (isLocalDev()) {
      const mockConfig = getMockFeedbackConfig(feedbackId);
      setConfig(mockConfig);
      setIsLoading(false);
      return;
    }

    // Production: fetch from API
    const baseUrl = getBaseUrl();
    fetch(baseUrl + 'feedback-configs/' + encodeURIComponent(feedbackId), {
      mode: 'cors',
      method: 'GET',
      credentials: 'include',
      headers: {
        'X-XSRF-TOKEN': '1',
        'Content-Type': 'application/json',
      },
    })
    .then((res) => {
      if (!res.ok) throw new Error(`Error fetching feedback config: ${res.status} ${res.statusText}`);
      return res.json();
    })
    .then((res) => {
      setConfig(res);
      setIsLoading(false);
    })
    .catch((err) => {
      logger.error('feedback.config.fetch.failed', {
        feedbackId,
        error: err instanceof Error ? err.message : String(err),
      });
      setIsLoading(false);
      onClose();
    });
  }, [feedbackId, isImpersonating, onClose]);

  return (
    <Modal
      className="max-w-2xl"
      title={t('builder_feedback_title')}
      id="feedback-modal"
      onClose={onClose}
    >
      {isImpersonating ? (
        <text.p size={-1} emphasis="passive">
          {t('builder_feedback_impersonation_message')}
        </text.p>
      ) : (
        <>
          <FeedbackDescription />
          {isLoading && <Spinner />}
          {config && !isLoading && (
            <FeedbackForm
              config={config}
              onClose={onClose}
              onSubmitSuccess={onSubmitSuccess}
              origin={origin}
            />
          )}
        </>
      )}
    </Modal>
  );
}
