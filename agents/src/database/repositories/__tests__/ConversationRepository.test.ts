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
})
