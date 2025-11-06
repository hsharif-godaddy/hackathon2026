import { buildDynamicAgentUrl, buildDynamicApiUrl } from '@/config/dynamic-api'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { type ServerStatusType } from '@/stores/useServerStore'
import { type AppStatusType } from '@/stores/useAppStore'
import { useSitesStore } from '@/stores/useSitesStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { agentFetch } from '@/lib/agent-fetch'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { buildApiUrl } from '@/config/api'
import { type AiroDeploymentStatus } from '@/lib/mgmt-airo'

export interface App {
  id: string
  name: string
  port: number
  initialPrompt?: string
  status: AppStatusType
  initialBuildComplete?: boolean
  createdAt: string
  updatedAt: string
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

export interface AppConfig {
  showUsageCost: boolean
}

export interface StyleUpdateData {
  selector: string
  property: string
  value: string
  newClassName: string
  newStyle?: string
  elementInfo?: unknown
}

export interface TextUpdateData {
  selector: string
  preciseSelector?: string
  oldText: string
  newText: string
  devContext: Record<string, unknown>
}

export interface CreateAppData {
  name: string
  initialPrompt: string
}

export interface AppStatusData {
  id: string
  status: AppStatusType
  name: string
  port?: number
  createdAt: string
  updatedAt: string
}

export interface TokenUsage {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  totalCost: number
  operationCounts: {
    llm_request: number
    file_edit: number
    tool_execution: number
  }
  lastUsed: string | null
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  size?: number
  lastModified?: string
}

export interface ServerInfo {
  appId: string
  port: number
  url: string
  status?: ServerStatusType
  lastActivity?: string
}

export class AppService {
  private static instance: AppService

  public static getInstance(): AppService {
    if (!AppService.instance) {
      AppService.instance = new AppService()
    }
    return AppService.instance
  }

  /**
   * Safely parse JSON response, handling empty responses
   */
  private async safeJsonParse(response: Response, defaultValue: unknown = null): Promise<unknown> {
    const contentLength = response.headers.get('content-length')
    const contentType = response.headers.get('content-type')

    // If there's no content or it's not JSON, return default value
    if (contentLength === '0' || !contentType?.includes('application/json')) {
      return defaultValue
    }

    try {
      return await response.json()
    } catch (parseError) {
      logger.warn('app.config.parse-error', { message: 'Failed to parse JSON response, using default value', parseError: parseError instanceof Error ? parseError.message : 'Unknown error' });
      return defaultValue
    }
  }

  /**
   * Fetch app details by ID
   */
  async getApp(appId: string): Promise<{ app: App }> {
    const apiUrl = await buildDynamicApiUrl(``, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to fetch app: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Fetch app configuration
   */
  async getConfig(siteId?: string): Promise<{ config: AppConfig }> {
    let url: string
    let response: Response

    if (siteId) {
      // Config is global, but we need to use the correct agent base URL
      const { dynamicApiConfigService } = await import('@/config/dynamic-api')
      const config = await dynamicApiConfigService.getConfigForSite(siteId)
      // Remove the app-specific path and use the base agent URL
      const baseAgentUrl = config.agentUrl.replace(`/apps/${siteId}`, '')
      url = `${baseAgentUrl}/apps/config`

      // Use agentFetch for agent API calls
      response = await agentFetch(url, { siteId })
    } else {
      url = buildApiUrl('apps/config')

      // Use appFetch for app backend API calls
      response = await appFetch(url)
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Ensure app is running
   */
  async ensureAppIsRunning(appId: string): Promise<{ success: boolean; action?: string; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(`ensure-running`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to ensure app is running: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Restart app server
   */
  async restartApp(appId: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(`restart`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to restart server: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get git commit history for an app
   */
  async getGitHistory(appId: string): Promise<{ commits: GitCommit[] }> {
    const apiUrl = await buildDynamicApiUrl(`git/history`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to load commit history: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Checkout a specific git commit
   */
  async checkoutCommit(appId: string, commitHash: string): Promise<void> {
    const apiUrl = await buildDynamicAgentUrl(`apps/${appId}/git/checkout`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitHash })
    })

    if (!response.ok) {
      throw new Error(`Failed to checkout commit: ${response.status}`)
    }
  }

  /**
   * Return to main branch (latest version)
   */
  async returnToMainBranch(appId: string): Promise<void> {
    const apiUrl = await buildDynamicAgentUrl(`apps/${appId}/git/return`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' })
    })

    if (!response.ok) {
      throw new Error(`Failed to return to latest version: ${response.status}`)
    }
  }

  /**
   * Restore files from a specific commit
   */
  async restoreCommit(appId: string, commitHash: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicAgentUrl(`apps/${appId}/git/restore`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitHash })
    })

    if (!response.ok) {
      throw new Error(`Failed to restore files from commit: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Publish app by creating an archive and triggering deployment
   *
   * This method calls the app service's publish endpoint which:
   * 1. Creates a git archive via the agents service
   * 2. Notifies mgmt-airo to trigger deployment (if V2 site)
   *
   * @param {string} appId - The ID of the app to publish
   * @param {string} commitHash - The git commit hash to publish (can be short or full hash)
   * @returns {Promise<Object>} Response containing success status, commitHash, archive path, and optional deployment info
   * @throws {Error} If the publish operation fails
   *
   * @example
   * ```typescript
   * const result = await appService.publishApp('app-123', 'a1b2c3d4');
   * console.log('Archive created:', result.archive.path);
   * if (result.deployment) {
   *   console.log('Deployment ID:', result.deployment.deploymentId);
   * }
   * ```
   */
  async publishApp(appId: string, commitHash: string): Promise<{
    success: boolean;
    commitHash: string;
    archive: { path: string };
    deployment?: {
      deploymentId: string;
      statusJobId: string;
      status: AiroDeploymentStatus;
      message: string;
    }
  }> {
    const response = await appFetch(`/api/apps/${appId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitHash })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Failed to publish app: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Update element styles
   */
  async updateStyles(appId: string, styleData: StyleUpdateData): Promise<unknown> {
    const requestBody = {
      selector: styleData.selector,
      property: styleData.property,
      value: styleData.value,
      newClassName: styleData.newClassName,
      newStyle: styleData.newStyle,
      elementInfo: styleData.elementInfo
    };

    const apiUrl = await buildDynamicApiUrl(`styles/edit`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`Failed to send style update to API: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Update element text content
   */
  async updateText(appId: string, textData: TextUpdateData): Promise<unknown> {
    const requestBody = {
      selector: textData.selector,
      preciseSelector: textData.preciseSelector,
      oldText: textData.oldText,
      newText: textData.newText,
      devContext: textData.devContext
    };

    const apiUrl = await buildDynamicApiUrl(`text/edit`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`Failed to send text update to API: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Create a new app
   */
  async createApp(appData: CreateAppData): Promise<Response> {
    return await appFetch(buildApiUrl('apps/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appData)
    });
  }

  /**
   * Get app status (for polling during creation)
   */
  async getAppStatus(appId: string): Promise<AppStatusData> {
    // appId is the same as siteId in our system
    const apiUrl = await buildDynamicApiUrl(`status`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to get app status: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get token usage for an app
   */
  async getTokenUsage(appId: string): Promise<{ usage: TokenUsage }> {
    const apiUrl = await buildDynamicApiUrl(`usage`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to fetch usage data: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get file tree for an app
   */
  async getFiles(appId: string, maxDepth: number = 5): Promise<{ entries: Array<{name: string; isDirectory: boolean; path: string; depth: number}> }> {
    const apiUrl = await buildDynamicApiUrl(`files?maxDepth=${maxDepth}`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to load files: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Read file content
   */
  async readFile(appId: string, filePath: string): Promise<{ content: string }> {
    const apiUrl = await buildDynamicApiUrl(`files/read?path=${encodeURIComponent(filePath)}`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to load file content: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Write file content
   */
  async writeFile(appId: string, filePath: string, content: string, mode: string = 'rewrite'): Promise<{ success: boolean }> {
    const requestBody = { path: filePath, content, mode };
    const apiUrl = await buildDynamicApiUrl(`files/write`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`Failed to save file: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get all apps
   */
  async getAllApps(): Promise<{ apps: App[] }> {
    const response = await appFetch(buildApiUrl('apps'))

    if (!response.ok) {
      throw new Error(`Failed to fetch apps: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get running servers
   */
  async getServers(): Promise<{ servers: ServerInfo[] }> {
    // Call local API route instead of external service
    const response = await appFetch('/api/servers')

    if (!response.ok) {
      throw new Error(`Failed to fetch servers: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Stop an app
   */
  async stopApp(appId: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(`stop`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to stop app: ${response.status}`)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'App stopped successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Delete an app
   */
  async deleteApp(appId: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(``, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'DELETE'
    })

    if (!response.ok) {
      let errorMessage = `Failed to delete app: ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.message || errorData.error || errorMessage
      } catch {
        // Unable to parse error response, use default message
      }
      throw new Error(errorMessage)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'App deleted successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Stop all running apps
   */
  async stopAllApps(): Promise<{ success: boolean; message?: string }> {
    const response = await appFetch(buildApiUrl('apps/stop-all'), {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to stop all apps: ${response.status}`)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'All apps stopped successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Cleanup orphaned apps
   */
  async cleanupOrphans(): Promise<{ success: boolean; message?: string }> {
    const response = await appFetch(buildApiUrl('apps/cleanup-orphans'), {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to cleanup orphaned apps: ${response.status}`)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'Cleanup completed successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Update app name with AI suggestion and register the app
   *
   * This function performs three main operations:
   * 1. Gets an AI-suggested name based on the initial prompt
   * 2. Updates the name in the database and UI stores
   * 3. Registers the app with the agent
   *
   * @param appId - The ID of the app to update and register
   * @returns Promise that resolves when all operations are complete
   *
   * @throws {Error} If any of the API calls fail
   */
  async updateNameAndRegister(appId: string): Promise<void> {
    try {
      logger.info('develop-page.name-update.start', {
        message: 'Starting async name suggestion and registration',
        appId
      })

      // Get fresh site data with initial_prompt
      const siteStore = useSiteStore.getState()
      const freshSite = await siteStore.fetchSite(appId, true)

      if (!freshSite?.agent_url) {
        logger.warn('develop-page.name-update.no-agent-url', {
          message: 'No agent URL available, skipping name update'
        })
        return
      }

      if (!freshSite.initial_prompt) {
        logger.info('develop-page.name-update.no-prompt', {
          message: 'No initial prompt, skipping name suggestion'
        })
        return
      }

      // Call name suggestion API
      logger.info('develop-page.name-update.calling-api', {
        message: 'Requesting name suggestion from agent'
      })

      const suggestResponse = await agentFetch(`${freshSite.agent_url}/apps/suggest-name`, {
        siteId: appId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: freshSite.initial_prompt
        })
      })

      if (!suggestResponse.ok) {
        logger.warn('develop-page.name-update.suggestion-failed', {
          message: 'Name suggestion API call failed',
          status: suggestResponse.status
        })
        return
      }

      const nameData = await suggestResponse.json()
      const suggestedName = nameData.name || nameData.suggestedName

      if (!suggestedName) {
        logger.warn('develop-page.name-update.no-name', {
          message: 'No suggested name returned from API'
        })
        return
      }

      logger.info('develop-page.name-update.got-suggestion', {
        message: 'Got suggested name from agent',
        suggestedName
      })

      // Update site name in database
      try {
        const updateResponse = await appFetch(`/api/sites/${appId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: suggestedName })
        })

        if (updateResponse.ok) {
          logger.info('develop-page.name-update.db-updated', {
            message: 'Site name updated in database',
            suggestedName
          })
        } else {
          logger.warn('develop-page.name-update.db-update-failed', {
            message: 'Failed to update site name in database, continuing with UI and registration'
          })
        }
      } catch (dbError) {
        logger.warn('develop-page.name-update.db-error', {
          message: 'Error updating database, continuing with UI and registration',
          error: dbError instanceof Error ? dbError.message : 'Unknown error'
        })
      }

      // Update UI state in multiple stores
      siteStore.updateSite(appId, { name: suggestedName })

      // Update the sites list store (used by dropdown)
      await useSitesStore.getState().refreshSites()

      // Update the develop page store's local site state
      useDevelopPageStore.setState((state) => {
        if (state.site) {
          state.site.name = suggestedName
        }
      })

      // Call register endpoint with updated name (in all modes)
      logger.info('develop-page.name-update.registering', {
        message: 'Registering app with updated name'
      })

      const registerResponse = await agentFetch(`${freshSite.agent_url}/apps/register`, {
        siteId: appId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: appId,
          name: suggestedName,
          initialPrompt: freshSite.initial_prompt,
          previewUrl: freshSite.preview_url
        })
      })

      if (registerResponse.ok) {
        logger.info('develop-page.name-update.registered', {
          message: 'App registered successfully with new name',
          suggestedName
        })
      } else {
        logger.warn('develop-page.name-update.registration-failed', {
          message: 'App registration failed',
          status: registerResponse.status
        })
      }

    } catch (error) {
      logger.error('develop-page.name-update.error', {
        message: 'Error during name update flow',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}

// Export a singleton instance for convenience
export const appService = AppService.getInstance()
