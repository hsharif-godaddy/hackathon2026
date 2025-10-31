export const getBaseUrl = () => {
  const hostname = window.location.hostname;
  const envPrefix = hostname.includes('dev-') ? 'dev-' : hostname.includes('test-') ? 'test-' : '';
  return `https://api.companion.hub.${envPrefix}godaddy.com/v1/`;
};

export const isLocalhost = () => {
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('localhost:');
};

export const getMockFeedbackConfig = (feedbackId: string) => {
  return {
    pk: feedbackId,
    title: 'Share Your Feedback',
    fields: [
      {
        options: [
          '7 - Very Positive',
          '6',
          '5',
          '4 - Neutral',
          '3',
          '2',
          '1 - Very Negative'
        ],
        id: 'rate-overal-experience',
        label: 'Overall, how would you rate your experience with the AI assistant?',
        type: 'radio' as const,
        required: true
      },
      {
        type: 'mtext' as const,
        id: 'improvemets-free-text',
        label: 'What could we do to improve the AI assistant experience?'
      }
    ],
    onlyOneResponseAllowed: false
  };
};
