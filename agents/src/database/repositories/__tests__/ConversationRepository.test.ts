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
})
