import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initializeTestDatabase } from '../../schema.js'

vi.mock('../../connection.js')

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis()
    })
  },
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

let idCounter = 0
vi.mock('nanoid', () => ({
  nanoid: vi.fn().mockImplementation(() => `test-msg-${++idCounter}`)
}))

describe('ConversationRepository - Single Conversation Per App', () => {
  let testDb: Database.Database
  let repo: InstanceType<typeof import('../ConversationRepository.js').ConversationRepository>

  function createApp(appId: string) {
    testDb.prepare(`
      INSERT INTO apps (id, name, path, port, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(appId, 'Test App', '/tmp/test', 3000, 'created')
  }

  beforeEach(async () => {
    idCounter = 0
    testDb = new Database(':memory:')
    initializeTestDatabase(testDb)

    const { getDatabase } = await import('../../connection.js')
    vi.mocked(getDatabase).mockReturnValue(testDb as any)

    const { ConversationRepository } = await import('../ConversationRepository.js')
    repo = new ConversationRepository()
  })

  afterEach(() => {
    if (testDb) {
      try {
        testDb.close()
      } catch {
        // ignore
      }
    }
    vi.resetModules()
  })

  describe('getLatestForApp', () => {
    it('should return most recently updated conversation', async () => {
      createApp('app-123')

      // Create three conversations with different timestamps
      const conv1 = await repo.create('app-123', 'initial', 'First')
      const conv2 = await repo.create('app-123', 'develop', 'Second')
      const conv3 = await repo.create('app-123', 'develop', 'Third')

      // Set explicit timestamps with clear ordering (conv2 is most recent)
      testDb.prepare(`
        UPDATE conversations
        SET updated_at = datetime('2024-01-01 10:00:00')
        WHERE id = ?
      `).run(conv1.id)

      testDb.prepare(`
        UPDATE conversations
        SET updated_at = datetime('2024-01-01 12:00:00')
        WHERE id = ?
      `).run(conv2.id)

      testDb.prepare(`
        UPDATE conversations
        SET updated_at = datetime('2024-01-01 11:00:00')
        WHERE id = ?
      `).run(conv3.id)

      const latest = await repo.getLatestForApp('app-123')

      expect(latest).toBeTruthy()
      expect(latest!.id).toBe(conv2.id)
      expect(latest!.title).toBe('Second')
    })

    it('should return null for app with no conversations', async () => {
      const latest = await repo.getLatestForApp('nonexistent-app')
      expect(latest).toBeNull()
    })

    it('should isolate conversations by app', async () => {
      createApp('app-123')
      createApp('app-456')

      await repo.create('app-123', 'initial', 'App 123 Conv')
      const conv456 = await repo.create('app-456', 'initial', 'App 456 Conv')

      const latest = await repo.getLatestForApp('app-456')

      expect(latest).toBeTruthy()
      expect(latest!.id).toBe(conv456.id)
      expect(latest!.title).toBe('App 456 Conv')
    })
  })

  describe('getOrCreateForApp', () => {
    it('should return existing conversation with isNew=false', async () => {
      createApp('app-123')
      const existing = await repo.create('app-123', 'initial', 'Existing')

      const result = await repo.getOrCreateForApp('app-123', 'develop', 'New Title')

      expect(result.isNew).toBe(false)
      expect(result.conversation.id).toBe(existing.id)
      expect(result.conversation.title).toBe('Existing') // Should keep original title
    })

    it('should create new conversation with isNew=true when none exists', async () => {
      createApp('app-123')

      const result = await repo.getOrCreateForApp('app-123', 'initial', 'First Conv')

      expect(result.isNew).toBe(true)
      expect(result.conversation.title).toBe('First Conv')
      expect(result.conversation.appId).toBe('app-123')
      expect(result.conversation.agentId).toBe('initial')
    })

    it('should reuse latest conversation even if multiple exist', async () => {
      createApp('app-123')

      const conv1 = await repo.create('app-123', 'initial', 'First')
      const conv2 = await repo.create('app-123', 'develop', 'Second')

      // Make conv1 more recent with explicit timestamp
      testDb.prepare(`
        UPDATE conversations
        SET updated_at = datetime('2024-01-01 12:00:00')
        WHERE id = ?
      `).run(conv1.id)

      testDb.prepare(`
        UPDATE conversations
        SET updated_at = datetime('2024-01-01 11:00:00')
        WHERE id = ?
      `).run(conv2.id)

      const result = await repo.getOrCreateForApp('app-123', 'develop', 'Third')

      expect(result.isNew).toBe(false)
      expect(result.conversation.id).toBe(conv1.id)
    })
  })

  describe('updateAgentId', () => {
    it('should update agent_id and updated_at on handoff', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      // Set an old timestamp so we can reliably detect the update
      testDb.prepare(`
        UPDATE conversations
        SET updated_at = datetime('2024-01-01 10:00:00')
        WHERE id = ?
      `).run(conv.id)

      // Re-read to get the old timestamp
      const beforeUpdate = await repo.getById(conv.id)
      const oldTimestamp = beforeUpdate!.updatedAt.toISOString()

      await repo.updateAgentId(conv.id, 'develop')

      const updated = await repo.getById(conv.id)

      expect(updated).toBeTruthy()
      expect(updated!.agentId).toBe('develop')
      // Verify timestamp was updated (should be different from old timestamp)
      expect(updated!.updatedAt.toISOString()).not.toBe(oldTimestamp)
    })

    it('should handle multiple handoffs', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      await repo.updateAgentId(conv.id, 'develop')
      await repo.updateAgentId(conv.id, 'design')
      await repo.updateAgentId(conv.id, 'marketing')

      const updated = await repo.getById(conv.id)

      expect(updated!.agentId).toBe('marketing')
    })
  })

  describe('getMessageCount', () => {
    it('should return 0 for empty conversation', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Empty Conv')

      const count = await repo.getMessageCount(conv.id)

      expect(count).toBe(0)
    })

    it('should return correct count for conversation with messages', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Conv with Messages')

      await repo.addMessage(conv.id, 'user', 'Hello')
      await repo.addMessage(conv.id, 'agent', 'Hi there')
      await repo.addMessage(conv.id, 'user', 'How are you?')

      const count = await repo.getMessageCount(conv.id)

      expect(count).toBe(3)
    })

    it('should return 0 for nonexistent conversation', async () => {
      const count = await repo.getMessageCount('nonexistent-conv')

      expect(count).toBe(0)
    })

    it('should isolate message counts by conversation', async () => {
      createApp('app-123')
      const conv1 = await repo.create('app-123', 'initial', 'Conv 1')
      const conv2 = await repo.create('app-123', 'initial', 'Conv 2')

      await repo.addMessage(conv1.id, 'user', 'Message 1')
      await repo.addMessage(conv1.id, 'user', 'Message 2')
      await repo.addMessage(conv2.id, 'user', 'Message 3')

      const count1 = await repo.getMessageCount(conv1.id)
      const count2 = await repo.getMessageCount(conv2.id)

      expect(count1).toBe(2)
      expect(count2).toBe(1)
    })
  })

describe('getMessagesAfterMessageId', () => {
    it('should return empty array when reference message not found', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')
      await repo.addMessage(conv.id, 'user', 'Message 1')

      const messages = await repo.getMessagesAfterMessageId('app-123', 'nonexistent-msg')

      expect(messages).toEqual([])
    })

    it('should return messages after reference message', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      const msg1 = await repo.addMessage(conv.id, 'user', 'Message 1')
      const msg2 = await repo.addMessage(conv.id, 'agent', 'Message 2')
      const msg3 = await repo.addMessage(conv.id, 'user', 'Message 3')
      const msg4 = await repo.addMessage(conv.id, 'agent', 'Message 4')

      const messages = await repo.getMessagesAfterMessageId('app-123', msg2.id)

      expect(messages).toHaveLength(2)
      expect(messages[0].id).toBe(msg3.id)
      expect(messages[1].id).toBe(msg4.id)
    })

    it('should handle messages from multiple conversations', async () => {
      createApp('app-123')
      const conv1 = await repo.create('app-123', 'initial', 'Conv 1')
      const conv2 = await repo.create('app-123', 'initial', 'Conv 2')

      const msg1 = await repo.addMessage(conv1.id, 'user', 'Conv1 Msg1')
      await repo.addMessage(conv1.id, 'agent', 'Conv1 Msg2')
      const msg3 = await repo.addMessage(conv2.id, 'user', 'Conv2 Msg1')
      const msg4 = await repo.addMessage(conv1.id, 'user', 'Conv1 Msg3')

      const messages = await repo.getMessagesAfterMessageId('app-123', msg1.id)

      // Should get messages from both conversations
      expect(messages.length).toBeGreaterThanOrEqual(2)
      const messageIds = messages.map(m => m.id)
      expect(messageIds).toContain(msg3.id)
      expect(messageIds).toContain(msg4.id)
    })

    it('should return messages in chronological order', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      const msg1 = await repo.addMessage(conv.id, 'user', 'Message 1')
      await new Promise(resolve => setTimeout(resolve, 10)) // Ensure different timestamps
      const msg2 = await repo.addMessage(conv.id, 'agent', 'Message 2')
      await new Promise(resolve => setTimeout(resolve, 10))
      const msg3 = await repo.addMessage(conv.id, 'user', 'Message 3')

      const messages = await repo.getMessagesAfterMessageId('app-123', msg1.id)

      expect(messages).toHaveLength(2)
      expect(messages[0].id).toBe(msg2.id)
      expect(messages[1].id).toBe(msg3.id)
      expect(messages[0].createdAt.getTime()).toBeLessThan(messages[1].createdAt.getTime())
    })

    it('should return empty array when no messages after reference', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      const msg1 = await repo.addMessage(conv.id, 'user', 'Message 1')
      const msg2 = await repo.addMessage(conv.id, 'agent', 'Message 2')

      const messages = await repo.getMessagesAfterMessageId('app-123', msg2.id)

      expect(messages).toEqual([])
    })

    it('should only return messages for specified app', async () => {
      createApp('app-123')
      createApp('app-456')

      const conv1 = await repo.create('app-123', 'initial', 'App1 Conv')
      const conv2 = await repo.create('app-456', 'initial', 'App2 Conv')

      const msg1 = await repo.addMessage(conv1.id, 'user', 'App1 Msg1')
      await repo.addMessage(conv1.id, 'agent', 'App1 Msg2')
      await repo.addMessage(conv2.id, 'user', 'App2 Msg1')

      const messages = await repo.getMessagesAfterMessageId('app-123', msg1.id)

      // Should only get messages from app-123
      messages.forEach(msg => {
        expect(msg.conversationId).toBe(conv1.id)
      })
    })

    it('should include message segments and metadata', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      const msg1 = await repo.addMessage(conv.id, 'user', 'Message 1')
      const msg2 = await repo.addMessage(conv.id, 'agent', 'Message 2', {
        segments: [
          {
            id: 'seg-1',
            type: 'content',
            content: 'Response text',
            timestamp: new Date()
          }
        ]
      })

      const messages = await repo.getMessagesAfterMessageId('app-123', msg1.id)

      expect(messages).toHaveLength(1)
      expect(messages[0].segments).toBeDefined()
      expect(messages[0].segments).toHaveLength(1)
    })

    it('should handle messages with same timestamp using rowid', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      // Insert messages directly with same timestamp to test rowid ordering
      const timestamp = new Date().toISOString()
      const msg1Id = 'msg-same-time-1'
      const msg2Id = 'msg-same-time-2'
      const msg3Id = 'msg-same-time-3'

      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg1Id, conv.id, 'user', 'Same time 1', timestamp)

      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg2Id, conv.id, 'agent', 'Same time 2', timestamp)

      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(msg3Id, conv.id, 'user', 'Same time 3', timestamp)

      const messages = await repo.getMessagesAfterMessageId('app-123', msg1Id)

      // Should get msg2 and msg3, not msg1
      expect(messages).toHaveLength(2)
      expect(messages[0].id).toBe(msg2Id)
      expect(messages[1].id).toBe(msg3Id)
    })
  })

  describe('getRecentMessagesForApp', () => {
    it('should return empty array when no conversations exist', async () => {
      createApp('app-123')

      const messages = await repo.getRecentMessagesForApp('app-123', 20)

      expect(messages).toEqual([])
    })

    it('should return recent messages limited by count', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      await repo.addMessage(conv.id, 'user', 'Message 1')
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.addMessage(conv.id, 'agent', 'Message 2')
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.addMessage(conv.id, 'user', 'Message 3')

      const messages = await repo.getRecentMessagesForApp('app-123', 2)

      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('Message 2')
      expect(messages[1].content).toBe('Message 3')
    })

    it('should return messages in chronological order', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      await repo.addMessage(conv.id, 'user', 'First')
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.addMessage(conv.id, 'agent', 'Second')
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.addMessage(conv.id, 'user', 'Third')

      const messages = await repo.getRecentMessagesForApp('app-123', 20)

      expect(messages).toHaveLength(3)
      expect(messages[0].content).toBe('First')
      expect(messages[1].content).toBe('Second')
      expect(messages[2].content).toBe('Third')
    })

    it('should merge messages from multiple conversations', async () => {
      createApp('app-123')
      const conv1 = await repo.create('app-123', 'initial', 'Conv 1')
      const conv2 = await repo.create('app-123', 'develop', 'Conv 2')

      await repo.addMessage(conv1.id, 'user', 'Conv1 Msg1')
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.addMessage(conv2.id, 'user', 'Conv2 Msg1')
      await new Promise(resolve => setTimeout(resolve, 10))
      await repo.addMessage(conv1.id, 'agent', 'Conv1 Msg2')

      const messages = await repo.getRecentMessagesForApp('app-123', 20)

      expect(messages).toHaveLength(3)
      expect(messages[0].content).toBe('Conv1 Msg1')
      expect(messages[1].content).toBe('Conv2 Msg1')
      expect(messages[2].content).toBe('Conv1 Msg2')
    })

    it('should only return messages for specified app', async () => {
      createApp('app-123')
      createApp('app-456')

      const conv1 = await repo.create('app-123', 'initial', 'App1 Conv')
      const conv2 = await repo.create('app-456', 'initial', 'App2 Conv')

      await repo.addMessage(conv1.id, 'user', 'App1 Msg')
      await repo.addMessage(conv2.id, 'user', 'App2 Msg')

      const messages = await repo.getRecentMessagesForApp('app-123', 20)

      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe('App1 Msg')
    })

    it('should include origin field', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'initial', 'Test Conv')

      await repo.addMessage(conv.id, 'user', 'Hello', { origin: 'customer' })
      await repo.addMessage(conv.id, 'agent', 'Hi there', { origin: 'support' })

      const messages = await repo.getRecentMessagesForApp('app-123', 20)

      expect(messages[0].origin).toBe('customer')
      expect(messages[1].origin).toBe('support')
    })
  })

  describe('getEstimatedTokensAfterMessageId', () => {
    it('should return estimated tokens for messages after reference', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      await repo.addMessage(conv.id, 'user', 'Message 1')
      const msg2 = await repo.addMessage(conv.id, 'agent', 'Message 2')
      await repo.addMessage(conv.id, 'user', 'Message 3 with more content here')
      await repo.addMessage(conv.id, 'agent', 'Message 4 also has content')

      const tokens = await repo.getEstimatedTokensAfterMessageId('app-123', msg2.id)

      // Should estimate tokens from Message 3 and 4 content lengths
      // "Message 3 with more content here" = 32 chars
      // "Message 4 also has content" = 26 chars
      // Total = 58 chars / 4 ≈ 15 tokens (plus empty segments)
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(100) // Sanity check
    })

    it('should return 0 when no messages after reference', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      await repo.addMessage(conv.id, 'user', 'Message 1')
      const msg2 = await repo.addMessage(conv.id, 'agent', 'Message 2')

      const tokens = await repo.getEstimatedTokensAfterMessageId('app-123', msg2.id)

      expect(tokens).toBe(0)
    })

    it('should return null when reference message not found', async () => {
      createApp('app-123')
      await repo.create('app-123', 'develop', 'Test')

      const tokens = await repo.getEstimatedTokensAfterMessageId('app-123', 'non-existent-msg')

      expect(tokens).toBeNull()
    })

    it('should include segments in token estimation', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const msg1 = await repo.addMessage(conv.id, 'user', 'First message')
      // Add message with segments (simulates tool calls)
      await repo.addMessage(conv.id, 'agent', 'Response', {
        segments: [
          { id: 'seg1', type: 'content', content: 'Some content here' },
          { id: 'seg2', type: 'tool_call', tool_call: { id: 'tc1', tool_name: 'test', tool_args: { data: 'x'.repeat(100) } } }
        ] as any
      })

      const tokens = await repo.getEstimatedTokensAfterMessageId('app-123', msg1.id)

      // Tokens should be higher due to segments JSON
      expect(tokens).toBeGreaterThan(30) // Segments add significant length
    })

    it('should return null when reference message belongs to different app', async () => {
      createApp('app-123')
      createApp('app-456')
      const conv1 = await repo.create('app-123', 'develop', 'Conv 1')
      const conv2 = await repo.create('app-456', 'develop', 'Conv 2')

      const msg = await repo.addMessage(conv2.id, 'user', 'Message in app-456')
      await repo.addMessage(conv1.id, 'user', 'Message in app-123')

      // Reference message belongs to app-456, but we're querying app-123
      const tokens = await repo.getEstimatedTokensAfterMessageId('app-123', msg.id)

      expect(tokens).toBeNull()
    })
  })

  describe('getEstimatedTokensForApp', () => {
    it('should return estimated tokens for all messages in an app', async () => {
      createApp('app-123')
      const conv1 = await repo.create('app-123', 'develop', 'Conv 1')
      const conv2 = await repo.create('app-123', 'develop', 'Conv 2')

      await repo.addMessage(conv1.id, 'user', 'Message in conv 1')
      await repo.addMessage(conv1.id, 'agent', 'Response in conv 1')
      await repo.addMessage(conv2.id, 'user', 'Message in conv 2')

      const tokens = await repo.getEstimatedTokensForApp('app-123')

      // All three messages have content
      expect(tokens).toBeGreaterThan(0)
    })

    it('should return 0 when app has no messages', async () => {
      createApp('app-123')
      await repo.create('app-123', 'develop', 'Empty Conv')

      const tokens = await repo.getEstimatedTokensForApp('app-123')

      expect(tokens).toBe(0)
    })

    it('should not include messages from other apps', async () => {
      createApp('app-123')
      createApp('app-456')

      const conv1 = await repo.create('app-123', 'develop', 'App 1 Conv')
      const conv2 = await repo.create('app-456', 'develop', 'App 2 Conv')

      await repo.addMessage(conv1.id, 'user', 'Short')
      await repo.addMessage(conv2.id, 'user', 'This is a much longer message with more content')
      await repo.addMessage(conv2.id, 'user', 'Another long message in app 2')

      const tokensApp1 = await repo.getEstimatedTokensForApp('app-123')
      const tokensApp2 = await repo.getEstimatedTokensForApp('app-456')

      // App 2 should have more estimated tokens due to longer messages
      expect(tokensApp2).toBeGreaterThan(tokensApp1)
    })
  })

  describe('getMessagesPaginated', () => {
    it('should return most recent messages when no cursor provided', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      for (let i = 1; i <= 30; i++) {
        await repo.addMessage(conv.id, 'user', `Message ${i}`)
      }

      const result = await repo.getMessagesPaginated(conv.id, 'app-123', { limit: 20 })

      expect(result.messages).toHaveLength(20)
      expect(result.messages[0].content).toBe('Message 11')
      expect(result.messages[19].content).toBe('Message 30')
      expect(result.hasMore).toBe(true)
      expect(result.nextCursor).toBeTruthy()
      expect(result.total).toBe(30)
    })

    it('should return messages before cursor when cursor provided', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      for (let i = 1; i <= 30; i++) {
        await repo.addMessage(conv.id, 'user', `Message ${i}`)
      }

      const firstPage = await repo.getMessagesPaginated(conv.id, 'app-123', { limit: 20 })

      const secondPage = await repo.getMessagesPaginated(conv.id, 'app-123', {
        limit: 20,
        before: firstPage.nextCursor!
      })

      expect(secondPage.messages).toHaveLength(10)
      expect(secondPage.messages[0].content).toBe('Message 1')
      expect(secondPage.messages[9].content).toBe('Message 10')
      expect(secondPage.hasMore).toBe(false)
      expect(secondPage.nextCursor).toBeNull()
    })

    it('should return empty array for conversation with no messages', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const result = await repo.getMessagesPaginated(conv.id, 'app-123', { limit: 50 })

      expect(result.messages).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeNull()
      expect(result.total).toBe(0)
    })

    it('should enforce max limit of 200', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      for (let i = 1; i <= 250; i++) {
        await repo.addMessage(conv.id, 'user', `Message ${i}`)
      }

      const result = await repo.getMessagesPaginated(conv.id, 'app-123', { limit: 500 })

      expect(result.messages).toHaveLength(200)
    })

    it('should return empty result for wrong appId', async () => {
      createApp('app-123')
      createApp('app-other')
      const conv = await repo.create('app-123', 'develop', 'Test')

      for (let i = 1; i <= 5; i++) {
        await repo.addMessage(conv.id, 'user', `Message ${i}`)
      }

      const result = await repo.getMessagesPaginated(conv.id, 'app-other')

      expect(result.messages).toHaveLength(0)
      expect(result.hasMore).toBe(false)
      expect(result.total).toBe(0)
    })
  })

  describe('message origin', () => {
    it('should default origin to customer when not specified', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const msg = await repo.addMessage(conv.id, 'user', 'Hello')

      expect(msg.origin).toBe('customer')
    })

    it('should store origin as support when specified', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const msg = await repo.addMessage(conv.id, 'user', 'Support message', {
        origin: 'support'
      })

      expect(msg.origin).toBe('support')
    })

    it('should persist and retrieve origin from database', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      await repo.addMessage(conv.id, 'user', 'Customer msg', { origin: 'customer' })
      await repo.addMessage(conv.id, 'agent', 'Agent reply to customer', { origin: 'customer' })
      await repo.addMessage(conv.id, 'user', 'Support msg', { origin: 'support' })
      await repo.addMessage(conv.id, 'agent', 'Agent reply to support', { origin: 'support' })

      const messages = await repo.getMessages(conv.id)

      expect(messages).toHaveLength(4)
      expect(messages[0].origin).toBe('customer')
      expect(messages[1].origin).toBe('customer')
      expect(messages[2].origin).toBe('support')
      expect(messages[3].origin).toBe('support')
    })

    it('should return all messages including both origins from getMessagesPaginated', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      await repo.addMessage(conv.id, 'user', 'Customer msg', { origin: 'customer' })
      await repo.addMessage(conv.id, 'user', 'Support msg', { origin: 'support' })

      const result = await repo.getMessagesPaginated(conv.id, 'app-123')

      expect(result.messages).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.messages[0].origin).toBe('customer')
      expect(result.messages[1].origin).toBe('support')
    })
  })

  describe('normalizeToolCalls (legacy shape migration)', () => {
    it('should normalize legacy "name" field to "toolName"', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const legacyToolCalls = JSON.stringify([
        { id: 'tc-1', name: 'readFile', input: { path: '/tmp' }, result: { data: 'ok' }, status: 'completed' }
      ])
      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, tool_calls, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run('msg-legacy', conv.id, 'agent', 'done', legacyToolCalls)

      const messages = await repo.getMessages(conv.id)
      const msg = messages.find(m => m.id === 'msg-legacy')!
      expect(msg.toolCalls).toHaveLength(1)
      expect(msg.toolCalls![0].toolName).toBe('readFile')
      expect(msg.toolCalls![0].toolArgs).toEqual({ path: '/tmp' })
      expect(msg.toolCalls![0].toolResult).toEqual({ data: 'ok' })
      expect(msg.toolCalls![0].status).toBe('success')
    })

    it('should normalize "completed" status to "success"', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const toolCalls = JSON.stringify([
        { id: 'tc-1', tool_name: 'git', tool_args: {}, status: 'completed' }
      ])
      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, tool_calls, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run('msg-status', conv.id, 'agent', 'done', toolCalls)

      const messages = await repo.getMessages(conv.id)
      const msg = messages.find(m => m.id === 'msg-status')!
      expect(msg.toolCalls![0].status).toBe('success')
    })

    it('should infer status from presence of result when status is missing', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const toolCalls = JSON.stringify([
        { id: 'tc-1', tool_name: 'exec', tool_args: {}, tool_result: { output: 'hi' } },
        { id: 'tc-2', tool_name: 'exec', tool_args: {} }
      ])
      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, tool_calls, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run('msg-infer', conv.id, 'agent', 'done', toolCalls)

      const messages = await repo.getMessages(conv.id)
      const msg = messages.find(m => m.id === 'msg-infer')!
      expect(msg.toolCalls![0].status).toBe('success')
      expect(msg.toolCalls![1].status).toBe('running')
    })

    it('should normalize legacy "output" field as toolResult fallback', async () => {
      createApp('app-123')
      const conv = await repo.create('app-123', 'develop', 'Test')

      const toolCalls = JSON.stringify([
        { id: 'tc-1', tool_name: 'exec', tool_args: {}, output: { stdout: 'hello' }, status: 'success' }
      ])
      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, tool_calls, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run('msg-output', conv.id, 'agent', 'done', toolCalls)

      const messages = await repo.getMessages(conv.id)
      const msg = messages.find(m => m.id === 'msg-output')!
      expect(msg.toolCalls![0].toolResult).toEqual({ stdout: 'hello' })
    })

    it('round-trips a DB row through normalizeToolCalls + mapToolCallsToUI to wire-side "completed"', async () => {
      const { mapToolCallsToUI } = await import('../../../server/tool-call-mapper.js')

      createApp('app-rt')
      const conv = await repo.create('app-rt', 'develop', 'Test')

      const dbToolCalls = JSON.stringify([
        {
          id: 'tc-rt',
          tool_name: 'requestSecrets',
          tool_args: { secrets: [{ name: 'API_KEY' }] },
          tool_result: { ok: true },
          status: 'success',
        },
      ])
      testDb.prepare(`
        INSERT INTO conversation_messages (id, conversation_id, sender, content, tool_calls, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `).run('msg-rt', conv.id, 'agent', 'done', dbToolCalls)

      const messages = await repo.getMessages(conv.id)
      const msg = messages.find(m => m.id === 'msg-rt')!

      expect(msg.toolCalls![0].status).toBe('success')

      const ui = mapToolCallsToUI(msg.toolCalls as any)
      expect(ui[0].status).toBe('completed')
      expect(ui[0].name).toBe('requestSecrets')
      expect(ui[0].input).toEqual({ secrets: [{ name: 'API_KEY' }] })
      expect(ui[0].result).toEqual({ ok: true })
    })
  })
})
