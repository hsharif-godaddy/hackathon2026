/**
 * Client Action Executors Registry
 *
 * Central registry of all client-side action executors.
 * Add new actions here to make them available to agents.
 */

export * from './types'
export * from './constants'
export * from './publishAction'
export * from './getSiteDataAction'

import { CLIENT_ACTIONS } from './constants'
import { publishAction } from './publishAction'
import { getSiteDataAction } from './getSiteDataAction'
import type { ClientActionExecutor } from './types'

/**
 * Registry of all available client action executors
 * Key: action name (used in client_action messages)
 * Value: executor function
 */
export const clientActionExecutors: Record<string, ClientActionExecutor> = {
  [CLIENT_ACTIONS.PUBLISH]: publishAction,
  [CLIENT_ACTIONS.GET_SITE_DATA]: getSiteDataAction,
}
