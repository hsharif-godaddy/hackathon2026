/**
 * Client Action Constants
 *
 * Centralized action names to avoid magic strings and typos.
 */

export const CLIENT_ACTIONS = {
  PUBLISH: 'publish',
  GET_SITE_DATA: 'getSiteData',
  ATTACH_DOMAIN: 'attachDomain',
  CHECK_DOMAIN_OWNERSHIP: 'checkDomainOwnership',
  MCP_CALL: 'mcp_call',
  INBOX_CALL: 'inboxCall',
  SCREENSHOT: 'screenshot',
  AUDIT: 'audit',
  FETCH_GOOGLE_REVIEWS: 'fetch_google_reviews',
} as const

export type ClientAction = typeof CLIENT_ACTIONS[keyof typeof CLIENT_ACTIONS]
