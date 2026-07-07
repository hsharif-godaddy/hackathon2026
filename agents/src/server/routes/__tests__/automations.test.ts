import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockGetAuthType = vi.hoisted(() => vi.fn())
const mockGetSwitchboardFlag = vi.hoisted(() => vi.fn())
const mockGetConversationsByApp = vi.hoisted(() => vi.fn())
const mockGetOrCreateSSE = vi.hoisted(() => vi.fn())
const mockCreateForWorkspace = vi.hoisted(() => vi.fn())
const mockGetOrCreateForApp = vi.hoisted(() => vi.fn())
const mockExecute = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('../../../services/features.js', () => ({
  auth: { getType: () => mockGetAuthType() },
  AuthType: { JWT: 'jwt', MOCK: 'mock' },
}))

vi.mock('../../../services/switchboard.js', () => ({
  getSwitchboardFlag: (...args: unknown[]) => mockGetSwitchboardFlag(...args),
}))

vi.mock('../../sse/registry-singleton.js', () => ({
  getSSERegistry: () => ({
    getConversationsByApp: mockGetConversationsByApp,
    sendToApp: vi.fn(),
  }),
}))

vi.mock('../../../memory/adapters/index.js', () => ({
  getConversationLifecycleStore: () => ({
    getOrCreateForApp: mockGetOrCreateForApp,
  }),
}))

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => mockCreateForWorkspace(...args),
}))

vi.mock('../../app.js', () => ({
  getOrCreateSSEExecutionServiceForAutomation: () => mockGetOrCreateSSE(),
}))

vi.mock('@airo/ai-lib', () => ({
  getS2SToken: vi.fn().mockResolvedValue('s2s-token'),
  isS2SAuthEnabled: vi.fn().mockReturnValue(true),
}))

vi.mock('../../../utils/nomad-config.js', () => ({
  getNomadAllocConfigValue: vi.fn().mockReturnValue(''),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { automationsRouter, resetAutomationRunStateForTests } from '../automations.js'

const APP_ID = 'test-app-1'

function mountApp(agentContext: Record<string, unknown> = { siteId: APP_ID }) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as express.Request & { agentContext?: Record<string, unknown> }).agentContext = agentContext
    next()
  })
  app.use('/api/automations', automationsRouter)
  return app
}

describe('automations router', () => {
  beforeEach(() => {
    resetAutomationRunStateForTests()
    vi.clearAllMocks()
    mockGetAuthType.mockReturnValue('jwt')
    mockGetSwitchboardFlag.mockReturnValue(true)
    mockGetConversationsByApp.mockReturnValue([])
    mockGetOrCreateForApp.mockResolvedValue({ conversation: { id: 'conv-1' } })
    mockCreateForWorkspace.mockReturnValue({
      files: {
        readText: vi.fn().mockResolvedValue(
          // Includes status: completed so readRunFile treats it as a successful run.
          // readJobDefinition also reads this mock but ignores the status field.
          '---\nname: SEO\nstatus: completed\n---\nRun the SEO audit.',
        ),
      },
    })
    mockExecute.mockResolvedValue(undefined)
    mockGetOrCreateSSE.mockReturnValue({ execute: mockExecute, hasActiveStream: vi.fn().mockReturnValue(false) })
    mockFetch.mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
    process.env.MGMT_AIRO_BASE_URL = 'http://mgmt.test'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.MGMT_AIRO_BASE_URL
  })

  describe('POST /run guards', () => {
    it('returns 403 when scheduling flag is disabled', async () => {
      mockGetSwitchboardFlag.mockReturnValue(false)

      const res = await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-1', defnRef: 'seo' })

      expect(res.status).toBe(403)
      expect(res.body.failureClass).toBe('non_retryable')
    })

    it('returns 400 when runId or defnRef is missing', async () => {
      const res = await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-1' })

      expect(res.status).toBe(400)
    })

    it('returns 400 when defnRef contains path traversal characters', async () => {
      const res = await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-1', defnRef: '../../etc/passwd' })

      expect(res.status).toBe(400)
    })

    it('returns 400 when runId contains path traversal characters', async () => {
      const res = await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: '../../foo', defnRef: 'seo' })

      expect(res.status).toBe(400)
    })

    it('returns 409 retryable when another automation run is in flight', async () => {
      mockExecute.mockImplementation(() => new Promise(() => {}))
      const app = mountApp()

      const firstRes = await request(app)
        .post('/api/automations/run')
        .send({ runId: 'run-busy-1', defnRef: 'seo' })
      expect(firstRes.status).toBe(202)

      const secondRes = await request(app)
        .post('/api/automations/run')
        .send({ runId: 'run-busy-2', defnRef: 'seo' })

      expect(secondRes.status).toBe(409)
      expect(secondRes.body.failureClass).toBe('retryable')
    })

    it('returns 409 retryable when user has an actively streaming chat turn', async () => {
      mockGetConversationsByApp.mockReturnValue(['conv-active'])
      mockGetOrCreateSSE.mockReturnValue({
        execute: mockExecute,
        hasActiveStream: vi.fn().mockReturnValue(true),
      })

      const res = await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-sse', defnRef: 'seo' })

      expect(res.status).toBe(409)
      expect(res.body.failureClass).toBe('retryable')
    })

    it('returns 202 when SSE connection is open but no chat turn is streaming (idle tab)', async () => {
      mockGetConversationsByApp.mockReturnValue(['conv-idle'])
      mockGetOrCreateSSE.mockReturnValue({
        execute: mockExecute,
        hasActiveStream: vi.fn().mockReturnValue(false),
      })

      const res = await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-idle', defnRef: 'seo' })

      expect(res.status).toBe(202)
      expect(res.body.runId).toBe('run-idle')
    })

    it('accepts a valid automation run with 202', async () => {
      const res = await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-ok', defnRef: 'seo' })

      expect(res.status).toBe(202)
      expect(res.body.runId).toBe('run-ok')
    })
  })

  describe('POST /run/:runId/cancel', () => {
    it('returns 404 when no active run exists', async () => {
      const res = await request(mountApp())
        .post('/api/automations/run/missing-run/cancel')

      expect(res.status).toBe(404)
    })

    it('returns 403 when cancel targets another app\'s run', async () => {
      mockExecute.mockImplementation(() => new Promise(() => {}))
      const app = mountApp({ siteId: APP_ID })

      await request(app)
        .post('/api/automations/run')
        .send({ runId: 'run-cancel-owner', defnRef: 'seo' })
      await new Promise((resolve) => setTimeout(resolve, 10))

      const res = await request(mountApp({ siteId: 'other-app' }))
        .post('/api/automations/run/run-cancel-owner/cancel')

      expect(res.status).toBe(403)
    })

    it('returns 202 when cancel targets the owning app', async () => {
      mockExecute.mockImplementation(() => new Promise(() => {}))
      const app = mountApp()

      await request(app)
        .post('/api/automations/run')
        .send({ runId: 'run-cancel-ok', defnRef: 'seo' })
      await new Promise((resolve) => setTimeout(resolve, 10))

      const res = await request(app)
        .post('/api/automations/run/run-cancel-ok/cancel')

      expect(res.status).toBe(202)
      expect(res.body.status).toBe('cancelling')
    })
  })

  describe('async failure callbacks', () => {
    it('posts job_not_found when the job definition is missing', async () => {
      mockCreateForWorkspace.mockReturnValue(null)

      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-missing-job', defnRef: 'seo' })

      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('http://mgmt.test/api/hosting/v1/apps/test-app-1/agent/callback')
      const headers = init.headers as Record<string, string>
      expect(headers.Authorization).toMatch(/^sso-jwt /)
      const body = JSON.parse(String(init.body))
      expect(body.status).toBe('failed')
      expect(body.failureClass).toBe('non_retryable')
      expect(body.reasonCode).toBe('job_not_found')
    })

    it('posts agent_not_ready when execution service is unavailable', async () => {
      mockGetOrCreateSSE.mockReturnValue(null)

      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-no-agent', defnRef: 'seo' })

      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(String(init.body))
      expect(body.status).toBe('failed')
      expect(body.failureClass).toBe('retryable')
      expect(body.reasonCode).toBe('agent_not_ready')
    })

    it('posts summary_missing when execute succeeds but summary file is absent', async () => {
      const readText = vi.fn()
        .mockResolvedValueOnce('---\nname: SEO\n---\nRun audit.')
        .mockResolvedValueOnce('')
      mockCreateForWorkspace.mockReturnValue({ files: { readText } })

      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-no-summary', defnRef: 'seo' })

      await vi.waitFor(() => {
        const calls = mockFetch.mock.calls as Array<[string, RequestInit]>
        expect(calls.some(([, init]) => {
          const body = JSON.parse(String(init.body))
          return body.reasonCode === 'summary_missing'
        })).toBe(true)
      })
    })
  })

  describe('L2: callback retry', () => {
    it('retries the callback on transient 503 and succeeds on the second attempt', async () => {
      vi.useFakeTimers()
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true })

      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-retry', defnRef: 'seo' })

      await vi.runAllTimersAsync()

      await vi.waitFor(() => {
        const calls = mockFetch.mock.calls as Array<[string, RequestInit]>
        const callbackCalls = calls.filter(([url]) =>
          String(url).includes('agent/callback')
        )
        expect(callbackCalls).toHaveLength(2)
        const body = JSON.parse(String(callbackCalls[1][1].body))
        expect(body.status).toBe('succeeded')
      })
      vi.useRealTimers()
    })

    it('does not retry on 4xx errors (non-retryable)', async () => {
      vi.useFakeTimers()
      mockFetch.mockResolvedValue({ ok: false, status: 404 })

      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-4xx', defnRef: 'seo' })

      await vi.runAllTimersAsync()

      await vi.waitFor(() => {
        const calls = (mockFetch.mock.calls as Array<[string, RequestInit]>)
          .filter(([url]) => String(url).includes('agent/callback'))
        expect(calls).toHaveLength(1)
      })
      vi.useRealTimers()
    })
  })

  describe('L3: slot-based idempotency', () => {
    it('skips execution and re-posts success when slot summary already exists', async () => {
      // Must include status: completed — readRunFile now gates idempotency on this field.
      const existingSummary = '---\nstatus: completed\nautomationId: seo\n---\nSEO improvements applied.'
      const readText = vi.fn()
        // First readText: slot summary check → found (prior run succeeded)
        .mockResolvedValueOnce(existingSummary)
      mockCreateForWorkspace.mockReturnValue({ files: { readText } })

      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-retry-slot', defnRef: 'seo', scheduledSlot: '2026-07-07T09:00:00Z' })

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

      // execute() must NOT have been called — we skipped re-execution
      expect(mockExecute).not.toHaveBeenCalled()

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('agent/callback')
      const body = JSON.parse(String(init.body))
      expect(body.runId).toBe('run-retry-slot')
      expect(body.status).toBe('succeeded')
      expect(body.summaryRef).toContain('scheduled_2026-07-07T09-00-00Z_summary.md')
    })

    it('reads the slot-keyed summary file written by MES (no second write needed)', async () => {
      const readText = vi.fn()
        // Slot check: no prior summary
        .mockResolvedValueOnce('')
        // Job definition
        .mockResolvedValueOnce('---\nname: SEO\n---\nRun audit.')
        // Slot summary file written by MES — must include status: completed
        .mockResolvedValueOnce('---\nstatus: completed\nautomationId: seo\n---\nSEO done.')
      mockCreateForWorkspace.mockReturnValue({ files: { readText } })

      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-slot-write', defnRef: 'seo', scheduledSlot: '2026-07-07T10:00:00Z' })

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

      // Callback should carry the slot summaryRef — MES wrote it, no second write needed
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
      const body = JSON.parse(String(init.body))
      expect(body.status).toBe('succeeded')
      expect(body.summaryRef).toContain('scheduled_2026-07-07T10-00-00Z_summary.md')
    })

    it('runs normally when no scheduledSlot is provided (manual run)', async () => {
      await request(mountApp())
        .post('/api/automations/run')
        .send({ runId: 'run-manual', defnRef: 'seo' })

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

      expect(mockExecute).toHaveBeenCalled()
    })
  })
})
