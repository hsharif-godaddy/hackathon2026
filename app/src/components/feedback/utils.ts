// Declare FullStory global type
declare global {
  interface Window {
    FS?: {
      (method: 'getSession', options?: { format?: string }): string | null;
      (method: 'getSessionAsync', options?: { format?: string }): Promise<string | null>;
    };
  }
}

export const FEEDBACK_ID = 'airo#app-builder';
export const SUPPORT_FEEDBACK_ID = 'airo#app-builder-support';
export const BUG_REPORT_FEEDBACK_ID = 'airo#app-builder-bug';

export interface TopicOption {
  key: string;
  i18nKey: string;
}

export const SUPPORT_TOPICS: TopicOption[] = [
  { key: 'Domain or DNS', i18nKey: 'builder_feedback_support_topic_domain' },
  { key: 'Publishing my site', i18nKey: 'builder_feedback_support_topic_publishing' },
  { key: 'Billing or credits', i18nKey: 'builder_feedback_support_topic_billing' },
  { key: 'Account or login', i18nKey: 'builder_feedback_support_topic_account' },
  { key: 'Plan or upgrade', i18nKey: 'builder_feedback_support_topic_plan' },
  { key: 'Something else', i18nKey: 'builder_feedback_support_topic_other' },
];

export const ISSUE_TOPICS: TopicOption[] = [
  { key: 'Editor or canvas', i18nKey: 'builder_feedback_issue_topic_editor' },
  { key: 'AI assistant', i18nKey: 'builder_feedback_issue_topic_ai' },
  { key: 'Publishing or preview', i18nKey: 'builder_feedback_issue_topic_publishing' },
  { key: 'Credits or limits', i18nKey: 'builder_feedback_issue_topic_credits' },
  { key: 'Something else', i18nKey: 'builder_feedback_issue_topic_other' },
];

export const FEEDBACK_TOPICS: TopicOption[] = [
  { key: 'Editor & design', i18nKey: 'builder_feedback_share_topic_editor' },
  { key: 'AI assistant', i18nKey: 'builder_feedback_share_topic_ai' },
  { key: 'Publishing & domains', i18nKey: 'builder_feedback_share_topic_publishing' },
  { key: 'Credits & pricing', i18nKey: 'builder_feedback_share_topic_credits' },
  { key: 'Integrations', i18nKey: 'builder_feedback_share_topic_integrations' },
  { key: 'Overall experience', i18nKey: 'builder_feedback_share_topic_overall' },
];

export const getBaseUrl = () => {
  const hostname = window.location.hostname;
  const envPrefix = hostname.includes('dev-') ? 'dev-' : hostname.includes('test-') ? 'test-' : '';
  return `https://api.companion.hub.${envPrefix}godaddy.com/v1/`;
};

/**
 * Extract appId from the current URL path (/[market]/develop/[id]/...) as a fallback
 * when the app context store hasn't populated currentAppId yet (e.g. partial page load).
 */
export const getAppIdFromUrl = (): string | null => {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const developIndex = segments.indexOf('develop');
  return developIndex !== -1 && segments[developIndex + 1] ? segments[developIndex + 1] : null;
};

/**
 * Get the current FullStory session URL
 * @param now - If true, returns URL pointing to current moment in session
 * @returns Promise that resolves to FullStory session URL or null if not available
 */
export const getFullStorySessionUrl = async (now = true): Promise<string | null> => {
  try {
    if (typeof window === 'undefined' || !window.FS) {
      return null;
    }
    // Use async version to ensure session is initialized
    const format = now ? 'url.now' : 'url';
    const sessionUrl = await window.FS('getSessionAsync', { format });
    return sessionUrl || null;
  } catch (error) {
    // FullStory may not be initialized yet or is disabled
    return null;
  }
};

/**
 * Constant prefix of a FullStory replay URL. The session token returned by
 * {@link getFullStorySessionId} is everything after this, so a full, openable
 * replay URL is `FULLSTORY_SESSION_URL_PREFIX + <token>`. Org id `YKBRC` matches
 * `FullStoryProvider`'s `init({ orgId: 'YKBRC' })`.
 */
export const FULLSTORY_SESSION_URL_PREFIX = 'https://app.fullstory.com/ui/YKBRC/client-session/';

/**
 * Get the FullStory session token: the final path segment of the `url.now`
 * replay URL, stripped of the constant {@link FULLSTORY_SESSION_URL_PREFIX}.
 *
 * The token is `<sessionId>:<clientId>:<timestamp>` with each `:` percent-encoded
 * as `%3A`. It is returned VERBATIM (still encoded) so a viewer can rebuild the
 * exact replay URL by pasting `FULLSTORY_SESSION_URL_PREFIX + token` into a
 * browser — decoding would produce a non-identical URL. The trailing
 * `:<timestamp>` is the moment anchor. We take the last path segment rather than
 * matching a specific marker, to stay robust across the `/session/` vs
 * `/client-session/` path variants across FullStory SDK versions.
 *
 * Returns null when FullStory is unavailable (e.g. local dev).
 */
export const getFullStorySessionId = async (): Promise<string | null> => {
  const sessionUrl = await getFullStorySessionUrl(true);
  if (!sessionUrl) {
    return null;
  }
  // The token is the final path segment; strip any trailing query/hash first.
  const pathOnly = sessionUrl.split(/[?#]/)[0].replace(/\/+$/, '');
  const lastSlash = pathOnly.lastIndexOf('/');
  if (lastSlash === -1) {
    return null;
  }
  const token = pathOnly.slice(lastSlash + 1);
  return token || null;
};


