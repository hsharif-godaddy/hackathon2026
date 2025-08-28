import { buildApiUrl } from '@/config/api'

export interface Conversation {
  id: string
  appId: string
  updatedAt: string
  messageCount?: number
}

export interface ConversationDetail {
  id: string
  appId: string
  messages: any[] // Using any[] to match existing message types
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
    const response = await fetch(buildApiUrl(`agent/conversations/${appId}`))
    
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
    const response = await fetch(buildApiUrl(`agent/conversations/${appId}/${conversationId}`))
    
    if (!response.ok) {
      throw new Error(`Failed to fetch conversation: ${response.status}`)
    }
    
    return response.json()
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: string): Promise<{ success: boolean; message?: string }> {
    const response = await fetch(buildApiUrl(`agent/conversations/${conversationId}`), {
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
