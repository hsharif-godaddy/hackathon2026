import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { appsRouter } from '../apps.js'

vi.mock('../../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockImplementation((id: string) => {
      if (id === 'existing-app') {
        return { id: 'existing-app', name: 'Test App' }
      }
      return null
    })
  })),
  TokenUsageRepository: vi.fn().mockImplementation(() => ({
    getDailyUsage: vi.fn().mockReturnValue({
      totalCost: 0.05,
      totalTokens: 1500,
      operationBreakdown: [
        { operation: 'llm_request', cost: 0.04, count: 3 },
        { operation: 'file_edit', cost: 0.01, count: 2 }
      ],
      resetTime: '2024-01-01T00:10:00.000Z'
    })
  }))
}))

vi.mock('../../../services/features.js', () => ({
  getFeatures: vi.fn().mockReturnValue({
    dailyPriceLimit: 1.0
  })
}))

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
    debug: vi.fn(),
    forApp: vi.fn().mockReturnThis()
  }
}))

const createTestApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/apps', appsRouter)
  return app
}

describe('GET /apps/:id/usage/daily', () => {
  let app: express.Express

  beforeAll(() => {
    app = createTestApp()
  })

  it('returns 404 for non-existent app', async () => {
    const response = await request(app)
      .get('/apps/non-existent/usage/daily')
      .expect(404)

    expect(response.body.error).toBe('App not found')
  })

  it('returns daily usage with percentage and reset time', async () => {
    const response = await request(app)
      .get('/apps/existing-app/usage/daily')
      .expect(200)

    expect(response.body).toHaveProperty('percentage')
    expect(response.body).toHaveProperty('resetTime')
    expect(response.body.percentage).toBe(5) // 0.05 / 1.0 * 100
    expect(response.body.resetTime).toBe('2024-01-01T00:10:00.000Z')
  })

  it('caps percentage at 100', async () => {
    const { getFeatures } = await import('../../../services/features.js')
    vi.mocked(getFeatures).mockReturnValue({ dailyPriceLimit: 0.01 } as any)

    const response = await request(app)
      .get('/apps/existing-app/usage/daily')
      .expect(200)

    expect(response.body.percentage).toBe(100)
  })
})
