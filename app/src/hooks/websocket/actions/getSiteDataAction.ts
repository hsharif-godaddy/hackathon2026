/**
 * Get Site Data Action Executor
 *
 * Fetches site data including published URL.
 * Used by agents to access MySQL-stored site information.
 */

import { logger } from '@/lib/request-context'
import { useSiteStore } from '@/stores/useSiteStore'
import type { ClientActionExecutor } from './types'

export const getSiteDataAction: ClientActionExecutor = async (params) => {
  const { appId } = params

  // Validate required parameters
  if (!appId || typeof appId !== 'string') {
    throw new Error('appId is required and must be a string')
  }

  logger.info('websocket.client-action.get-site-data.begin', {
    appId,
  })

  try {
    // Get site data from store (which fetches from MySQL via /api/sites/[id])
    const site = useSiteStore.getState().getSite(appId)

    if (!site) {
      logger.warn('websocket.client-action.get-site-data.not-found', {
        appId,
      })
      throw new Error('Site not found')
    }

    logger.info('websocket.client-action.get-site-data.success', {
      appId,
      hasPublishedUrl: !!site.published_url,
    })

    // Return relevant site data
    return {
      publishedUrl: site.published_url,
      domains: site.domains,
      variants: site.variants,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error('websocket.client-action.get-site-data.error', {
      appId,
      error: errorMessage,
    })
    throw error
  }
}
