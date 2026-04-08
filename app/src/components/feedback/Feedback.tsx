import { useEffect, useState } from "react";
import { isEmployeeAuthType } from '@airo/shared/auth';
import Modal from "@ux/modal";
import Spinner from "@ux/spinner";
import text from "@ux/text";

import { FeedbackDescription } from '@/components/feedback/FeedbackDescription';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { FeedbackProps } from '@/components/feedback/types';
import { getBaseUrl, getMockFeedbackConfig, isLocalhost } from '@/components/feedback/utils';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useTranslations } from "@/hooks/useTranslations";
import { logger } from '@/lib/request-context';

export function Feedback(props: FeedbackProps) {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const { authState } = useAuthContext();
  // Gasket Auth spreads the full /api/auth/validate response onto authState,
  // so authType is available directly (same pattern as authReason in useAuth.ts)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isImpersonating = isEmployeeAuthType((authState as any)?.authType);

  const { feedbackId, onClose, onSubmitSuccess, origin } = props;

  useEffect(() => {
    // CRM impersonation sessions cannot submit feedback
    if (isImpersonating) {
      setIsLoading(false);
      return;
    }

    // Use mock data on localhost
    if (isLocalhost()) {
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
        error: err instanceof Error ? err.message : String(err)
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
