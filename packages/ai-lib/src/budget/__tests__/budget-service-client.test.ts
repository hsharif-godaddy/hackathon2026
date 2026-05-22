import { describe, it, expect, vi, afterEach } from 'vitest'
import { BudgetServiceClient } from '../budget-service-client.js'
import {
  BudgetServiceError,
  BudgetServiceAuthError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
  BudgetNotFoundError,
  BudgetServiceConflictError,
  BudgetNoCapacityError,
} from '../errors.js'

const TEST_CONFIG = {
  baseUrl: 'https://budget.example.com',
  getToken: async () => 'test-s2s-token',
}

const VALID_BUDGET_RESPONSE = JSON.stringify({
  budgetId: 'b-1',
  productKey: 'airo-builder',
  creditsTotal: '150.000000',
  creditsUsed: '50.000000',
  creditsPending: '0.000000',
  items: [
    {
      budgetItemId: 'bi-1',
      creditsTotal: '150.000000',
      creditsUsed: '50.000000',
      costToCreditRatio: '0.100000',
      startsAt: null,
      expiresAt: null,
      resetInterval: null,
    },
  ],
})

const VALID_SESSION_RESPONSE = JSON.stringify({
  costTotal: 3.5,
  sessionItems: [
    { cost: 2.0, callRequestId: 'call-1' },
    { cost: 1.5, callRequestId: 'call-2' },
  ],
})

// createReport and getReport both return the full ReportResponse shape (BMS response parity, PR #2577)
const VALID_REPORT_RESPONSE = JSON.stringify({
  reportId: 'rpt-1',
  budgetId: 'b-1',
  sessionId: 'sess-abc',
  productKey: 'airo-builder',
  budgetCostTotal: 3.5,
  productCostTotal: 0,
  creditsAvailable: 135,
  reportItems: [
    {
      reportItemId: 'ri-1',
      budgetCost: 3.5,
      productCost: 0,
      label: 'airo-builder:general',
      budgetItems: [{ budgetItemId: 'bi-1', creditsUsed: 2.33 }],
    },
  ],
})
const VALID_CREATE_REPORT_RESPONSE = VALID_REPORT_RESPONSE

function mockFetchWithText(ok: boolean, status: number, text: string) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: vi.fn().mockResolvedValue(text),
  }) as unknown as typeof globalThis.fetch
}

function clientWith(fetchImpl: typeof globalThis.fetch) {
  return new BudgetServiceClient({ ...TEST_CONFIG, fetch: fetchImpl })
}

describe('BudgetServiceClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Construction ──

  describe('constructor', () => {
    it('rejects non-HTTPS URLs', () => {
      expect(
        () => new BudgetServiceClient({ ...TEST_CONFIG, baseUrl: 'http://budget.example.com' })
      ).toThrow('BUDGET_SERVICE_URL must use HTTPS')
    })

    it('allows http://localhost for local dev', () => {
      expect(
        () =>
          new BudgetServiceClient({ ...TEST_CONFIG, baseUrl: 'http://localhost:4200' })
      ).not.toThrow()
    })

    it('rejects http://localhost.evil.com (hostname bypass)', () => {
      expect(
        () => new BudgetServiceClient({ ...TEST_CONFIG, baseUrl: 'http://localhost.evil.com' })
      ).toThrow('BUDGET_SERVICE_URL must use HTTPS')
    })

    it('rejects invalid URLs', () => {
      expect(
        () => new BudgetServiceClient({ ...TEST_CONFIG, baseUrl: 'not-a-url' })
      ).toThrow('BUDGET_SERVICE_URL must be a valid URL')
    })

    it('strips trailing slashes from baseUrl', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_BUDGET_RESPONSE)
      const client = new BudgetServiceClient({
        ...TEST_CONFIG,
        baseUrl: 'https://budget.example.com///',
        fetch: fetchMock,
      })

      await client.getBudget('b-1')
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/budget\.example\.com\/api\/v1\/budgets\//),
        expect.anything()
      )
    })
  })

  // ── S2S auth ──

  describe('auth', () => {
    it('sends Bearer token from getToken', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_BUDGET_RESPONSE)
      const client = clientWith(fetchMock)

      await client.getBudget('b-123')

      const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
      const authHeader = (init.headers as Record<string, string>).Authorization
      expect(authHeader).toBe('Bearer test-s2s-token')
    })

    it('uses custom getToken function', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_BUDGET_RESPONSE)
      const client = new BudgetServiceClient({
        ...TEST_CONFIG,
        getToken: async () => 'custom-token',
        fetch: fetchMock,
      })

      await client.getBudget('b-1')

      const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
      const authHeader = (init.headers as Record<string, string>).Authorization
      expect(authHeader).toBe('Bearer custom-token')
    })
  })

  // ── getBudget ──

  describe('getBudget', () => {
    it('returns budget with items', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_BUDGET_RESPONSE)
      const client = clientWith(fetchMock)

      const result = await client.getBudget('b-1')

      expect(result.budgetId).toBe('b-1')
      expect(result.creditsTotal).toBe('150.000000')
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.budgetItemId).toBe('bi-1')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://budget.example.com/api/v1/budgets/b-1',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws on malformed response (missing budgetId)', async () => {
      const client = clientWith(mockFetchWithText(true, 200, '{"items":[]}'))
      await expect(client.getBudget('b-1')).rejects.toThrow('invalid BudgetResponse')
    })

    it('throws on malformed budget item in items array', async () => {
      const body = JSON.stringify({
        budgetId: 'b-1',
        productKey: 'airo-builder',
        creditsTotal: '100',
        creditsUsed: '0',
        creditsPending: '0',
        items: [{ notABudgetItem: true }],
      })
      const client = clientWith(mockFetchWithText(true, 200, body))
      await expect(client.getBudget('b-1')).rejects.toThrow('invalid BudgetResponse')
    })
  })

  // ── createSession ──

  describe('createSession', () => {
    it('creates session and returns sessionId', async () => {
      const fetchMock = mockFetchWithText(true, 200, '{"sessionId":"sess-abc"}')
      const client = clientWith(fetchMock)

      const result = await client.createSession('b-1')

      expect(result.sessionId).toBe('sess-abc')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://budget.example.com/api/v1/sessions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ budgetId: 'b-1' }),
        })
      )
      const sentBody = JSON.parse((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]![1].body)
      expect(sentBody.budgetId).toBe('b-1')
    })

    it('throws on missing sessionId', async () => {
      const client = clientWith(mockFetchWithText(true, 200, '{"other":"data"}'))
      await expect(client.createSession('b-1')).rejects.toThrow('invalid CreateSessionResponse')
    })

    it('throws BudgetNoCapacityError on 402 response', async () => {
      const client = clientWith(mockFetchWithText(false, 402, '{"code":"NO_BUDGET_CAPACITY"}'))
      await expect(client.createSession('b-1')).rejects.toThrow(BudgetNoCapacityError)
    })

    it('BudgetNoCapacityError includes response body', async () => {
      const responseBody = '{"code":"NO_BUDGET_CAPACITY","message":"Insufficient credits"}'
      const client = clientWith(mockFetchWithText(false, 402, responseBody))

      try {
        await client.createSession('b-1')
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetNoCapacityError)
        expect((err as BudgetNoCapacityError).statusCode).toBe(402)
        expect((err as BudgetNoCapacityError).responseBody).toContain('NO_BUDGET_CAPACITY')
      }
    })
  })

  // ── getSession ──

  describe('getSession', () => {
    it('returns session with costTotal and items', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_SESSION_RESPONSE)
      const client = clientWith(fetchMock)

      const result = await client.getSession('sess-abc')

      expect(result.costTotal).toBe(3.5)
      expect(result.sessionItems).toHaveLength(2)
      expect(fetchMock).toHaveBeenCalledWith(
        'https://budget.example.com/api/v1/sessions/sess-abc',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws on missing costTotal', async () => {
      const body = JSON.stringify({ sessionItems: [] })
      const client = clientWith(mockFetchWithText(true, 200, body))
      await expect(client.getSession('sess-abc')).rejects.toThrow('invalid SessionResponse')
    })

    it('throws on malformed sessionItems element', async () => {
      const body = JSON.stringify({ costTotal: 1.0, sessionItems: [{ notASessionItem: true }] })
      const client = clientWith(mockFetchWithText(true, 200, body))
      await expect(client.getSession('sess-abc')).rejects.toThrow('invalid SessionResponse')
    })
  })

  // ── createReport ──

  describe('createReport', () => {
    it('sends report and returns full ReportResponse', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_CREATE_REPORT_RESPONSE)
      const client = clientWith(fetchMock)

      const result = await client.createReport('sess-abc', {
        reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
      })

      expect(result.reportId).toBe('rpt-1')
      expect(result.budgetId).toBe('b-1')
      expect(result.sessionId).toBe('sess-abc')
      expect(result.creditsAvailable).toBe(135)
      expect(result.reportItems).toHaveLength(1)
      // Verify label→category transform (backward compat)
      expect(result.reportItems[0]!.category).toBe('airo-builder:general')

      const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
      expect(url).toBe('https://budget.example.com/api/v1/sessions/sess-abc/reports')
      expect(init.method).toBe('POST')
      const sentBody = JSON.parse(init.body)
      expect(sentBody.reportItems[0].budgetCost).toBe('3.5')
      expect(sentBody.allowOverage).toBeUndefined()
    })

    it('serializes allowOverage flag in request body', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_CREATE_REPORT_RESPONSE)
      const client = clientWith(fetchMock)

      await client.createReport('sess-abc', {
        reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        allowOverage: true,
      })

      const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!
      const sentBody = JSON.parse(init.body)
      expect(sentBody.allowOverage).toBe(true)
    })


    it('retries up to 3 times on transient failure', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue(VALID_CREATE_REPORT_RESPONSE),
        }) as unknown as typeof globalThis.fetch
      const client = clientWith(fetchMock)

      const result = await client.createReport('sess-abc', {
        reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
      })
      expect(result.reportId).toBe('rpt-1')
      expect(fetchMock).toHaveBeenCalledTimes(4) // 1 initial + 3 retries
    })

    it('retries on timeout error', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new DOMException('The operation was aborted', 'TimeoutError'))
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: vi.fn().mockResolvedValue(VALID_CREATE_REPORT_RESPONSE),
        }) as unknown as typeof globalThis.fetch
      const client = clientWith(fetchMock)

      const result = await client.createReport('sess-abc', {
        reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
      })
      expect(result.reportId).toBe('rpt-1')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('throws after exhausting all retries', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof globalThis.fetch
      const client = clientWith(fetchMock)

      await expect(
        client.createReport('sess-abc', {
          reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        })
      ).rejects.toThrow(BudgetServiceUnavailableError)
      expect(fetchMock).toHaveBeenCalledTimes(4) // 1 initial + 3 retries
    })

    it('does not retry on schema validation error', async () => {
      const fetchMock = mockFetchWithText(true, 200, '{"unexpected":true}')
      const client = clientWith(fetchMock)

      await expect(
        client.createReport('sess-abc', {
          reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        })
      ).rejects.toThrow('invalid ReportResponse')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not retry on 4xx error', async () => {
      const fetchMock = mockFetchWithText(false, 400, '{"error":"bad request"}')
      const client = clientWith(fetchMock)

      await expect(
        client.createReport('sess-abc', {
          reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        })
      ).rejects.toThrow(BudgetServiceError)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not retry on auth error', async () => {
      const client = clientWith(mockFetchWithText(false, 401, '{"error":"Unauthorized"}'))

      await expect(
        client.createReport('sess-abc', {
          reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        })
      ).rejects.toThrow(BudgetServiceAuthError)
    })

    it('throws BudgetServiceConflictError on 409 Conflict (not base class)', async () => {
      const fetchMock = mockFetchWithText(false, 409, '{"error":"Report already exists"}')
      const client = clientWith(fetchMock)

      await expect(
        client.createReport('sess-abc', {
          reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        })
      ).rejects.toThrow(BudgetServiceConflictError)

      // 409 is idempotent success - should not retry
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Also verify it's specifically the conflict error, not just any BudgetServiceError
      try {
        await client.createReport('sess-abc', {
          reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        })
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetServiceConflictError)
        // Ensure the caller can use instanceof to differentiate from other errors
        expect(err instanceof BudgetServiceError).toBe(true)
      }
    })

    it('does not retry on 409 Conflict', async () => {
      const fetchMock = mockFetchWithText(false, 409, '{"error":"Report already exists"}')
      const client = clientWith(fetchMock)

      await expect(
        client.createReport('sess-abc', {
          reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
        })
      ).rejects.toThrow(BudgetServiceConflictError)

      // Should only make one attempt - no retries for 409
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

  })

  // ── getReport ──

  describe('getReport', () => {
    it('returns full report', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_REPORT_RESPONSE)
      const client = clientWith(fetchMock)

      const result = await client.getReport('sess-abc', 'rpt-1')

      expect(result.reportId).toBe('rpt-1')
      expect(result.reportItems).toHaveLength(1)
      expect(result.reportItems[0]!.category).toBe('airo-builder:general')
      expect(fetchMock).toHaveBeenCalledWith(
        'https://budget.example.com/api/v1/sessions/sess-abc/reports/rpt-1',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('throws on malformed report', async () => {
      const client = clientWith(mockFetchWithText(true, 200, '{"reportId":"rpt-1"}'))
      await expect(client.getReport('sess-abc', 'rpt-1')).rejects.toThrow(
        'invalid ReportResponse'
      )
    })

    it('rejects report item missing productCost', async () => {
      const badReport = JSON.stringify({
        reportId: 'rpt-1', budgetId: 'b-1', sessionId: 'sess-abc', productKey: 'airo-builder',
        budgetCostTotal: 3.5, productCostTotal: 0, creditsAvailable: 100,
        reportItems: [{ budgetCost: 3.5, label: 'general', budgetItems: [] }],
      })
      const client = clientWith(mockFetchWithText(true, 200, badReport))
      await expect(client.getReport('sess-abc', 'rpt-1')).rejects.toThrow('invalid ReportResponse')
    })

    it('rejects report item missing label', async () => {
      const badReport = JSON.stringify({
        reportId: 'rpt-1', budgetId: 'b-1', sessionId: 'sess-abc', productKey: 'airo-builder',
        budgetCostTotal: 3.5, productCostTotal: 0, creditsAvailable: 100,
        reportItems: [{ budgetCost: 3.5, productCost: 0, budgetItems: [] }],
      })
      const client = clientWith(mockFetchWithText(true, 200, badReport))
      await expect(client.getReport('sess-abc', 'rpt-1')).rejects.toThrow('invalid ReportResponse')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws BudgetServiceAuthError on 401', async () => {
      const client = clientWith(mockFetchWithText(false, 401, '{"error":"Unauthorized"}'))
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceAuthError)
    })

    it('throws BudgetServiceAuthError on 403', async () => {
      const client = clientWith(mockFetchWithText(false, 403, '{"error":"Forbidden"}'))
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceAuthError)
    })

    it('throws BudgetNotFoundError on 404', async () => {
      const client = clientWith(mockFetchWithText(false, 404, '{"error":"Not found"}'))
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetNotFoundError)
    })

    it('throws BudgetServiceError (not a subclass) on other 4xx', async () => {
      const client = clientWith(mockFetchWithText(false, 400, '{"error":"Bad request"}'))

      try {
        await client.getBudget('b-1')
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetServiceError)
        // Ensure it's the base class, not a subclass
        expect(err).not.toBeInstanceOf(BudgetServiceAuthError)
        expect(err).not.toBeInstanceOf(BudgetNotFoundError)
        expect((err as BudgetServiceError).statusCode).toBe(400)
      }
    })

    it('throws BudgetServiceError on 5xx with status and body', async () => {
      const client = clientWith(mockFetchWithText(false, 500, '{"error":"Internal"}'))

      try {
        await client.getBudget('b-1')
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetServiceError)
        expect((err as BudgetServiceError).statusCode).toBe(500)
        expect((err as BudgetServiceError).responseBody).toContain('Internal')
      }
    })

    it('throws BudgetServiceTimeoutError on TypeError with abort message', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError('The operation was aborted')) as unknown as typeof globalThis.fetch
      const client = clientWith(fetchMock)

      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceTimeoutError)
    })

    it('truncates error response body longer than 1024 chars', async () => {
      const longBody = '{"error":"' + 'x'.repeat(1100) + '"}'
      const client = clientWith(mockFetchWithText(false, 500, longBody))

      try {
        await client.getBudget('b-1')
        expect.unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(BudgetServiceError)
        const body = (err as BudgetServiceError).responseBody
        expect(body.length).toBeLessThan(longBody.length)
        expect(body).toContain('...[truncated]')
      }
    })

    it('throws BudgetServiceTimeoutError on timeout', async () => {
      const fetchMock = vi.fn().mockRejectedValue(
        new DOMException('The operation was aborted', 'TimeoutError')
      ) as unknown as typeof globalThis.fetch
      const client = clientWith(fetchMock)

      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceTimeoutError)
    })

    it('throws BudgetServiceTimeoutError when getToken hangs beyond timeout', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_BUDGET_RESPONSE)
      const client = new BudgetServiceClient({
        ...TEST_CONFIG,
        getToken: () => new Promise(() => {}), // never resolves
        tokenTimeoutMs: 50,
        fetch: fetchMock,
      })

      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceTimeoutError)
      await expect(client.getBudget('b-1')).rejects.toThrow('token retrieval timed out')
    })

    it('retries createReport when getToken times out', async () => {
      let callCount = 0
      const fetchMock = mockFetchWithText(true, 200, VALID_CREATE_REPORT_RESPONSE)
      const client = new BudgetServiceClient({
        ...TEST_CONFIG,
        getToken: () => {
          callCount++
          if (callCount === 1) return new Promise(() => {}) // hang on first call
          return Promise.resolve('test-s2s-token')
        },
        tokenTimeoutMs: 50,
        fetch: fetchMock,
      })

      const result = await client.createReport('sess-abc', {
        reportItems: [{ budgetCost: '3.5', productCost: '0', label: 'airo-builder:general' }],
      })
      expect(result.reportId).toBe('rpt-1')
      expect(callCount).toBe(2)
    })

    it('throws BudgetServiceUnavailableError on network error', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof globalThis.fetch
      const client = clientWith(fetchMock)

      await expect(client.getBudget('b-1')).rejects.toThrow(
        BudgetServiceUnavailableError
      )
    })

    it('throws on empty response body', async () => {
      const client = clientWith(mockFetchWithText(true, 200, ''))
      await expect(client.getBudget('b-1')).rejects.toThrow('empty response')
    })

    it('throws on invalid JSON response', async () => {
      const client = clientWith(mockFetchWithText(true, 200, 'not json'))
      await expect(client.getBudget('b-1')).rejects.toThrow('invalid JSON')
    })
  })

  // ── getReportsAggregate ──

  describe('getReportsAggregate', () => {
    const VALID_AGGREGATE = JSON.stringify({
      productKey: 'airo-builder',
      label: '',
      from: '2026-04-12T00:00:00Z',
      to: '2026-05-12T00:00:00Z',
      budgetCostTotal: 12.34,
      productCostTotal: 56.78,
      reportLineCount: 42,
    })

    it('builds query string and parses numeric totals', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_AGGREGATE)
      const client = clientWith(fetchMock)

      const result = await client.getReportsAggregate({
        budgetId: 'b-1',
        productKey: 'airo-builder',
        from: new Date('2026-04-12T00:00:00Z'),
        to: '2026-05-12T00:00:00Z',
      })

      expect(result.budgetCostTotal).toBe(12.34)
      expect(result.productCostTotal).toBe(56.78)
      expect(result.reportLineCount).toBe(42)
      const calledUrl = (fetchMock as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]
      expect(calledUrl).toMatch(/\/api\/v1\/reports\/aggregate\?/)
      expect(calledUrl).toContain('budgetId=b-1')
      expect(calledUrl).toContain('productKey=airo-builder')
      expect(calledUrl).toContain('from=2026-04-12T00%3A00%3A00.000Z')
      expect(calledUrl).toContain('to=2026-05-12T00%3A00%3A00Z')
    })

    it('coerces string-encoded money totals to numbers', async () => {
      const body = JSON.stringify({
        from: '2026-04-12T00:00:00Z',
        to: '2026-05-12T00:00:00Z',
        budgetCostTotal: '7.5',
        productCostTotal: '0',
        reportLineCount: 1,
      })
      const client = clientWith(mockFetchWithText(true, 200, body))
      const result = await client.getReportsAggregate({ productKey: 'p' })
      expect(result.budgetCostTotal).toBe(7.5)
      expect(result.productCostTotal).toBe(0)
    })

    it('omits empty params from query string', async () => {
      const fetchMock = mockFetchWithText(true, 200, VALID_AGGREGATE)
      const client = clientWith(fetchMock)
      await client.getReportsAggregate({ label: 'airo-builder:general' })
      const calledUrl = (fetchMock as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0]
      expect(calledUrl).toContain('label=airo-builder%3Ageneral')
      expect(calledUrl).not.toContain('budgetId=')
      expect(calledUrl).not.toContain('from=')
    })

    it('throws on non-finite money values', async () => {
      const body = JSON.stringify({
        from: 'x',
        to: 'y',
        budgetCostTotal: 'not-a-number',
        productCostTotal: 0,
        reportLineCount: 0,
      })
      const client = clientWith(mockFetchWithText(true, 200, body))
      await expect(client.getReportsAggregate({ productKey: 'p' })).rejects.toThrow(
        'invalid ReportAggregateResponse'
      )
    })
  })
})
