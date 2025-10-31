import { useState, useEffect } from "react";
import Modal from "@ux/modal"
import Spinner from "@ux/spinner"
import { FeedbackForm } from './FeedbackForm';
import { getBaseUrl, isLocalhost, getMockFeedbackConfig } from './utils';
import { FeedbackProps } from './types';

export function Feedback(props: FeedbackProps) {
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
      console.error(err);
      setIsLoading(false);
      onClose();
    });
  }, [feedbackId, onClose]);

  if (!config) return null;

  return (
    <Modal
      className="max-w-2xl"
      title={config.title || 'Feedback'}
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
