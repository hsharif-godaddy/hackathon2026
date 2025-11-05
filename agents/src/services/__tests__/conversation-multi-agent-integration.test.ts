/**
 * Multi-Agent Conversation History Integration Test
 * 
 * Tests that conversation history is properly isolated between different agents
 * for the same app, ensuring each agent only sees their own conversation history.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js'
import { ConversationContextManager } from '../ConversationContextManager.js'
import { AgentsMessagePersistence } from '../../server/conversation-persistence.js'
import { getDatabase } from '../../database/connection.js'
import type { ConversationContext } from '@airo/ai-lib'

describe('Multi-Agent Conversation History Integration', () => {
  let conversationRepo: ConversationRepository
  let contextManager: ConversationContextManager
  let persistence: AgentsMessagePersistence
  let testAppId: string
  let developConversationId: string
  let designConversationId: string

  beforeEach(async () => {
    conversationRepo = new ConversationRepository()
    contextManager = new ConversationContextManager(conversationRepo, 10)
    persistence = new AgentsMessagePersistence()
    
    testAppId = 'test-app-multi-agent'
    
    const db = getDatabase()
    const now = new Date().toISOString()
    
    db.prepare(`
      INSERT OR REPLACE INTO apps (id, name, path, port, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(testAppId, 'Multi-Agent Test App', '/test/multi-agent', 5000, 'created', now, now)
    
    const developConv = await conversationRepo.create(testAppId, 'develop', 'Develop Agent Chat')
    developConversationId = developConv.id
    
    const designConv = await conversationRepo.create(testAppId, 'design', 'Design Agent Chat')
    designConversationId = designConv.id
  })

  afterEach(() => {
    const db = getDatabase()
    db.prepare('DELETE FROM conversation_messages WHERE conversation_id IN (?, ?)').run(developConversationId, designConversationId)
    db.prepare('DELETE FROM conversations WHERE id IN (?, ?)').run(developConversationId, designConversationId)
    db.prepare('DELETE FROM apps WHERE id = ?').run(testAppId)
  })

  it('should isolate conversation history between different agents for the same app', async () => {
    await conversationRepo.addMessage(developConversationId, 'user', 'Create a login component', {
      metadata: { agentId: 'develop' }
    })
    await conversationRepo.addMessage(developConversationId, 'agent', 'I will create a login component for you.', {
      metadata: { agentId: 'develop' }
    })
    
    await conversationRepo.addMessage(designConversationId, 'user', 'Design a modern button', {
      metadata: { agentId: 'design' }
    })
    await conversationRepo.addMessage(designConversationId, 'agent', 'I will design a modern button with gradients.', {
      metadata: { agentId: 'design' }
    })

    const historyLoader = contextManager.getHistoryLoader()
    const developMessages = await historyLoader.loadMessagesWithTokenLimit(testAppId, 'develop', 40000)
    
    expect(developMessages.length).toBeGreaterThan(0)
    const developUserMessage = developMessages.find(m => m.role === 'user' && m.content.includes('login component'))
    const developAssistantMessage = developMessages.find(m => m.role === 'assistant' && m.content.includes('create a login component'))
    
    expect(developUserMessage).toBeDefined()
    expect(developAssistantMessage).toBeDefined()
    
    const developHasDesignMessages = developMessages.some(m => 
      m.content.includes('modern button') || m.content.includes('gradients')
    )
    expect(developHasDesignMessages).toBe(false)

    const designMessages = await historyLoader.loadMessagesWithTokenLimit(testAppId, 'design', 40000)
    
    expect(designMessages.length).toBeGreaterThan(0)
    const designUserMessage = designMessages.find(m => m.role === 'user' && m.content.includes('modern button'))
    const designAssistantMessage = designMessages.find(m => m.role === 'assistant' && m.content.includes('gradients'))
    
    expect(designUserMessage).toBeDefined()
    expect(designAssistantMessage).toBeDefined()
    
    const designHasDevelopMessages = designMessages.some(m => 
      m.content.includes('login component')
    )
    expect(designHasDevelopMessages).toBe(false)
  })

  it('should properly persist conversations through the persistence layer', async () => {
    const developContext: ConversationContext = {
      socketId: 'socket-develop-1',
      appId: testAppId,
      agentName: 'develop',
      userId: 'test-user',
      conversation: {
        conversationId: developConversationId
      }
    }

    await persistence.continueConversation(
      developConversationId,
      'Add a logout button to the component',
      developContext
    )

    const mockStreamingEvents = [
      { type: 'chunk', content: 'I will add a logout button. ', timestamp: new Date() },
      { type: 'chunk', content: 'Let me update the component.', timestamp: new Date() }
    ]

    await persistence.completeConversation(
      developConversationId,
      mockStreamingEvents,
      { success: true },
      developContext
    )

    const messages = await conversationRepo.getMessages(developConversationId)
    
    expect(messages.length).toBeGreaterThan(0)
    
    const userMessage = messages.find(m => m.sender === 'user' && m.content.includes('logout button'))
    expect(userMessage).toBeDefined()
    
    const agentMessage = messages.find(m => m.sender === 'agent' && m.content.includes('add a logout button'))
    expect(agentMessage).toBeDefined()
  })

  it('should handle multiple conversations for the same agent', async () => {
    const conversation1 = await conversationRepo.create(testAppId, 'develop', 'First Develop Chat')
    const conversation2 = await conversationRepo.create(testAppId, 'develop', 'Second Develop Chat')

    try {
      await conversationRepo.addMessage(conversation1.id, 'user', 'First conversation message', {
        metadata: { agentId: 'develop' }
      })
      await conversationRepo.addMessage(conversation1.id, 'agent', 'Response to first conversation', {
        metadata: { agentId: 'develop' }
      })
      
      await conversationRepo.addMessage(conversation2.id, 'user', 'Second conversation message', {
        metadata: { agentId: 'develop' }
      })
      await conversationRepo.addMessage(conversation2.id, 'agent', 'Response to second conversation', {
        metadata: { agentId: 'develop' }
      })

      const historyLoader = contextManager.getHistoryLoader()
      const allDevelopMessages = await historyLoader.loadMessagesWithTokenLimit(testAppId, 'develop', 40000)
      
      expect(allDevelopMessages.length).toBeGreaterThanOrEqual(4)
      
      const hasFirstConv = allDevelopMessages.some(m => m.content.includes('First conversation'))
      const hasSecondConv = allDevelopMessages.some(m => m.content.includes('Second conversation'))
      
      expect(hasFirstConv).toBe(true)
      expect(hasSecondConv).toBe(true)
    } finally {
      const db = getDatabase()
      db.prepare('DELETE FROM conversation_messages WHERE conversation_id IN (?, ?)').run(conversation1.id, conversation2.id)
      db.prepare('DELETE FROM conversations WHERE id IN (?, ?)').run(conversation1.id, conversation2.id)
    }
  })

  it('should properly create conversations with correct agent_id', async () => {
    const developConv = await conversationRepo.getById(developConversationId)
    expect(developConv).not.toBeNull()
    expect(developConv!.agentId).toBe('develop')
    expect(developConv!.appId).toBe(testAppId)

    const designConv = await conversationRepo.getById(designConversationId)
    expect(designConv).not.toBeNull()
    expect(designConv!.agentId).toBe('design')
    expect(designConv!.appId).toBe(testAppId)

    const developConversations = await conversationRepo.findByAppAndAgent(testAppId, 'develop')
    const developIds = developConversations.map(c => c.id)
    expect(developIds).toContain(developConversationId)
    expect(developIds).not.toContain(designConversationId)

    const designConversations = await conversationRepo.findByAppAndAgent(testAppId, 'design')
    const designIds = designConversations.map(c => c.id)
    expect(designIds).toContain(designConversationId)
    expect(designIds).not.toContain(developConversationId)
  })

  it('should start new conversation through persistence layer with correct agent context', async () => {
    const newDevelopContext: ConversationContext = {
      socketId: 'socket-develop-new',
      appId: testAppId,
      agentName: 'develop',
      userId: 'test-user'
    }

    const newConversationId = await persistence.startConversation(
      'Help me refactor this code',
      newDevelopContext
    )

    expect(newConversationId).toBeDefined()
    expect(typeof newConversationId).toBe('string')

    const newConversation = await conversationRepo.getById(newConversationId)
    expect(newConversation).not.toBeNull()
    expect(newConversation!.agentId).toBe('develop')
    expect(newConversation!.appId).toBe(testAppId)

    const messages = await conversationRepo.getMessages(newConversationId)
    expect(messages.length).toBeGreaterThan(0)
    
    const userMessage = messages.find(m => m.sender === 'user')
    expect(userMessage).toBeDefined()
    expect(userMessage!.content).toContain('refactor this code')

    const db = getDatabase()
    db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(newConversationId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(newConversationId)
  })

  it('should retrieve conversation history with existing conversationId in context', async () => {
    await conversationRepo.addMessage(developConversationId, 'user', 'Previous message about routing', {
      metadata: { agentId: 'develop' }
    })
    await conversationRepo.addMessage(developConversationId, 'agent', 'I helped you with routing before.', {
      metadata: { agentId: 'develop' }
    })

    const contextWithHistory: ConversationContext = {
      socketId: 'socket-develop-continue',
      appId: testAppId,
      agentName: 'develop',
      userId: 'test-user',
      conversation: {
        conversationId: developConversationId
      }
    }

    const returnedConversationId = await persistence.startConversation(
      'Now help me with state management',
      contextWithHistory
    )

    expect(returnedConversationId).toBe(developConversationId)

    const allMessages = await conversationRepo.getMessages(developConversationId)
    
    const hasPreviousMessage = allMessages.some(m => m.content.includes('routing'))
    expect(hasPreviousMessage).toBe(true)
    
    const hasNewMessage = allMessages.some(m => m.content.includes('state management'))
    expect(hasNewMessage).toBe(true)
  })
})
