/**
 * Route Discovery Utility
 *
 * Discovers application routes by parsing routes.tsx file.
 */

import { appService } from '@/services/AppService'
import { logger } from '@/lib/request-context'

/**
 * Discover routes from the app's routes.tsx file
 *
 * Parses routes.tsx to extract route paths, filtering out catch-all
 * routes (*) and error pages (404).
 *
 * @param appId - App ID to read routes file for
 * @returns Array of route paths, defaults to ['/'] if discovery fails
 */
export async function discoverRoutes(appId: string): Promise<string[]> {
  try {
    const result = await appService.readFile(appId, 'src/routes.tsx')
    const routePattern = /path:\s*['"`]([^'"`]+)['"`]/g
    const routes: string[] = []
    let match

    while ((match = routePattern.exec(result.content)) !== null) {
      const path = match[1]
      if (path !== '*' && !path.includes('404') && !path.includes('_404')) {
        routes.push(path)
      }
    }

    return routes.length > 0 ? routes : ['/']
  } catch (error) {
    logger.debug('analytics.routes.discovery-failed', {
      appId,
      error: error instanceof Error ? error.message : String(error)
    })
    return ['/']
  }
}

/**
 * Get routes to query for analytics
 *
 * Always includes "/" route and merges with discovered routes.
 *
 * @param appId - App ID for route discovery
 * @returns Array of unique routes to query
 */
export async function getRoutesToQuery(appId?: string | null): Promise<string[]> {
  if (!appId) {
    return ['/']
  }

  try {
    const discoveredRoutes = await discoverRoutes(appId)
    const uniqueRoutes = new Set(['/', ...discoveredRoutes])
    return Array.from(uniqueRoutes)
  } catch {
    return ['/']
  }
}

