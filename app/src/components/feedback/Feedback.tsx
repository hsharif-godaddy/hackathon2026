import { useEffect,useState } from "react";
import Modal from "@ux/modal"
import Spinner from "@ux/spinner"

import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { FeedbackProps } from '@/components/feedback/types';
import { getBaseUrl, getMockFeedbackConfig,isLocalhost } from '@/components/feedback/utils';
import { useTranslations } from "@/hooks/useTranslations";
import { logger } from '@/lib/request-context';

export function Feedback(props: FeedbackProps) {
  const t = useTranslations();
  const [isLoading, setIsLoading] = useState(true);
  const [config, setConfig] = useState(null);

  const { feedbackId, onClose, onSubmitSuccess } = props;

  useEffect(() => {
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
  }, [feedbackId, onClose]);

  if (!config) return null;

  return (
    <Modal
      className="max-w-2xl"
      title={t('builder_feedback_title')}
      id="feedback-modal"
      onClose={onClose}
    >
      {isLoading && <Spinner />}
      {config && !isLoading && (
        <FeedbackForm
          config={config}
          onClose={onClose}
          onSubmitSuccess={onSubmitSuccess}
        />
      )}
    </Modal>
  );
}
