import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { cacheIdpTokenMock } = vi.hoisted(function setup() {
  return { cacheIdpTokenMock: vi.fn() }
})

vi.mock('../../../memory/adapters/index.js', function mockAdapters() {
  return {
    getConversationLifecycleStore: vi.fn(),
    getMessageStore: vi.fn(),
  }
})

vi.mock('../../middleware/app-ownership.js', function mockAppOwnership() {
  return {
    validateAppOwnershipFromBody: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    validateAppOwnershipFromParam: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    validateAppOwnershipFromQuery: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    validateConversationOwnership: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  }
})

vi.mock('../../../utils/idp-token-cache.js', function mockIdpTokenCache() {
  return {
    cacheIdpToken: cacheIdpTokenMock,
    getIdpToken: vi.fn(),
    idpTokenCacheKey: (id: string) => `${id}:auth_idp`,
  }
})

import { conversationsRouter } from '../conversations.js'

describe('conversations idp-token route', function idpTokenRouteTests() {
  describe('POST /api/conversations/:appId/:conversationId/idp-token', function postTests() {
    let app: express.Express

    beforeEach(function setup() {
      cacheIdpTokenMock.mockReset()
      cacheIdpTokenMock.mockReturnValue(true)
      app = express()
      app.use(express.json())
      app.use(conversationsRouter)
    })

    it('returns 400 when token field is absent', async function missingToken() {
      const res = await request(app)
        .post('/api/conversations/testapp001/conv-abc/idp-token')
        .send({})
        .expect(400)

      expect(res.body).toEqual({ error: 'token is required' })
      expect(cacheIdpTokenMock).not.toHaveBeenCalled()
    })

    it('returns 400 when token is not a string', async function tokenNotString() {
      const res = await request(app)
        .post('/api/conversations/testapp001/conv-abc/idp-token')
        .send({ token: 42 })
        .expect(400)

      expect(res.body).toEqual({ error: 'token is required' })
      expect(cacheIdpTokenMock).not.toHaveBeenCalled()
    })

    it('returns 400 when token is null', async function tokenNull() {
      const res = await request(app)
        .post('/api/conversations/testapp001/conv-abc/idp-token')
        .send({ token: null })
        .expect(400)

      expect(res.body).toEqual({ error: 'token is required' })
      expect(cacheIdpTokenMock).not.toHaveBeenCalled()
    })

    it('returns 200 and calls cacheIdpToken(conversationId, token)', async function success() {
      const res = await request(app)
        .post('/api/conversations/testapp001/conv-abc/idp-token')
        .send({ token: 'gd-sso-jwt-abc' })
        .expect(200)

      expect(res.body).toEqual({ accepted: true })
      expect(cacheIdpTokenMock).toHaveBeenCalledOnce()
      expect(cacheIdpTokenMock).toHaveBeenCalledWith('conv-abc', 'gd-sso-jwt-abc')
    })

    it('passes conversationId (not appId) as first arg to cacheIdpToken', async function paramsMapping() {
      await request(app)
        .post('/api/conversations/site-xyz/conv-999/idp-token')
        .send({ token: 'my-sso-token' })
        .expect(200)

      expect(cacheIdpTokenMock).toHaveBeenCalledWith('conv-999', 'my-sso-token')
    })

    it('returns 200 { accepted: false } when cacheIdpToken rejects the token', async function rejected() {
      cacheIdpTokenMock.mockReturnValue(false)

      const res = await request(app)
        .post('/api/conversations/testapp001/conv-abc/idp-token')
        .send({ token: 'expired-sso-jwt' })
        .expect(200)

      expect(res.body).toEqual({ accepted: false })
      expect(cacheIdpTokenMock).toHaveBeenCalledOnce()
      expect(cacheIdpTokenMock).toHaveBeenCalledWith('conv-abc', 'expired-sso-jwt')
    })

    it('each call caches independently by conversationId', async function independentCaching() {
      await request(app)
        .post('/api/conversations/app-a/conv-111/idp-token')
        .send({ token: 'token-for-111' })
        .expect(200)

      await request(app)
        .post('/api/conversations/app-a/conv-222/idp-token')
        .send({ token: 'token-for-222' })
        .expect(200)

      expect(cacheIdpTokenMock).toHaveBeenCalledTimes(2)
      expect(cacheIdpTokenMock).toHaveBeenCalledWith('conv-111', 'token-for-111')
      expect(cacheIdpTokenMock).toHaveBeenCalledWith('conv-222', 'token-for-222')
    })
  })
})
