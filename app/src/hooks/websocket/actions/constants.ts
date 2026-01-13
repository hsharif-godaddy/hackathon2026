/**
 * Client Action Constants
 *
 * Centralized action names to avoid magic strings and typos.
 */

export const CLIENT_ACTIONS = {
  PUBLISH: 'publish',
  GET_SITE_DATA: 'getSiteData',
} as const

export type ClientAction = typeof CLIENT_ACTIONS[keyof typeof CLIENT_ACTIONS]
