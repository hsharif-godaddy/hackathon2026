import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'
import type { AgentConversationMessagePayload } from '@/types/agent-conversation'

export interface Conversation {
  id: string
  appId: string
  updatedAt: string
  messageCount?: number
}

export interface ConversationDetail {
  id: string
  appId: string
  messages?: AgentConversationMessagePayload[]
  createdAt: string
  updatedAt: string
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
   * Load a specific conversation
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
}

// Export a singleton instance for convenience
export const agentService = AgentService.getInstance()
