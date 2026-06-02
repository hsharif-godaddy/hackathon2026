import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ai-lib/budget before importing the module under test
vi.mock('@airo/ai-lib/budget', () => ({
  BudgetServiceClient: vi.fn().mockImplementation(function (config: any) {
    if (!config.baseUrl) {
      throw new Error('Invalid config')
    }
    return { getBudget: vi.fn(), createSession: vi.fn() }
  }),
}))

// Mock logger
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

describe('getBudgetServiceClient', () => {
  beforeEach(() => {
    // Reset module state between tests
    vi.resetModules()
    delete process.env.BUDGET_SERVICE_URL
  })

  it('returns null when BUDGET_SERVICE_URL not set', async () => {
    const { getBudgetServiceClient } = await import('../budget-service-instance.js')
    expect(getBudgetServiceClient()).toBeNull()
  })

  it('returns client when BUDGET_SERVICE_URL set', async () => {
    process.env.BUDGET_SERVICE_URL = 'https://budget.example.com'
    const { getBudgetServiceClient } = await import('../budget-service-instance.js')
    const client = getBudgetServiceClient()
    expect(client).not.toBeNull()
  })

  it('returns same instance on subsequent calls', async () => {
    process.env.BUDGET_SERVICE_URL = 'https://budget.example.com'
    const { getBudgetServiceClient } = await import('../budget-service-instance.js')
    const first = getBudgetServiceClient()
    const second = getBudgetServiceClient()
    expect(first).toBe(second)
  })
})
