// FullStory URL helpers shared between server (scorecard-client) and client (ScorecardEventFeed).
// Keep this file free of Node-only APIs so it can be imported in both contexts.

export const FS_ORG_ID = 'YKBRC';

// Matches: https://app.fullstory.com/ui/{org}/session/{userId}:{sessionId}:{timestampMs}
// Accepts both numeric (12345:67890:...) and UUID (abc-uuid:def-uuid:...) segment formats.
export const FS_SESSION_RE = /^https:\/\/app\.fullstory\.com\/ui\/[^/]+\/session\/[^/:?#]+:[^/:?#]+:\d{10,}$/;

/**
 * Build a direct FullStory session-search URL filtered by appId custom variable.
 * Opens in the browser UI without requiring an API key.
 */
export function buildFsSearchUrl(appId: string): string {
  return `https://app.fullstory.com/ui/${FS_ORG_ID}/sessions?customVarFilters=${encodeURIComponent(`appId=${appId}`)}`;
}

/**
 * Replace the trailing epoch-ms segment in a FullStory session URL with the
 * event's own timestamp to deep-link to that exact moment in the recording.
 * Returns the original URL unchanged if the format doesn't match or the
 * timestamp is invalid.
 */
export function buildFsDeepLink(sessionUrl: string, eventTimestamp: string): string {
  const tsMs = new Date(eventTimestamp).getTime();
  if (isNaN(tsMs) || !FS_SESSION_RE.test(sessionUrl)) return sessionUrl;
  return sessionUrl.replace(/:\d+$/, `:${tsMs}`);
}
