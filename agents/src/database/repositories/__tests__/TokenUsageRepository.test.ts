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
  nanoid: vi.fn().mockImplementation(() => `test-id-${++idCounter}`)
}))

describe('TokenUsageRepository.getDailyUsage', () => {
  let testDb: Database.Database
  let repo: InstanceType<typeof import('../TokenUsageRepository.js').TokenUsageRepository>

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

    const { TokenUsageRepository } = await import('../TokenUsageRepository.js')
    repo = new TokenUsageRepository()
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

  it('returns empty breakdown when no usage exists', () => {
    const result = repo.getDailyUsage('app-123')

    expect(result.totalCost).toBe(0)
    expect(result.totalTokens).toBe(0)
    expect(result.operationBreakdown).toEqual([])
    expect(result.resetTime).toBeDefined()
  })

  it('aggregates usage by operation type', async () => {
    createApp('app-123')
    await repo.recordUsage('app-123', 'llm_request', 100, 50, { cost: 0.01 })
    await repo.recordUsage('app-123', 'llm_request', 200, 100, { cost: 0.02 })
    await repo.recordUsage('app-123', 'file_edit', 50, 25, { cost: 0.005 })

    const result = repo.getDailyUsage('app-123')

    expect(result.totalCost).toBeCloseTo(0.035, 5)
    expect(result.totalTokens).toBe(525)
    expect(result.operationBreakdown).toHaveLength(2)

    const llmOps = result.operationBreakdown.find(op => op.operation === 'llm_request')
    expect(llmOps?.count).toBe(2)
    expect(llmOps?.cost).toBeCloseTo(0.03, 5)

    const fileOps = result.operationBreakdown.find(op => op.operation === 'file_edit')
    expect(fileOps?.count).toBe(1)
    expect(fileOps?.cost).toBeCloseTo(0.005, 5)
  })

  it('only includes usage from current period (after 00:10 UTC reset)', async () => {
    createApp('app-123')
    const now = new Date()
    const todayReset = new Date(now)
    todayReset.setUTCHours(0, 10, 0, 0)

    // insert old record directly (before reset)
    const oldTime = new Date(todayReset.getTime() - 60 * 60 * 1000) // 1 hour before reset
    testDb.prepare(`
      INSERT INTO token_usage (id, app_id, operation, prompt_tokens, completion_tokens, total_tokens, cost, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old-1', 'app-123', 'llm_request', 1000, 500, 1500, 0.50, oldTime.toISOString())

    // insert new record (after reset or today)
    await repo.recordUsage('app-123', 'llm_request', 100, 50, { cost: 0.01 })

    const result = repo.getDailyUsage('app-123')

    // should only include the new record, not the old one
    expect(result.totalCost).toBeCloseTo(0.01, 5)
    expect(result.operationBreakdown).toHaveLength(1)
    expect(result.operationBreakdown[0].count).toBe(1)
  })

  it('isolates usage by app id', async () => {
    createApp('app-123')
    createApp('app-456')
    await repo.recordUsage('app-123', 'llm_request', 100, 50, { cost: 0.01 })
    await repo.recordUsage('app-456', 'llm_request', 200, 100, { cost: 0.05 })

    const result = repo.getDailyUsage('app-123')

    expect(result.totalCost).toBeCloseTo(0.01, 5)
    expect(result.operationBreakdown).toHaveLength(1)
  })

  it('returns valid ISO reset time', () => {
    const result = repo.getDailyUsage('app-123')

    const resetDate = new Date(result.resetTime)
    expect(resetDate.getTime()).toBeGreaterThan(Date.now())
    expect(resetDate.getUTCHours()).toBe(0)
    expect(resetDate.getUTCMinutes()).toBe(10)
  })
})
