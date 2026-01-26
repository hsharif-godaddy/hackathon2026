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
        id: 'improvemets-free-text', // expected typo, from the DB, don't fix it
        label: 'What could we do to improve the AI assistant experience?'
      }
    ],
    onlyOneResponseAllowed: false
  };
};

const RATING_EMOJIS: Record<string, string> = {
  '1': ':crying-blood: - Very Negative - 1/7',
  '2': ':sob: - Negative - 2/7',
  '3': ':unamused: - Neutral - 3/7',
  '4': ':neutral_face: - Neutral - 4/7',
  '5': ':slightly_smiling_face: - Positive - 5/7',
  '6': ':smile: - Positive - 6/7',
  '7': ':star-struck: - Very Positive - 7/7',
};

const formatFieldName = (key: string): string => {
  if (key === 'rate-overal-experience') return 'Rating';
  if (key === 'improvemets-free-text') return 'Comment'; // expected typo, from the DB, don't fix it
  // Convert kebab-case to Title Case
  return key
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const formatFieldValue = (key: string, value: any): string => {
  if (key === 'rate-overal-experience') {
    const rating = String(value).charAt(0);
    return RATING_EMOJIS[rating] || value;
  }
  return value;
};

export const formatSlackFeedbackMessage = (data: Record<string, any>): string => {
  const feedbackDetails = Object.entries(data)
    .filter(([key, value]) => {
      // Only show comment field if it has content
      if (key === 'improvemets-free-text') { // expected typo, from the DB, don't fix it
        return value && String(value).trim().length > 0;
      }
      return true;
    })
    .map(([key, value]) => {
      const formattedName = formatFieldName(key);
      const formattedValue = formatFieldValue(key, value);
      return `*${formattedName}*: ${formattedValue}`;
    })
    .join('\n');

  return feedbackDetails;
};
