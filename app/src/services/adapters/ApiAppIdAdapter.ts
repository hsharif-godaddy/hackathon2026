/**
 * API-based app ID adapter
 * 
 * Resolves job IDs to app IDs by checking the API response
 * Uses multiple indicators to determine if an ID is a real app ID
 */
import { SiteStatus } from '@/lib/control-plane/types'
import { logger } from '@/lib/request-context'
import { IAppIdAdapter } from './IAppIdAdapter'

export class ApiAppIdAdapter implements IAppIdAdapter {
  /**
   * Resolves any ID (job ID or app ID) to the correct app ID for API operations
   * 
   * Instead of relying on string length, we check if:
   * 1. The ID resolves to a site with a different ID (job ID → app ID transition)
   * 2. The site has agent_url (indicating it's ready for file operations)
   * 3. The site status is 'running' (indicating it's fully provisioned)
   * 
   * @param id - The original ID (could be job ID or app ID)
   * @param operation - The operation being performed (for logging)
   * @returns The resolved app ID to use for API calls
   */
  async resolveAppId(id: string, operation: string): Promise<string> {
    if (!id) return id
    
    try {
      // Use centralized site store to prevent duplicate requests
      const { useSiteStore } = await import('@/stores/useSiteStore')
      const siteStore = useSiteStore.getState()
      const site = await siteStore.fetchSite(id)
      
      if (site) {
        
        // Three cases where we should use the ID from the API response:
        // 1. If site.id is different from id (job ID → app ID transition)
        // 2. If site has agent_url (indicating it's ready for file operations)
        // 3. If site.status is 'running' (indicating it's fully provisioned)
        if (site.id && (
            (site.id !== id) || // Different ID (job → app transition)
            site.agent_url ||   // Has agent URL (ready for file operations)
            site.status === SiteStatus.Running // Site is running
        )) {
          // Only log if we're actually changing the ID
          if (site.id !== id) {
            logger.info(`app-id-adapter.${operation}.using-real-app-id`, {
              message: 'Using real app ID instead of job ID for file access',
              originalId: id,
              realAppId: site.id,
              hasAgentUrl: !!site.agent_url,
              status: site.status
            })
          }
          return site.id
        }
      } else {
        // If the ID doesn't resolve at all, it might be an invalid ID
        // Just return it and let the file operation fail naturally
        logger.warn(`app-id-adapter.${operation}.id-not-found`, {
          message: 'ID not found in API, using as-is',
          id
        })
      }
    } catch (error) {
      // If there's an error, just return the original ID
      logger.warn(`app-id-adapter.${operation}.id-check-failed`, {
        message: 'Failed to check for real app ID, using original',
        id,
        error: error instanceof Error ? error.message : String(error)
      })
    }
    
    // If we couldn't find a real app ID, return the original
    return id
  }
}
