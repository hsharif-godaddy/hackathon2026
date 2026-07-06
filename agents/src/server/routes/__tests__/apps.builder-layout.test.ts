import { DEFAULT_BUILDER_LAYOUT, DESIGN_KIT_BUILD_CANVAS_ID } from '@airo/shared'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppMetadataRepository } from '../../../database/repositories/AppMetadataRepository.js'
import { AppRepository } from '../../../database/index.js'
import type { App } from '../../../database/index.js'
import { getKvMemoryStore } from '../../../memory/adapters/index.js'
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

describe('GET /apps/:id builderLayout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a persisted builderLayout when metadata already has one', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockReturnValue({
      builderLayout: { version: 1, layout: 'immersive', pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID } },
    })
    const mergeSpy = vi.spyOn(AppMetadataRepository.prototype, 'merge')

    const res = await request(makeApp()).get('/apps/app1234567').expect(200)

    expect(res.body.app.builderLayout).toEqual({
      version: 1,
      layout: 'immersive',
      pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
    })
    expect(mergeSpy).not.toHaveBeenCalled()
  })

  it('normalizes a corrupt persisted builderLayout to the default (no re-persist)', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockReturnValue({
      builderLayout: { version: 99, layout: 'garbage' },
    })
    const mergeSpy = vi.spyOn(AppMetadataRepository.prototype, 'merge')

    const res = await request(makeApp()).get('/apps/app1234567').expect(200)

    expect(res.body.app.builderLayout).toEqual(DEFAULT_BUILDER_LAYOUT)
    expect(mergeSpy).not.toHaveBeenCalled()
  })

  it('backfills + persists from the wizard phase when metadata has no layout', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockReturnValue({})
    const mergeSpy = vi
      .spyOn(AppMetadataRepository.prototype, 'merge')
      .mockImplementation((_id, patch) => patch)
    vi.spyOn(getKvMemoryStore(), 'get').mockResolvedValue({
      success: true,
      exists: true,
      value: { phase: 'brand' },
    })

    const res = await request(makeApp()).get('/apps/app1234567').expect(200)

    expect(res.body.app.builderLayout).toEqual({
      version: 1,
      layout: 'immersive',
      pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
    })
    expect(mergeSpy).toHaveBeenCalledWith(
      'app1234567',
      expect.objectContaining({
        builderLayout: { version: 1, layout: 'immersive', pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID } },
      }),
    )
  })

  it('returns the default layout WITHOUT persisting when there is no phase yet (avoids mislabeling a fresh design-kit app)', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockReturnValue({})
    const mergeSpy = vi
      .spyOn(AppMetadataRepository.prototype, 'merge')
      .mockImplementation((_id, patch) => patch)
    vi.spyOn(getKvMemoryStore(), 'get').mockResolvedValue({ success: true, exists: false })

    const res = await request(makeApp()).get('/apps/app1234567').expect(200)

    expect(res.body.app.builderLayout).toEqual(DEFAULT_BUILDER_LAYOUT)
    expect(mergeSpy).not.toHaveBeenCalled()
  })

  it('still returns the app (default layout) when the phase read throws', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(buildApp())
    vi.spyOn(AppMetadataRepository.prototype, 'get').mockReturnValue({})
    vi.spyOn(AppMetadataRepository.prototype, 'merge').mockImplementation((_id, patch) => patch)
    vi.spyOn(getKvMemoryStore(), 'get').mockRejectedValue(new Error('kv down'))

    const res = await request(makeApp()).get('/apps/app1234567').expect(200)

    expect(res.body.app.builderLayout).toEqual(DEFAULT_BUILDER_LAYOUT)
  })

  it('returns 404 when the app does not exist', async () => {
    vi.spyOn(AppRepository.prototype, 'findById').mockReturnValue(null)

    await request(makeApp()).get('/apps/app1234567').expect(404)
  })
})
