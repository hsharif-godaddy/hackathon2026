/**
 * Conversation Bridge
 * Bridges ai-lib agent responses with the existing conversation persistence system
 */

import { ConversationRepository } from '../../database/repositories/ConversationRepository.js'
import type { EnhancedAgentContext } from './types.js'
import type { AgentResult } from '@airo/ai-lib'
import { nanoid } from 'nanoid'

/**
 * Conversation Bridge Class
 * Handles saving ai-lib agent interactions to the database
 */
export class ConversationBridge {
  private conversationRepo: ConversationRepository

  constructor() {
    this.conversationRepo = new ConversationRepository()
  }

  /**
   * Optimize streaming events by collapsing consecutive chunks
   */
  private optimizeStreamingEvents(events: Array<{
    type: string
    content?: string
    data?: any
    timestamp?: Date
  }>): Array<{
    type: string
    content?: string
    data?: any
    timestamp?: Date
    originalChunkCount?: number
  }> {
    const optimized: Array<{
      type: string
      content?: string
      data?: any
      timestamp?: Date
      originalChunkCount?: number
    }> = []

    let currentChunkGroup: {
      content: string
      firstTimestamp: Date
      lastTimestamp: Date
      count: number
      data?: any
    } | null = null

    const flushChunkGroup = () => {
      if (currentChunkGroup && currentChunkGroup.content) {
        optimized.push({
          type: 'collapsed_chunks',
          content: currentChunkGroup.content,
          timestamp: currentChunkGroup.firstTimestamp,
          data: currentChunkGroup.data,
          originalChunkCount: currentChunkGroup.count
        })
        currentChunkGroup = null
      }
    }

    for (const event of events) {
      if (event.type === 'chunk' || event.type === 'text_chunk') {
        // Accumulate consecutive chunks
        if (!currentChunkGroup) {
          currentChunkGroup = {
            content: event.content || '',
            firstTimestamp: event.timestamp || new Date(),
            lastTimestamp: event.timestamp || new Date(),
            count: 1,
            data: event.data
          }
        } else {
          currentChunkGroup.content += event.content || ''
          currentChunkGroup.lastTimestamp = event.timestamp || new Date()
          currentChunkGroup.count++
        }
      } else {
        // Non-chunk event - flush any accumulated chunks first
        flushChunkGroup()
        
        // Add the non-chunk event as-is
        optimized.push(event)
      }
    }

    // Flush any remaining chunk group
    flushChunkGroup()

    return optimized
  }

  /**
   * Create or get conversation for the current context
   */
  async ensureConversation(
    appId: string, 
    agentId: string, 
    context: EnhancedAgentContext
  ): Promise<string> {
    // Check if we have an existing conversation ID in context
    const existingConversationId = context.conversation?.conversationId
    
    if (existingConversationId) {
      // Verify the conversation exists
      const existing = await this.conversationRepo.getById(existingConversationId)
      if (existing) {
        return existingConversationId
      }
    }

    // Create new conversation
    const conversation = await this.conversationRepo.create(
      appId, 
      agentId, 
      `Chat with ${agentId} - ${new Date().toLocaleString()}`
    )
    
    return conversation.id
  }

  /**
   * Save user message to conversation
   */
  async saveUserMessage(
    conversationId: string,
    message: string,
    context: EnhancedAgentContext
  ): Promise<string> {
    const messageId = nanoid(12)
    
    // Create user message
    await this.conversationRepo.addMessage(conversationId, 'user', message, {
      metadata: {
        context: {
          aiEditContext: context.aiEditContext,
          visualContext: context.visualContext,
          appContext: context.appContext
        }
      }
    })

    return messageId
  }

  /**
   * Save agent response from streaming events
   * Simplified approach for UI compatibility
   */
  async saveAgentResponse(
    conversationId: string,
    agentId: string,
    streamingEvents: Array<{
      type: string
      content?: string
      data?: any
      timestamp?: Date
    }>,
    finalResult?: any
  ): Promise<string> {
    const messageId = nanoid(12)
    
    // Optimize streaming events by collapsing consecutive chunks
    const optimizedEvents = this.optimizeStreamingEvents(streamingEvents)
    
    console.log('📊 Event optimization:', {
      originalEvents: streamingEvents.length,
      optimizedEvents: optimizedEvents.length,
      reduction: `${Math.round((1 - optimizedEvents.length / streamingEvents.length) * 100)}%`
    })
    
    // Simplified processing for UI compatibility
    const segments: any[] = []
    const toolCalls: any[] = []
    const toolsMap = new Map() // Track tools by ID to avoid duplicates
    let accumulatedContent = ''
    
    for (const event of optimizedEvents) {
      const timestamp = event.timestamp || new Date()
      
      switch (event.type) {
        case 'chunk':
        case 'text_chunk':
        case 'collapsed_chunks':
          if (event.content) {
            accumulatedContent += event.content
            // Create simple content segments for UI
            segments.push({
              id: nanoid(8),
              type: 'content',
              content: event.content,
              timestamp,
              metadata: event.type === 'collapsed_chunks' ? {
                originalChunkCount: event.originalChunkCount,
                isCollapsed: true 
              } : undefined
            })
          }
          break
          
        case 'tool_start':
          if (event.data?.tool) {
            const toolId = event.data.tool.id || nanoid(8)
            const toolData = {
              id: toolId,
              name: event.data.tool.name,           // UI expects 'name'
              input: event.data.tool.input,         // UI expects 'input'
              status: 'running',                    // UI expects 'status'
              startTime: timestamp                  // UI expects 'startTime' (camelCase)
            }
            
            toolsMap.set(toolId, toolData)
            
            // Add tool segment for chronological display with UI-compatible structure
            segments.push({
              id: nanoid(8),
              type: 'tool_call',
              timestamp,
              toolCall: toolData                   // UI expects 'toolCall' (camelCase)
            })
          }
          break
          
        case 'tool_result':
          if (event.data?.tool) {
            const toolId = event.data.tool.id
            const existingTool = toolsMap.get(toolId)
            
            if (existingTool) {
              // Update tool with result using UI-compatible field names
              existingTool.input = event.data.tool.input || existingTool.input  // Update input if available
              existingTool.result = event.data.tool.output || event.content || event.data.tool.result  // UI expects 'result'
              existingTool.status = 'completed'                              // UI expects 'status'
              existingTool.endTime = timestamp                               // UI expects 'endTime' (camelCase)
              
              // Calculate duration if we have both start and end times
              if (existingTool.startTime && timestamp) {
                const startTime = new Date(existingTool.startTime).getTime()
                const endTime = new Date(timestamp).getTime()
                existingTool.duration = endTime - startTime
              } else {
                existingTool.duration = event.data.tool.duration || undefined  // Only set if valid
              }
              
              // Update the corresponding segment
              const segmentIndex = segments.findIndex(s => 
                s.type === 'tool_call' && s.toolCall?.id === toolId
              )
              if (segmentIndex >= 0) {
                segments[segmentIndex].toolCall = existingTool
              }
            }
          }
          break
          
        // Skip step events - they add complexity without UI benefit
        case 'step_start':
        case 'step_complete':
          // Don't create segments for these - they're not used by the UI
          break
      }
    }
    
    // Convert tools map to array for storage
    toolCalls.push(...Array.from(toolsMap.values()))

    console.log('💾 Saving simplified agent message:', {
      conversationId,
      contentLength: accumulatedContent.length,
      segmentsCount: segments.length,
      toolCallsCount: toolCalls.length,
      toolNames: toolCalls.map(t => t.name)
    })

    // Create agent message with simplified structure
    await this.conversationRepo.addMessage(conversationId, 'agent', accumulatedContent, {
      segments,
      toolCalls,
      metadata: {
        agentId,
        finalResult,
        streamingEvents: streamingEvents.length
      }
    })

    console.log('✅ Simplified agent message saved successfully to database')

    return messageId
  }

  /**
   * Update conversation title based on content
   */
  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    try {
      await this.conversationRepo.updateTitle(conversationId, title)
    } catch (error) {
      console.warn('Failed to update conversation title:', error)
    }
  }

  /**
   * Get conversation history for context
   */
  async getConversationHistory(
    conversationId: string, 
    maxMessages: number = 10
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    try {
      const messages = await this.conversationRepo.getMessages(conversationId)
      
      // Take the most recent messages
      const recentMessages = messages.slice(-maxMessages)
      
      return recentMessages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.content || ''
      }))
    } catch (error) {
      console.error('Failed to get conversation history:', error)
      return []
    }
  }

  /**
   * Get conversation summary for debugging
   */
  async getConversationSummary(conversationId: string): Promise<{
    id: string
    messageCount: number
    lastActivity: Date | null
    title?: string
  }> {
    try {
      const conversation = await this.conversationRepo.getById(conversationId)
      const messages = await this.conversationRepo.getMessages(conversationId)
      
      return {
        id: conversationId,
        messageCount: messages.length,
        lastActivity: messages.length > 0 ? messages[messages.length - 1]?.createdAt || null : null,
        ...(conversation?.title && { title: conversation.title })
      }
    } catch (error) {
      console.error('Failed to get conversation summary:', error)
      return {
        id: conversationId,
        messageCount: 0,
        lastActivity: null
      }
    }
  }
}
