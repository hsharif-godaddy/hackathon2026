import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BudgetExceededError } from '@airo/ai-common'
import {
  BudgetServiceUnavailableError,
  BudgetServiceTimeoutError,
  BudgetServiceError,
  BudgetServiceAuthError,
} from '@airo/ai-lib/budget'
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
      { budgetServiceEnabled: true, subscriptionId: 'sub-1', appId: 'app-1' },
      deps,
    )

    expect(result).toEqual({ budgetId: 'sub-1', sessionId: 'sess-abc' })
    expect(client.getBudget).toHaveBeenCalledWith('sub-1')
    expect(client.createSession).toHaveBeenCalledWith('sub-1')
    expect(deps.logger.info).toHaveBeenCalledWith('budget.session.started', expect.objectContaining({
      subscriptionId: 'sub-1',
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
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toSatisfy((err: any) => {
      expect(BudgetExceededError.isInstance(err)).toBe(true)
      expect(err.statusCode).toBe(402)
      expect(err.message).toBe('Your AI usage budget has been reached.')
      // budgetId in responseBody only, not in message
      expect(JSON.parse(err.responseBody).budgetId).toBe('sub-1')
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
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
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
      { budgetServiceEnabled: true },
      makeDeps(),
    )).rejects.toThrow(BudgetServiceUnavailableError)
  })

  it('throws BudgetServiceUnavailableError when client not configured', async () => {
    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
      makeDeps({ getClient: () => null }),
    )).rejects.toThrow(BudgetServiceUnavailableError)
  })

  it('propagates BudgetServiceTimeoutError from getBudget', async () => {
    const client = mockClient({
      getBudget: vi.fn().mockRejectedValue(new BudgetServiceTimeoutError('getBudget timed out')),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toThrow(BudgetServiceTimeoutError)
  })

  it('propagates BudgetServiceUnavailableError from createSession', async () => {
    const client = mockClient({
      createSession: vi.fn().mockRejectedValue(new BudgetServiceUnavailableError('BMS down')),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toThrow(BudgetServiceUnavailableError)
  })

  it('propagates BudgetServiceTimeoutError from createSession', async () => {
    const client = mockClient({
      createSession: vi.fn().mockRejectedValue(new BudgetServiceTimeoutError('session timed out')),
    })

    await expect(performBudgetPreCheck(
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
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
      { budgetServiceEnabled: true, subscriptionId: 'sub-1' },
      makeDeps({ getClient: () => client }),
    )).rejects.toThrow()

    expect(client.createSession).not.toHaveBeenCalled()
  })
})

// ── Group 2: Error mapping contract tests ──
// Verifies budget error instances match the conditions used in
// experimental-websocket-server.ts catch block (lines 2225-2255).

describe('budget error mapping contracts', () => {
  it('BudgetExceededError.fromBudgetCheck is detected by isInstance', () => {
    const err = BudgetExceededError.fromBudgetCheck('sub-1')
    expect(BudgetExceededError.isInstance(err)).toBe(true)
    expect(err.errorType).toBe('BUDGET_EXCEEDED')
    expect(err.statusCode).toBe(402)
    // message is generic -- no budgetId
    expect(err.message).not.toContain('sub-1')
  })

  it('BudgetServiceUnavailableError matches name check', () => {
    const err = new BudgetServiceUnavailableError('unavailable')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('BudgetServiceUnavailableError')
  })

  it('BudgetServiceTimeoutError matches name check', () => {
    const err = new BudgetServiceTimeoutError('timeout')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('BudgetServiceTimeoutError')
  })

  it('BudgetServiceError 5xx matches name + statusCode check', () => {
    const err = new BudgetServiceError('server error', 500, '{}')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('BudgetServiceError')
    expect(err.statusCode).toBeGreaterThanOrEqual(500)
  })

  it('BudgetServiceError 429 matches name + statusCode check', () => {
    const err = new BudgetServiceError('rate limited', 429, '{}')
    expect(err.name).toBe('BudgetServiceError')
    expect(err.statusCode).toBe(429)
  })

  it('BudgetServiceAuthError matches name check', () => {
    const err = new BudgetServiceAuthError('auth failed', 401, '{}')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('BudgetServiceAuthError')
  })

  it('BudgetServiceError 404 falls through to catch-all (name only)', () => {
    const err = new BudgetServiceError('not found', 404, '{}')
    // Not matched by 5xx/429 branch
    expect(err.statusCode).not.toBeGreaterThanOrEqual(500)
    expect(err.statusCode).not.toBe(429)
    // Not BudgetServiceAuthError
    expect(err.name).not.toBe('BudgetServiceAuthError')
    // Caught by catch-all: name === 'BudgetServiceError'
    expect(err.name).toBe('BudgetServiceError')
  })

  it('BudgetServiceError subclasses share BudgetServiceError name ancestry', () => {
    // UnavailableError and TimeoutError extend BudgetServiceError but override name.
    // The catch block checks name strings, so subclass names must NOT match
    // the base 'BudgetServiceError' to avoid falling into the wrong branch.
    const unavailable = new BudgetServiceUnavailableError('down')
    const timeout = new BudgetServiceTimeoutError('slow')
    const auth = new BudgetServiceAuthError('bad creds', 401, '{}')

    expect(unavailable.name).not.toBe('BudgetServiceError')
    expect(timeout.name).not.toBe('BudgetServiceError')
    expect(auth.name).not.toBe('BudgetServiceError')
  })
})
