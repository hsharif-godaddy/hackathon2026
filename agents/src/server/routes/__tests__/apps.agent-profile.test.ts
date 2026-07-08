import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppMetadataRepository } from '../../../database/repositories/AppMetadataRepository.js'
import { AppRepository } from '../../../database/index.js'
import type { App } from '../../../database/index.js'
import { appsRouter } from '../apps.js'

function makeApp(): express.Express {
  const app = express()
  app.use(express.json())
  app.use((req: express.Request & { agentContext?: unknown }, _res, next) => {
    req.agentContext = { siteId: 'local-dev-site', customerId: 'cust1' }
    next()
  })
  app.use('/apps', appsRouter)
  return app
}

function buildApp(): App {
  return {
    id: 'app1234567',
    name: 'Kit App',
    path: '/apps/app1234567',
    port: 4001,
    status: 'created',
    publishedUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
}

describe('GET /apps/:id agentProfile serialization', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes agentProfile in the response when metadata has it', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockReturnValue({
      agentProfile: 'initial-agent-design-kit',
    })

    const res = await request(makeApp()).get('/apps/app1234567').expect(200)

    expect(res.body.app.agentProfile).toBe('initial-agent-design-kit')
  })

  it('omits agentProfile when metadata does not have it', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockReturnValue({})

    const res = await request(makeApp()).get('/apps/app1234567').expect(200)

    expect(res.body.app.agentProfile).toBeUndefined()
    expect(res.body.app.builderLayout).toBeDefined() // layout still returned
  })

  it('returns 500 when the metadata read throws', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockImplementation(() => {
      throw new Error('db connection lost')
    })

    await request(makeApp()).get('/apps/app1234567').expect(500)
  })
})
