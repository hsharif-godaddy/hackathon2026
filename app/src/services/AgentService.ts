import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'

export interface Conversation {
  id: string
  appId: string
  updatedAt: string
  messageCount?: number
}

export interface ConversationDetail {
  conversation: Conversation
  messages: any[]
}

export class AgentService {
  private static instance: AgentService

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService()
    }
    return AgentService.instance
  }

  /**
   * Load all conversations for an app
   */
  async getConversations(appId: string): Promise<Conversation[]> {
    // Conversations endpoint is global under /agent/, not app-specific
    const { dynamicApiConfigService } = await import('@/config/dynamic-api')
    const config = await dynamicApiConfigService.getConfigForSite(appId)
    // Remove the app-specific path and use the base agent URL
    const baseAgentUrl = config.agentUrl.replace(`/apps/${appId}`, '')
    const apiUrl = `${baseAgentUrl}/agent/conversations/${appId}`

    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to fetch conversations: ${response.status}`)
    }

    const data = await response.json()
    logger.debug('agent.conversations.response', {
      message: 'Raw response from agent service',
      dataType: typeof data,
      isArray: Array.isArray(data),
      hasConversations: !!data.conversations,
      conversationsCount: Array.isArray(data.conversations) ? data.conversations.length : 0
    });

    // Try both possible response structures
    if (Array.isArray(data)) {
      logger.debug('agent.conversations.direct-array', { message: 'Response is direct array, returning data' });
      return data
    } else if (data.conversations && Array.isArray(data.conversations)) {
      logger.debug('agent.conversations.property', { message: 'Response has conversations property, returning data.conversations' });
      return data.conversations
    } else {
      logger.warn('agent.conversations.unexpected-structure', {
        message: 'Unexpected response structure, returning empty array',
        dataType: typeof data,
        hasConversations: !!data.conversations,
        isArray: Array.isArray(data)
      }, {
        data: { responseData: data }
      });
      return []
    }
  }

  /**
   * Get the latest conversation for an app
   * Used when no conversationId is available
   */
  async getLatestConversation(appId: string): Promise<Conversation | null> {
    const { dynamicApiConfigService } = await import('@/config/dynamic-api')
    const config = await dynamicApiConfigService.getConfigForSite(appId)
    const baseAgentUrl = config.agentUrl.replace(`/apps/${appId}`, '')
    const apiUrl = `${baseAgentUrl}/agent/conversations/${appId}?limit=1`

    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to fetch latest conversation: ${response.status}`)
    }

    const data = await response.json()

    // Return the first conversation if it exists
    if (data.conversations && data.conversations.length > 0) {
      return data.conversations[0]
    }

    return null
  }

  /**
   * Get a specific conversation with all messages
   * Used for HTTP fallback when agents don't support WebSocket history
   */
  async getConversation(appId: string, conversationId: string): Promise<ConversationDetail> {
    // Conversations endpoint is global under /agent/, not app-specific
    const { dynamicApiConfigService } = await import('@/config/dynamic-api')
    const config = await dynamicApiConfigService.getConfigForSite(appId)
    // Remove the app-specific path and use the base agent URL
    const baseAgentUrl = config.agentUrl.replace(`/apps/${appId}`, '')
    const apiUrl = `${baseAgentUrl}/agent/conversations/${appId}/${conversationId}`

    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to fetch conversation: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(appId: string, conversationId: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(`agent/conversations/${conversationId}`, appId);

    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'DELETE'
    })

    if (!response.ok) {
      throw new Error(`Failed to delete conversation: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Download the generated launch video as a Blob, proxied through the agents
   * server to avoid CORS restrictions on the preview container URL.
   */
  async downloadVideo(appId: string): Promise<Blob> {
    const apiUrl = await buildDynamicApiUrl(`/video`, appId);

    const response = await agentFetch(apiUrl, { siteId: appId, method: 'GET' });

    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.status}`);
    }

    return response.blob();
  }

  /**
   * Delete the generated launch video and its metadata cache so the next
   * generateLaunchVideo call runs a fresh pipeline instead of returning cached.
   */
  async deleteVideo(appId: string): Promise<void> {
    const apiUrl = await buildDynamicApiUrl(`/video`, appId);

    const response = await agentFetch(apiUrl, { siteId: appId, method: 'DELETE' });

    if (!response.ok) {
      throw new Error(`Failed to delete video: ${response.status}`);
    }
  }

  /**
   * Start or poll video generation for an app (non-blocking, idempotent)
   */
  async generateLaunchVideo(appId: string, publishedUrl?: string): Promise<VideoGenerationResponse> {
    const apiUrl = await buildDynamicApiUrl(`/generate-video`, appId);

    logger.info('generateLaunchVideo', { apiUrl, publishedUrl });

    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publishedUrl })
    })

    if (!response.ok) {
      throw new Error(`Failed to generate video: ${response.status}`)
    }

    return response.json()
  }
}

/**
 * Video generation status
 */
export type VideoStatus = 'pending' | 'queued' | 'in_progress' | 'completed' | 'failed';

/**
 * Video generation response from API
 */
export interface VideoGenerationResponse {
  success: boolean;
  status: VideoStatus;
  url?: string;
  error?: string;
}

// Export a singleton instance for convenience
export const agentService = AgentService.getInstance()
