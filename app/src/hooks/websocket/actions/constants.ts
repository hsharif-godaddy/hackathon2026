/**
 * Client Action Constants
 *
 * Centralized action names to avoid magic strings and typos.
 */

export const CLIENT_ACTIONS = {
  PUBLISH: 'publish',
  GET_SITE_DATA: 'getSiteData',
  ATTACH_DOMAIN: 'attachDomain',
  MCP_CALL: 'mcp_call',
  CONVERSATIONS_CALL: 'conversationsCall',
} as const

export type ClientAction = typeof CLIENT_ACTIONS[keyof typeof CLIENT_ACTIONS]
