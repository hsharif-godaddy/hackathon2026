import { buildDynamicApiUrl } from '@/config/dynamic-api'

export interface Conversation {
  id: string
  appId: string
  updatedAt: string
  messageCount?: number
}

export interface ConversationDetail {
  id: string
  appId: string
  messages: unknown[] // Using unknown[] to match existing message types
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
    
    const response = await fetch(apiUrl)
    
    if (!response.ok) {
      throw new Error(`Failed to fetch conversations: ${response.status}`)
    }
    
    const data = await response.json()
    console.log('🔍 AgentService.getConversations - raw response:', data)
    console.log('🔍 AgentService.getConversations - data.conversations:', data.conversations)
    console.log('🔍 AgentService.getConversations - data type:', typeof data, Array.isArray(data))
    
    // Try both possible response structures
    if (Array.isArray(data)) {
      console.log('✅ Response is direct array, returning data')
      return data
    } else if (data.conversations && Array.isArray(data.conversations)) {
      console.log('✅ Response has conversations property, returning data.conversations')
      return data.conversations
    } else {
      console.log('⚠️ Unexpected response structure, returning empty array')
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
    
    const response = await fetch(apiUrl)
    
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
    
    const response = await fetch(apiUrl, {
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
