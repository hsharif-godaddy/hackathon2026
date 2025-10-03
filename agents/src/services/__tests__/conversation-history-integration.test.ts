/**
 * Integration test for conversation history functionality
 * Tests the complete flow from frontend conversation loading to backend history inclusion
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConversationRepository } from '../../database/repositories/ConversationRepository.js'
import { ConversationContextManager } from '../ConversationContextManager.js'
import { EnhancedAgentContext } from '../../agents/ai-lib-agents/types.js'
import { getDatabase, closeDatabase } from '../../database/connection.js'
import { nanoid } from 'nanoid'

describe('Conversation History Integration', () => {
  let conversationRepo: ConversationRepository
  let contextManager: ConversationContextManager
  let testAppId: string
  let testConversationId: string

  beforeEach(async () => {
    conversationRepo = new ConversationRepository()
    contextManager = new ConversationContextManager(conversationRepo, 5)
    
    testAppId = 'test-app-123'
    
    // Create a test app first (needed for foreign key constraint)
    const db = getDatabase()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT OR REPLACE INTO apps (id, name, path, port, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(testAppId, 'Test App', '/test/path', 5000, 'created', now, now)
    
    // Create a test conversation
    const conversation = await conversationRepo.create(testAppId, 'develop', 'Test Conversation')
    testConversationId = conversation.id
  })

  afterEach(() => {
    // Clean up test data
    const db = getDatabase()
    db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(testConversationId)
    db.prepare('DELETE FROM conversations WHERE id = ?').run(testConversationId)
    db.prepare('DELETE FROM apps WHERE id = ?').run(testAppId)
  })

  it('should create conversation and include history in context messages', async () => {
    // Step 1: Simulate conversation creation (as done by the frontend)
    const enhancedContext: EnhancedAgentContext = {
      metadata: {
        appId: testAppId,
        agentId: 'develop',
        userId: 'test-user',
        sessionId: 'test-session'
      }
    }

    // Step 2: Add some conversation history
    await conversationRepo.addMessage(testConversationId, 'user', 'Hello, I need help with my React app', {
      metadata: enhancedContext.metadata
    })
    await conversationRepo.addMessage(testConversationId, 'agent', 'I can help you with your React app! What specific issue are you facing?', {
      metadata: { agentId: 'develop' }
    })
    
    await conversationRepo.addMessage(testConversationId, 'user', 'I want to add a dark mode toggle', {
      metadata: enhancedContext.metadata
    })
    await conversationRepo.addMessage(testConversationId, 'agent', 'Great! I can help you implement a dark mode toggle. Let me create the necessary components and state management.', {
      metadata: { agentId: 'develop' }
    })

    // Step 3: Simulate new message with conversation context (as done by WebSocket handler)
    const systemPrompt = 'You are a helpful development assistant.'
    const currentUserMessage = 'Can you make the toggle button more accessible?'
    
    const contextMessages = await contextManager.buildMessages(
      systemPrompt,
      currentUserMessage,
      testConversationId,
      undefined, // no aiEditContext
      enhancedContext
    )

    // Verify the structure
    expect(contextMessages).toHaveLength(6) // system + 4 history messages + current user message
    expect(contextMessages[0].role).toBe('system')
    expect(contextMessages[0].content).toBe(systemPrompt)
    
    // Verify conversation history is included in correct order
    expect(contextMessages[1].role).toBe('user')
    expect(contextMessages[1].content).toBe('Hello, I need help with my React app')
    
    expect(contextMessages[2].role).toBe('assistant')
    expect(contextMessages[2].content).toBe('I can help you with your React app! What specific issue are you facing?')
    
    expect(contextMessages[3].role).toBe('user')
    expect(contextMessages[3].content).toBe('I want to add a dark mode toggle')
    
    expect(contextMessages[4].role).toBe('assistant')
    expect(contextMessages[4].content).toBe('Great! I can help you implement a dark mode toggle. Let me create the necessary components and state management.')
    
    // Verify current message is at the end
    expect(contextMessages[5].role).toBe('user')
    expect(contextMessages[5].content).toBe(currentUserMessage)
  })

  it('should handle conversation lookup by appId correctly', async () => {
    // This tests the fix for the frontend conversation lookup issue
    
    // Create another test app
    const db = getDatabase()
    const now = new Date().toISOString()
    db.prepare(`
      INSERT OR REPLACE INTO apps (id, name, path, port, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('other-app', 'Other App', '/other/path', 5001, 'created', now, now)
    
    // Create multiple conversations for different apps
    const otherAppConversation = await conversationRepo.create('other-app', 'develop', 'Other App Chat')
    
    // Get conversations for our test app (simulating frontend API call)
    const conversations = await conversationRepo.getConversationsWithMessageCount(testAppId)
    
    // Verify we only get conversations for the correct app
    expect(conversations).toHaveLength(1)
    expect(conversations[0].appId).toBe(testAppId)
    expect(conversations[0].id).toBe(testConversationId)
    
    // Verify the conversation has the expected structure (matching frontend interface)
    const conversation = conversations[0]
    expect(conversation).toHaveProperty('id')
    expect(conversation).toHaveProperty('appId')
    expect(conversation).toHaveProperty('agentId')
    expect(conversation).toHaveProperty('createdAt')
    expect(conversation).toHaveProperty('updatedAt')
    expect(conversation).toHaveProperty('messageCount')
    
    // Clean up
    await conversationRepo.delete(otherAppConversation.id)
    db.prepare('DELETE FROM apps WHERE id = ?').run('other-app')
  })

  it('should handle missing conversation gracefully', async () => {
    const systemPrompt = 'You are a helpful assistant.'
    const currentUserMessage = 'Hello'
    const nonExistentConversationId = 'non-existent-conv-id'
    
    const enhancedContext: EnhancedAgentContext = {
      metadata: {
        appId: testAppId,
        agentId: 'develop',
        userId: 'test-user',
        sessionId: 'test-session'
      }
    }

    const contextMessages = await contextManager.buildMessages(
      systemPrompt,
      currentUserMessage,
      nonExistentConversationId,
      undefined,
      enhancedContext
    )

    // Should still work, just without history
    expect(contextMessages).toHaveLength(2) // system + current user message
    expect(contextMessages[0].role).toBe('system')
    expect(contextMessages[1].role).toBe('user')
    expect(contextMessages[1].content).toBe(currentUserMessage)
  })

  it('should respect message limit configuration', async () => {
    const enhancedContext: EnhancedAgentContext = {
      metadata: {
        appId: testAppId,
        agentId: 'develop',
        userId: 'test-user',
        sessionId: 'test-session'
      }
    }

    // Add more messages than the limit (5 pairs = 10 messages)
    for (let i = 1; i <= 7; i++) {
      await conversationRepo.addMessage(testConversationId, 'user', `User message ${i}`, {
        metadata: enhancedContext.metadata
      })
      await conversationRepo.addMessage(testConversationId, 'agent', `Agent response ${i}`, {
        metadata: { agentId: 'develop' }
      })
    }

    const systemPrompt = 'You are a helpful assistant.'
    const currentUserMessage = 'Current message'
    
    const contextMessages = await contextManager.buildMessages(
      systemPrompt,
      currentUserMessage,
      testConversationId,
      undefined,
      enhancedContext
    )

    // Should have system + max 10 history messages (5 pairs) + current message
    // But since we limit to last N messages, it should be less than all 14
    expect(contextMessages.length).toBeLessThanOrEqual(13) // system + 10 history + current + app context
    expect(contextMessages[0].role).toBe('system')
    expect(contextMessages[contextMessages.length - 1].content).toBe(currentUserMessage)
  })

  it('should handle conversation creation when no conversationId provided', async () => {
    const newConversation = await conversationRepo.create(testAppId, 'develop', 'New Test Conversation')
    const newConversationId = newConversation.id
    
    expect(newConversationId).toBeDefined()
    expect(typeof newConversationId).toBe('string')
    
    const conversation = await conversationRepo.getById(newConversationId)
    expect(conversation).not.toBeNull()
    expect(conversation!.appId).toBe(testAppId)
    expect(conversation!.agentId).toBe('develop')
    
    await conversationRepo.delete(newConversationId)
  })
})
