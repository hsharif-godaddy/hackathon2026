import { agentFetch } from '@/lib/agent-fetch'
import { buildApiUrl } from '@/config/api'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { logger } from '@/lib/request-context'

/**
 * Centralized Agent API Handler
 * 
 * This class handles all communication with agent APIs, providing a unified interface
 * for URL building and error handling.
 */
export class AgentApiHandler {
  private static instance: AgentApiHandler
  
  public static getInstance(): AgentApiHandler {
    if (!AgentApiHandler.instance) {
      AgentApiHandler.instance = new AgentApiHandler()
    }
    return AgentApiHandler.instance
  }

  /**
   * Build the appropriate URL for an agent API call
   */
  private async buildAgentUrl(endpoint: string, siteId?: string): Promise<string> {
    if (siteId) {
      return await buildDynamicApiUrl(endpoint, siteId)
    } else {
      return buildApiUrl(endpoint)
    }
  }

  /**
   * Make a GET request to an agent API
   */
  async get(endpoint: string, siteId?: string): Promise<Response> {
    if (!siteId) {
      throw new Error('siteId is required for agent API calls')
    }
    const url = await this.buildAgentUrl(endpoint, siteId)
    return await agentFetch(url, {
      siteId,
      method: 'GET'
    })
  }

  /**
   * Make a POST request to an agent API
   */
  async post(endpoint: string, body?: unknown, siteId?: string): Promise<Response> {
    if (!siteId) {
      throw new Error('siteId is required for agent API calls')
    }
    const url = await this.buildAgentUrl(endpoint, siteId)
    
    const requestOptions = {
      siteId,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    } as any

    if (body) {
      requestOptions.body = JSON.stringify(body)
    }

    return await agentFetch(url, requestOptions)
  }

  /**
   * Make a PUT request to an agent API
   */
  async put(endpoint: string, body?: unknown, siteId?: string): Promise<Response> {
    if (!siteId) {
      throw new Error('siteId is required for agent API calls')
    }
    const url = await this.buildAgentUrl(endpoint, siteId)
    
    const requestOptions = {
      siteId,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
    } as any

    if (body) {
      requestOptions.body = JSON.stringify(body)
    }

    return await agentFetch(url, requestOptions)
  }

  /**
   * Make a DELETE request to an agent API
   */
  async delete(endpoint: string, siteId?: string): Promise<Response> {
    if (!siteId) {
      throw new Error('siteId is required for agent API calls')
    }
    const url = await this.buildAgentUrl(endpoint, siteId)
    
    const requestOptions = {
      siteId,
      method: 'DELETE'
    }

    return await agentFetch(url, requestOptions)
  }

  /**
   * Safely parse JSON response, handling empty responses
   */
  async safeJsonParse(response: Response, defaultValue: unknown = null): Promise<unknown> {
    const contentLength = response.headers.get('content-length')
    const contentType = response.headers.get('content-type')
    
    // If there's no content or it's not JSON, return default value
    if (contentLength === '0' || !contentType?.includes('application/json')) {
      return defaultValue
    }
    
    try {
      return await response.json()
    } catch (parseError) {
      logger.warn('agent_api_handler', 'Failed to parse JSON response, using default value', { error: parseError as Error })
      return defaultValue
    }
  }

  /**
   * Helper method to handle standard API responses
   * Throws an error if response is not ok, otherwise returns parsed JSON
   */
  async handleResponse<T>(response: Response, errorMessage?: string): Promise<T> {
    if (!response.ok) {
      let error = errorMessage || `API call failed: ${response.status}`
      
      try {
        const errorData = await response.json()
        error = errorData.error || errorData.message || error
      } catch {
        // Can't parse error response, use default message
      }
      
      throw new Error(error)
    }

    return await response.json()
  }

  /**
   * Get agent API info for debugging
   */
  getDebugInfo(): { directConnection: boolean } {
    return {
      directConnection: true // All calls now go directly to agent APIs with proper SSL certificates
    }
  }
}

// Export a singleton instance for convenience
export const agentApiHandler = AgentApiHandler.getInstance()
