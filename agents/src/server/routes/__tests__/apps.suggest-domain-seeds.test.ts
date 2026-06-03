import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'

const { mockSuggestDomainSeeds, mockSuggestName } = vi.hoisted(() => ({
  mockSuggestDomainSeeds: vi.fn(),
  mockSuggestName: vi.fn(),
}))

vi.mock('../../../services/domain-seed-suggestion.js', () => ({
  getDomainSeedSuggestionService: () => ({ suggestDomainSeeds: mockSuggestDomainSeeds }),
}))

// Stubs for the heavy transitive deps apps.ts pulls in but the seeds route doesn't need.
vi.mock('../../../services/name-suggestion.js', () => ({
  getNameSuggestionService: () => ({ suggestName: mockSuggestName }),
}))
vi.mock('../../../tools/ast-style-editor.js', () => ({
  ASTStyleEditor: vi.fn().mockImplementation(function () { return {}; }),
}))
vi.mock('../../../tools/ast-text-editor.js', () => ({
  ASTTextEditor: vi.fn().mockImplementation(function () { return {}; }),
}))
vi.mock('../../../tools/ast-image-editor.js', () => ({
  astImageEditor: {},
}))
vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {},
}))
vi.mock('../../../utils/code-search.js', () => ({
  searchCode: vi.fn(),
}))
vi.mock('../../../tools/server-management-tool.js', () => ({
  ServerManagementTool: vi.fn().mockImplementation(function () { return {}; }),
}))

import { appsRouter } from '../apps.js'

function buildApp(): Express {
  const app = express()
  app.use(express.json())
  app.use('/apps', appsRouter)
  return app
}

describe('POST /apps/suggest-domain-seeds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when prompt is missing', async () => {
    const res = await request(buildApp()).post('/apps/suggest-domain-seeds').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/prompt is required/i)
  })

  it('returns 400 when prompt is not a string', async () => {
    const res = await request(buildApp()).post('/apps/suggest-domain-seeds').send({ prompt: 42 })
    expect(res.status).toBe(400)
  })

  it('returns 400 when prompt is whitespace-only', async () => {
    const res = await request(buildApp()).post('/apps/suggest-domain-seeds').send({ prompt: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns 200 with seeds when service returns array', async () => {
    mockSuggestDomainSeeds.mockResolvedValue(['aaa', 'bbb', 'ccc', 'ddd'])
    const res = await request(buildApp())
      .post('/apps/suggest-domain-seeds')
      .send({ prompt: 'My coffee shop in Seattle' })
    expect(res.status).toBe(200)
    expect(res.body.seeds).toEqual(['aaa', 'bbb', 'ccc', 'ddd'])
    expect(res.body.prompt).toBeUndefined()
  })

  it('returns 200 with empty seeds when service returns []', async () => {
    mockSuggestDomainSeeds.mockResolvedValue([])
    const res = await request(buildApp())
      .post('/apps/suggest-domain-seeds')
      .send({ prompt: 'a vague description' })
    expect(res.status).toBe(200)
    expect(res.body.seeds).toEqual([])
  })

  it('returns 500 when service returns null (LLM error)', async () => {
    mockSuggestDomainSeeds.mockResolvedValue(null)
    const res = await request(buildApp())
      .post('/apps/suggest-domain-seeds')
      .send({ prompt: 'My coffee shop' })
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/failed/i)
  })

  it('strips /agent <name> command from first line of prompt', async () => {
    mockSuggestDomainSeeds.mockResolvedValue(['aaa', 'bbb', 'ccc', 'ddd'])
    await request(buildApp())
      .post('/apps/suggest-domain-seeds')
      .send({ prompt: '/agent develop\nMy coffee shop in Seattle' })
    expect(mockSuggestDomainSeeds).toHaveBeenCalledWith('My coffee shop in Seattle')
  })
})
