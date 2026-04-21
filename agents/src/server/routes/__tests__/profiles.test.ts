import type { IRouter, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthenticatedRequest } from '../../middleware/jwt-auth.js'

const mockGetProfileRegistry = vi.hoisted(function createMocks() {
  return vi.fn()
})

vi.mock('../../../profiles/index.js', function mockProfiles() {
  return {
    getProfileRegistry: mockGetProfileRegistry,
  }
})

import profilesRouter from '../profiles.js'

function getGetProfilesHandler(router: IRouter) {
  for (const layer of router.stack) {
    if (layer.route?.path === '/profiles' && layer.route.methods.get) {
      return layer.route.stack[0].handle as (
        req: AuthenticatedRequest,
        res: Response
      ) => void
    }
  }
  throw new Error('GET /profiles handler not found')
}

function createMockRes() {
  const state = { status: 200, body: undefined as unknown }
  return {
    status(code: number) {
      state.status = code
      return this
    },
    json(payload: unknown) {
      state.body = payload
    },
    getStatus() {
      return state.status
    },
    getBody() {
      return state.body
    },
  }
}

describe('@airo/agents', function packageTests() {
  describe('#getProfiles', function getProfilesTests() {
    const handler = getGetProfilesHandler(profilesRouter)

    beforeEach(function resetMocks() {
      mockGetProfileRegistry.mockReset()
    })

    it('returns 403 when agentProfileSelectorEnabled is false', function returns403() {
      const req = {
        agentContext: { agentProfileSelectorEnabled: false },
      } as AuthenticatedRequest
      const res = createMockRes()

      handler(req, res as Response)

      expect(res.getStatus()).toBe(403)
      expect(res.getBody()).toEqual({ error: 'Profile selection is not enabled' })
    })

    it('returns 403 when agentProfileSelectorEnabled is undefined', function returns403Undefined() {
      const req = { agentContext: {} } as AuthenticatedRequest
      const res = createMockRes()

      handler(req, res as Response)

      expect(res.getStatus()).toBe(403)
    })

    it('returns profiles list when enabled', function returnsProfiles() {
      const registry = new Map([
        ['experimental', {
          name: 'experimental',
          description: 'Test profile',
          properties: { 'model.default': 'claude-opus-4-6' },
        }],
        ['conservative', {
          name: 'conservative',
          description: 'Safe defaults',
          properties: { 'feature.new': false },
        }],
      ])
      mockGetProfileRegistry.mockReturnValue(registry)

      const req = {
        agentContext: { agentProfileSelectorEnabled: true },
      } as AuthenticatedRequest
      const res = createMockRes()

      handler(req, res as Response)

      const body = res.getBody() as { profiles: Array<{ name: string; description: string; properties: Record<string, unknown> }> }
      expect(body.profiles).toHaveLength(2)
      expect(body.profiles[0].name).toBe('conservative')
      expect(body.profiles[1].name).toBe('experimental')
      expect(body.profiles[1].description).toBe('Test profile')
      expect(body.profiles[1].properties).toEqual({ 'model.default': 'claude-opus-4-6' })
    })

    it('returns empty list when no profiles loaded', function emptyRegistry() {
      mockGetProfileRegistry.mockReturnValue(new Map())

      const req = {
        agentContext: { agentProfileSelectorEnabled: true },
      } as AuthenticatedRequest
      const res = createMockRes()

      handler(req, res as Response)

      const body = res.getBody() as { profiles: unknown[] }
      expect(body.profiles).toHaveLength(0)
    })
  })
})
