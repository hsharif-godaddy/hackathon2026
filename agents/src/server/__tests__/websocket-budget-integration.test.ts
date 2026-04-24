import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BudgetExceededError } from '@airo/ai-common'
import {
  BudgetServiceUnavailableError,
  BudgetServiceTimeoutError,
  BudgetServiceError,
  BudgetServiceAuthError,
  BudgetNotFoundError,
  toBudgetUpdatePayload,
} from '@airo/ai-lib/budget'
import { isBudgetServiceError, mapBudgetErrorToResponse, BudgetErrorType } from '@airo/shared/budget'
import { BudgetOverride } from '@airo/ai-grants'
import { performBudgetPreCheck, type BudgetPreCheckDeps } from '../budget-pre-check.js'

// ── Helpers ──

function makeDeps(overrides?: Partial<BudgetPreCheckDeps>): BudgetPreCheckDeps {
  return {
    getClient: () => null,
    logger: { info: vi.fn() },
    ...overrides,
  }
}

function mockClient(overrides?: {
  getBudget?: ReturnType<typeof vi.fn>
  createSession?: ReturnType<typeof vi.fn>
}) {
  return {
    getBudget: overrides?.getBudget ?? vi.fn().mockResolvedValue({
      budgetId: 'sub-1',
      productKey: 'airo-builder',
      creditsTotal: '150.000000',
      creditsUsed: '50.000000',
      creditsPending: '0.000000',
      items: [],
    }),
    createSession: overrides?.createSession ?? vi.fn().mockResolvedValue({ sessionId: 'sess-abc' }),
  } as any
}

// ── Group 1: Budget pre-check + session creation ──

describe('performBudgetPreCheck', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns null when budgetServiceEnabled is false', async () => {
    const result = await performBudgetPreCheck(
      { budgetServiceEnabled: false, subscriptionId: 'sub-1' },
      makeDeps(),
    )
    expect(result).toBeNull()
  })

  it('returns null when budgetServiceEnabled is undefined', async () => {
    const result = await performBudgetPreCheck(
      { subscriptionId: 'sub-1' },
      makeDeps(),
    )
    expect(result).toBeNull()
  })

  it('happy path: remaining > 0, session created', async () => {
    const client = mockClient()
    const deps = makeDeps({ getClient: () => client })

    const result = await performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1', appId: 'app-1' },
      deps,
    )

    expect(result).toEqual({ budgetId: 'budget-1', sessionId: 'sess-abc' })
    expect(client.getBudget).toHaveBeenCalledWith('budget-1')
    expect(client.createSession).toHaveBeenCalledWith('budget-1')
    expect(deps.logger.info).toHaveBeenCalledWith('budget.session.started', expect.objectContaining({
      subscriptionId: 'sub-1',
      budgetId: 'budget-1',
      sessionId: 'sess-abc',
    }))
  })

  it('throws BudgetExceededError when remaining <= 0', async () => {
    const client = mockClient({
      getBudget: vi.fn().mockResolvedValue({
        creditsTotal: '100.000000',
        creditsUsed: '100.000000',
      }),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toSatisfy((err: any) => {
      expect(BudgetExceededError.isInstance(err)).toBe(true)
      expect(err.statusCode).toBe(402)
      expect(err.message).toBe('Your AI usage budget has been reached.')
      // budgetId in responseBody only, not in message
      expect(JSON.parse(err.responseBody).budgetId).toBe('budget-1')
      return true
    })
  })

  it('throws BudgetExceededError when computeRemaining returns NaN (fail-closed)', async () => {
    const client = mockClient({
      getBudget: vi.fn().mockResolvedValue({
        creditsTotal: '',
        creditsUsed: '0',
      }),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toSatisfy((err: any) => {
      expect(BudgetExceededError.isInstance(err)).toBe(true)
      return true
    })
  })

  it('returns null when subscriptionId is BudgetOverride.CareAgent', async () => {
    const result = await performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: BudgetOverride.CareAgent },
      makeDeps(),
    )
    expect(result).toBeNull()
  })

  it('returns null when subscriptionId is BudgetOverride.TestAccounts', async () => {
    const result = await performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: BudgetOverride.TestAccounts },
      makeDeps(),
    )
    expect(result).toBeNull()
  })

  it('throws BudgetServiceUnavailableError when subscriptionId missing', async () => {
    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, bmsBudgetId: 'budget-1' },
      makeDeps(),
    )).rejects.toThrow(BudgetServiceUnavailableError)
  })

  it('throws BudgetServiceUnavailableError when bmsBudgetId missing', async () => {
    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
      makeDeps({ getClient: () => mockClient() }),
    )).rejects.toThrow(BudgetServiceUnavailableError)
  })

  it('throws BudgetServiceUnavailableError when client not configured', async () => {
    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1' },
      makeDeps({ getClient: () => null }),
    )).rejects.toThrow(BudgetServiceUnavailableError)
  })

  it('propagates BudgetServiceTimeoutError from getBudget', async () => {
    const client = mockClient({
      getBudget: vi.fn().mockRejectedValue(new BudgetServiceTimeoutError('getBudget timed out')),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toThrow(BudgetServiceTimeoutError)
  })

  it('propagates BudgetServiceUnavailableError from createSession', async () => {
    const client = mockClient({
      createSession: vi.fn().mockRejectedValue(new BudgetServiceUnavailableError('BMS down')),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toThrow(BudgetServiceUnavailableError)
  })

  it('propagates BudgetServiceTimeoutError from createSession', async () => {
    const client = mockClient({
      createSession: vi.fn().mockRejectedValue(new BudgetServiceTimeoutError('session timed out')),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toThrow(BudgetServiceTimeoutError)
  })

  it('does not call createSession when budget check fails', async () => {
    const client = mockClient({
      getBudget: vi.fn().mockResolvedValue({
        creditsTotal: '0',
        creditsUsed: '0',
      }),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', bmsBudgetId: 'budget-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toThrow()

    expect(client.createSession).not.toHaveBeenCalled()
  })
})

// ── Group 2: Error mapping contract tests ──
// Verifies budget error instances are detected by isBudgetServiceError() and
// mapBudgetErrorToResponse() returns sanitized client-safe responses.

describe('budget error mapping contracts', () => {
  it('BudgetExceededError.fromBudgetCheck is detected by isInstance', () => {
    const err = BudgetExceededError.fromBudgetCheck('sub-1')
    expect(BudgetExceededError.isInstance(err)).toBe(true)
    expect(err.errorType).toBe('BUDGET_EXCEEDED')
    expect(err.statusCode).toBe(402)
    // message is generic -- no budgetId
    expect(err.message).not.toContain('sub-1')
  })

  it('all BudgetServiceError subclasses detected by isBudgetServiceError', () => {
    expect(isBudgetServiceError(new BudgetServiceUnavailableError('unavailable'))).toBe(true)
    expect(isBudgetServiceError(new BudgetServiceTimeoutError('timeout'))).toBe(true)
    expect(isBudgetServiceError(new BudgetServiceAuthError('auth failed', 401, '{}'))).toBe(true)
    expect(isBudgetServiceError(new BudgetNotFoundError('not found', '{}'))).toBe(true)
    expect(isBudgetServiceError(new BudgetServiceError('generic', 500, '{}'))).toBe(true)
  })

  it('isBudgetServiceError rejects non-budget errors', () => {
    expect(isBudgetServiceError(new Error('plain error'))).toBe(false)
    expect(isBudgetServiceError(null)).toBe(false)
    expect(isBudgetServiceError({ message: 'fake' })).toBe(false)
  })

  it('BudgetServiceUnavailableError maps to 503 unavailable', () => {
    const response = mapBudgetErrorToResponse(new BudgetServiceUnavailableError('unavailable'))
    expect(response.errorType).toBe(BudgetErrorType.BUDGET_SERVICE_UNAVAILABLE)
    expect(response.statusCode).toBe(503)
    expect(response.message).toBe('Budget service temporarily unavailable')
  })

  it('BudgetServiceTimeoutError maps to 503 unavailable', () => {
    const response = mapBudgetErrorToResponse(new BudgetServiceTimeoutError('timeout'))
    expect(response.errorType).toBe(BudgetErrorType.BUDGET_SERVICE_UNAVAILABLE)
    expect(response.statusCode).toBe(503)
  })

  it('BudgetServiceAuthError maps to auth error preserving status code', () => {
    const response401 = mapBudgetErrorToResponse(new BudgetServiceAuthError('unauthorized', 401, '{}'))
    expect(response401.errorType).toBe(BudgetErrorType.BUDGET_SERVICE_AUTH_ERROR)
    expect(response401.statusCode).toBe(401)

    const response403 = mapBudgetErrorToResponse(new BudgetServiceAuthError('forbidden', 403, '{}'))
    expect(response403.errorType).toBe(BudgetErrorType.BUDGET_SERVICE_AUTH_ERROR)
    expect(response403.statusCode).toBe(403)
  })

  it('BudgetNotFoundError maps to 404 not found', () => {
    const response = mapBudgetErrorToResponse(new BudgetNotFoundError('not found', '{}'))
    expect(response.errorType).toBe(BudgetErrorType.BUDGET_NOT_FOUND)
    expect(response.statusCode).toBe(404)
    expect(response.message).toBe('Budget resource not found')
  })

  it('generic BudgetServiceError 5xx maps to service error', () => {
    const response = mapBudgetErrorToResponse(new BudgetServiceError('server error', 500, '{}'))
    expect(response.errorType).toBe(BudgetErrorType.BUDGET_SERVICE_ERROR)
    expect(response.statusCode).toBe(500)
    expect(response.message).toBe('Budget service error')
  })

  it('generic BudgetServiceError 4xx maps to request failed', () => {
    const response = mapBudgetErrorToResponse(new BudgetServiceError('bad request', 400, '{}'))
    expect(response.errorType).toBe(BudgetErrorType.BUDGET_SERVICE_ERROR)
    expect(response.statusCode).toBe(400)
    expect(response.message).toBe('Budget service request failed')
  })
})

// ── Group 3: Budget report creation (onBudgetReport callback logic) ──

describe('budget report creation', () => {
  function mockReportClient(overrides?: {
    getSession?: ReturnType<typeof vi.fn>
    createReport?: ReturnType<typeof vi.fn>
    getBudget?: ReturnType<typeof vi.fn>
  }) {
    return {
      getSession: overrides?.getSession ?? vi.fn().mockResolvedValue({
        costTotal: 0.05,
        sessionItems: [],
      }),
      // createReport returns full ReportResponse (BMS response parity, PR #2577)
      createReport: overrides?.createReport ?? vi.fn().mockResolvedValue({
        reportId: 'report-1',
        budgetId: 'budget-1',
        sessionId: 'session-1',
        productKey: 'airo-builder',
        budgetCostTotal: 0.05,
        productCostTotal: 0,
        creditsAvailable: 99.95,
        reportItems: [{
          reportItemId: 'ri-1',
          budgetCost: 0.05,
          productCost: 0,
          category: 'airo-builder:general',
          createdAt: '2026-04-06T12:00:00Z',
          budgetItems: [{ budgetItemId: 'bi-1', creditsUsed: 0.075 }],
        }],
      }),
      getBudget: overrides?.getBudget ?? vi.fn().mockResolvedValue({
        budgetId: 'budget-1',
        productKey: 'airo-builder',
        creditsTotal: '100.000000',
        creditsUsed: '0.075000',
        creditsPending: '0.000000',
        items: [{
          budgetItemId: 'bi-1',
          creditsTotal: '100.000000',
          creditsUsed: '0.075000',
          costToCreditRatio: '1.500000',
          startsAt: null,
          expiresAt: null,
          resetInterval: null,
        }],
      }),
    } as any
  }

  // Simulate the onBudgetReport callback logic (mirrors ai-lib-websocket-server.ts)
  async function simulateOnBudgetReport(
    client: ReturnType<typeof mockReportClient>,
    budgetId: string,
    sessionId: string,
  ) {
    const session = await client.getSession(sessionId)
    // createReport is the critical path -- must not be blocked by getBudget
    const report = await client.createReport(sessionId, {
      reportItems: [{
        budgetCost: session.costTotal.toString(),
        productCost: '0',
        label: 'airo-builder:general',
      }],
    })
    // getBudget for per-item breakdown (graceful degradation)
    try {
      const budget = await client.getBudget(budgetId)
      return { refreshRequired: false as const, payload: toBudgetUpdatePayload(report, budget) }
    } catch {
      return { refreshRequired: true as const }
    }
  }

  it('happy path: creates report and returns payload', async () => {
    const client = mockReportClient()
    const result = await simulateOnBudgetReport(client, 'budget-1', 'session-1')

    expect(result.refreshRequired).toBe(false)
    expect(client.getSession).toHaveBeenCalledWith('session-1')
    expect(client.createReport).toHaveBeenCalledWith('session-1', {
      reportItems: [{ budgetCost: '0.05', productCost: '0', label: 'airo-builder:general' }],
    })
    if (!result.refreshRequired) {
      expect(result.payload.customerRemaining).toBe(99.925)
    }
  })

  it('zero-cost session: creates report with budgetCost 0', async () => {
    const client = mockReportClient({
      getSession: vi.fn().mockResolvedValue({ costTotal: 0, sessionItems: [] }),
    })
    const result = await simulateOnBudgetReport(client, 'budget-1', 'session-1')

    expect(result.refreshRequired).toBe(false)
    expect(client.createReport).toHaveBeenCalledWith('session-1', {
      reportItems: [{ budgetCost: '0', productCost: '0', label: 'airo-builder:general' }],
    })
  })

  it('getSession throws: propagates error (no report created)', async () => {
    const client = mockReportClient({
      getSession: vi.fn().mockRejectedValue(new BudgetServiceError('session not found', 404, '{}')),
    })

    await expect(simulateOnBudgetReport(client, 'budget-1', 'session-1'))
      .rejects.toThrow(BudgetServiceError)
    expect(client.createReport).not.toHaveBeenCalled()
  })

  it('getBudget fails after createReport: returns refreshRequired (credits still deducted)', async () => {
    const client = mockReportClient({
      getBudget: vi.fn().mockRejectedValue(new BudgetServiceError('budget not found', 404, '{}')),
    })
    const result = await simulateOnBudgetReport(client, 'budget-1', 'session-1')

    expect(result.refreshRequired).toBe(true)
    expect(client.createReport).toHaveBeenCalled()
  })

  it('createReport throws: propagates error', async () => {
    const client = mockReportClient({
      createReport: vi.fn().mockRejectedValue(new BudgetServiceUnavailableError('BMS down')),
    })

    await expect(simulateOnBudgetReport(client, 'budget-1', 'session-1'))
      .rejects.toThrow(BudgetServiceUnavailableError)
  })
})

// ── Group 4: restoreBudgetMetadata helper ──

import { restoreBudgetMetadata } from '@airo/ai-transport'

describe('restoreBudgetMetadata', () => {
  it('restores both fields from conversation.context to processedContext.metadata', () => {
    const ctx: Record<string, unknown> = { metadata: { appId: 'app-1' } }
    restoreBudgetMetadata({ bmsBudgetId: 'b-1', budgetSessionId: 's-1' }, ctx)
    expect((ctx.metadata as any).bmsBudgetId).toBe('b-1')
    expect((ctx.metadata as any).budgetSessionId).toBe('s-1')
  })

  it('skips when conversation.context has no budget fields', () => {
    const ctx: Record<string, unknown> = { metadata: { appId: 'app-1' } }
    restoreBudgetMetadata({}, ctx)
    expect((ctx.metadata as any).bmsBudgetId).toBeUndefined()
  })

  it('skips when only one budget field is present (partial)', () => {
    const ctx: Record<string, unknown> = { metadata: { appId: 'app-1' } }
    restoreBudgetMetadata({ bmsBudgetId: 'b-1' }, ctx)
    expect((ctx.metadata as any).bmsBudgetId).toBeUndefined()
  })

  it('creates metadata object when absent', () => {
    const ctx: Record<string, unknown> = {}
    restoreBudgetMetadata({ bmsBudgetId: 'b-1', budgetSessionId: 's-1' }, ctx)
    expect((ctx.metadata as any).bmsBudgetId).toBe('b-1')
    expect((ctx.metadata as any).budgetSessionId).toBe('s-1')
  })
})

// Note: Grant-fallback budget header removal (unified-provider.ts:385) is covered
// by the fix in createS2SFetchWrapper but cannot be unit-tested without exporting
// internal functions. The metadata contract is tested in build-metadata.test.ts
// (BudgetOverride exclusion, partial field handling, grant+budget combo).
