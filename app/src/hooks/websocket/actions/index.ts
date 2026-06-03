/**
 * Client Action Executors Registry
 *
 * Central registry of all client-side action executors.
 * Add new actions here to make them available to agents.
 */

export * from './attachDomainAction'
export * from './constants'
export * from './getSiteDataAction'
export * from './inboxAction'
export * from './mcpCallAction'
export * from './publishAction'
export * from './types'

import { attachDomainAction } from './attachDomainAction'
import { CLIENT_ACTIONS } from './constants'
import { getSiteDataAction } from './getSiteDataAction'
import { inboxAction } from './inboxAction'
import { mcpCallAction } from './mcpCallAction'
import { publishAction } from './publishAction'
import type { ClientActionExecutor } from './types'

/**
 * Registry of all available client action executors
 * Key: action name (used in client_action messages)
 * Value: executor function
 */
export const clientActionExecutors: Record<string, ClientActionExecutor> = {
  [CLIENT_ACTIONS.PUBLISH]: publishAction,
  [CLIENT_ACTIONS.GET_SITE_DATA]: getSiteDataAction,
  [CLIENT_ACTIONS.ATTACH_DOMAIN]: attachDomainAction,
  [CLIENT_ACTIONS.MCP_CALL]: mcpCallAction,
  [CLIENT_ACTIONS.INBOX_CALL]: inboxAction,
}
