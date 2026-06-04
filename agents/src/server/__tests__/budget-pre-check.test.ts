import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performBudgetPreCheck, type BudgetPreCheckDeps } from '../budget-pre-check.js'
import { BudgetExceededError } from '@airo/ai-common'
import { BudgetServiceError, BudgetServiceUnavailableError, BudgetServiceTimeoutError, BudgetNoCapacityError, BudgetNotFoundError } from '@airo/ai-lib/budget'

describe('performBudgetPreCheck', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }

  const mockBudgetClient = {
    createSession: vi.fn(),
  }

  const deps: BudgetPreCheckDeps = {
    getClient: () => mockBudgetClient as any,
    logger: mockLogger as any,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockBudgetClient.createSession.mockResolvedValue({
      sessionId: 'sess-123',
    })
  })

  describe('when budgetServiceEnabled is false', () => {
    it('returns null without calling budget service', async () => {
      const result = await performBudgetPreCheck(
        { budgetServiceEnabled: false, bmsBudgetId: 'budget-1' },
        deps,
      )

      expect(result).toBeNull()
      expect(mockBudgetClient.createSession).not.toHaveBeenCalled()
    })

    it('returns null when budgetServiceEnabled is undefined', async () => {
      const result = await performBudgetPreCheck(
        { bmsBudgetId: 'budget-1' },
        deps,
      )

      expect(result).toBeNull()
    })
  })

  describe('when bmsBudgetId is missing', () => {
    it('returns null and logs error for graceful degradation', async () => {
      const result = await performBudgetPreCheck(
        { budgetServiceEnabled: true, appId: 'app-1' },
        deps,
      )

      expect(result).toBeNull()
      expect(mockLogger.error).toHaveBeenCalledWith('budget.precheck.skipped', {
        appId: 'app-1',
        reason: 'bmsBudgetId missing from context metadata',
        budgetServiceEnabled: true,
      })
      expect(mockBudgetClient.createSession).not.toHaveBeenCalled()
    })

    it('does not throw - degrades gracefully for availability', async () => {
      // This verifies the intentional fail-open behavior
      await expect(
        performBudgetPreCheck({ budgetServiceEnabled: true }, deps),
      ).resolves.toBeNull()
    })
  })

  describe('when subscriptionId is missing', () => {
    it('logs warning but continues with session creation', async () => {
      const result = await performBudgetPreCheck(
        { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', appId: 'app-1' },
        deps,
      )

      expect(result).toEqual({
        budgetId: 'budget-1',
        sessionId: 'sess-123',
      })
      expect(mockLogger.warn).toHaveBeenCalledWith('budget.precheck.subscriptionId_missing', {
        appId: 'app-1',
        budgetId: 'budget-1',
        reason: 'subscriptionId missing - session will be attributed to customer',
      })
    })
  })

  describe('when budget service client is not configured', () => {
    it('returns null and logs fail_open (fail-open for availability)', async () => {
      const noBudgetClientDeps: BudgetPreCheckDeps = {
        getClient: () => null,
        logger: mockLogger as any,
      }

      const result = await performBudgetPreCheck(
        { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', subscriptionId: 'sub-1', appId: 'app-1' },
        noBudgetClientDeps,
      )

      expect(result).toBeNull()
      expect(mockLogger.error).toHaveBeenCalledWith('budget.precheck.fail_open', {
        appId: 'app-1',
        budgetId: 'budget-1',
        subscriptionId: 'sub-1',
        reason: 'bms_client_not_configured',
        error: 'Budget Service client not configured (missing BUDGET_SERVICE_URL)',
      })
    })
  })

  describe('when budget has no capacity (402 from BMS)', () => {
    it('throws BudgetExceededError when createSession returns 402', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetNoCapacityError('Budget Service no capacity: POST /api/v1/sessions', '{"code":"NO_BUDGET_CAPACITY"}')
      )

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1' },
          deps,
        ),
      ).rejects.toThrow(BudgetExceededError)
    })

    it('includes budgetId in the BudgetExceededError', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetNoCapacityError('Budget Service no capacity: POST /api/v1/sessions', '{"code":"NO_BUDGET_CAPACITY"}')
      )

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1' },
          deps,
        ),
      ).rejects.toMatchObject({
        responseBody: expect.stringContaining('budget-1'),
      })
    })

    it('logs budget.precheck.no_capacity warn when allowOverage is false', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetNoCapacityError('Budget Service no capacity: POST /api/v1/sessions', '{"code":"NO_BUDGET_CAPACITY"}')
      )

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', subscriptionId: 'sub-1', appId: 'app-1' },
          deps,
        ),
      ).rejects.toThrow(BudgetExceededError)

      expect(mockLogger.warn).toHaveBeenCalledWith('budget.precheck.no_capacity', expect.objectContaining({ budgetId: 'budget-1' }))
      expect(mockLogger.error).not.toHaveBeenCalledWith('budget.precheck.overage_bypass_failed', expect.anything())
    })

    it('throws BudgetExceededError even when allowOverage is true (zero budget_items case)', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetNoCapacityError('Budget Service no capacity: POST /api/v1/sessions', '{"code":"NO_BUDGET_CAPACITY"}')
      )

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', allowOverage: true },
          deps,
        ),
      ).rejects.toThrow(BudgetExceededError)
    })

    it('logs budget.precheck.overage_bypass_failed error when allowOverage is true', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetNoCapacityError('Budget Service no capacity: POST /api/v1/sessions', '{"code":"NO_BUDGET_CAPACITY"}')
      )

      await expect(
        performBudgetPreCheck(
          {
            budgetServiceEnabled: true,
            bmsBudgetId: 'budget-1',
            subscriptionId: 'airo-builder:care-agent',
            appId: 'app-1',
            allowOverage: true,
          },
          deps,
        ),
      ).rejects.toThrow(BudgetExceededError)

      expect(mockLogger.error).toHaveBeenCalledWith('budget.precheck.overage_bypass_failed', {
        appId: 'app-1',
        subscriptionId: 'airo-builder:care-agent',
        budgetId: 'budget-1',
        reason: 'allowOverage=true but BMS returned 402 — budget likely has no budget_items',
        bmsResponse: '{"code":"NO_BUDGET_CAPACITY"}',
      })
      expect(mockLogger.warn).not.toHaveBeenCalledWith('budget.precheck.no_capacity', expect.anything())
    })
  })

  describe('when budget is not found (404 from BMS)', () => {
    it('logs error and re-throws BudgetNotFoundError for fail-closed behavior', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetNotFoundError('Budget Service not found: POST /api/v1/sessions', '{"code":"NOT_FOUND"}'),
      )

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', subscriptionId: 'sub-1', appId: 'app-1' },
          deps,
        ),
      ).rejects.toThrow(BudgetNotFoundError)

      expect(mockLogger.error).toHaveBeenCalledWith('budget.precheck.budget_not_found', {
        appId: 'app-1',
        budgetId: 'budget-1',
        subscriptionId: 'sub-1',
        reason: 'Budget does not exist in BMS',
        error: 'Budget Service not found: POST /api/v1/sessions',
        responseBody: '{"code":"NOT_FOUND"}',
      })
    })
  })

  describe('successful pre-check', () => {
    it('returns budgetId and sessionId on success', async () => {
      const result = await performBudgetPreCheck(
        {
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          subscriptionId: 'sub-1',
          appId: 'app-1',
        },
        deps,
      )

      expect(result).toEqual({
        budgetId: 'budget-1',
        sessionId: 'sess-123',
      })
    })

    it('calls createSession with the budgetId', async () => {
      await performBudgetPreCheck(
        {
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          subscriptionId: 'sub-1',
          appId: 'app-1',
        },
        deps,
      )

      expect(mockBudgetClient.createSession).toHaveBeenCalledWith('budget-1', { allowOverage: undefined })
    })

    it('logs session start with all context', async () => {
      await performBudgetPreCheck(
        {
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          subscriptionId: 'sub-1',
          appId: 'app-1',
        },
        deps,
      )

      expect(mockLogger.info).toHaveBeenCalledWith('budget.session.started', {
        appId: 'app-1',
        subscriptionId: 'sub-1',
        budgetId: 'budget-1',
        sessionId: 'sess-123',
        allowOverage: false,
      })
    })
  })

  describe('when allowOverage is true', () => {
    it('logs budget.session.overage_allowed before creating the session', async () => {
      await performBudgetPreCheck(
        {
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          subscriptionId: 'airo-builder:care-agent',
          appId: 'app-1',
          allowOverage: true,
        },
        deps,
      )

      const infoCalls = mockLogger.info.mock.calls
      const overageLogIndex = infoCalls.findIndex(([event]) => event === 'budget.session.overage_allowed')
      const startedLogIndex = infoCalls.findIndex(([event]) => event === 'budget.session.started')

      expect(overageLogIndex).toBeGreaterThanOrEqual(0)
      expect(infoCalls[overageLogIndex]![1]).toEqual({
        appId: 'app-1',
        subscriptionId: 'airo-builder:care-agent',
        budgetId: 'budget-1',
        reason: 'allowOverage=true — session will open even if budget is exhausted',
      })
      expect(overageLogIndex).toBeLessThan(startedLogIndex)
    })

    it('passes allowOverage: true to createSession', async () => {
      await performBudgetPreCheck(
        {
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          subscriptionId: 'airo-builder:care-agent',
          appId: 'app-1',
          allowOverage: true,
        },
        deps,
      )

      expect(mockBudgetClient.createSession).toHaveBeenCalledWith('budget-1', { allowOverage: true })
    })

    it('logs budget.session.started with allowOverage: true', async () => {
      await performBudgetPreCheck(
        {
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          subscriptionId: 'airo-builder:care-agent',
          appId: 'app-1',
          allowOverage: true,
        },
        deps,
      )

      expect(mockLogger.info).toHaveBeenCalledWith('budget.session.started', {
        appId: 'app-1',
        subscriptionId: 'airo-builder:care-agent',
        budgetId: 'budget-1',
        sessionId: 'sess-123',
        allowOverage: true,
      })
    })

    it('does not log budget.session.overage_allowed when allowOverage is false', async () => {
      await performBudgetPreCheck(
        {
          budgetServiceEnabled: true,
          bmsBudgetId: 'budget-1',
          subscriptionId: 'sub-1',
          appId: 'app-1',
          allowOverage: false,
        },
        deps,
      )

      const overageLog = mockLogger.info.mock.calls.find(([event]) => event === 'budget.session.overage_allowed')
      expect(overageLog).toBeUndefined()
    })
  })

  describe('fail-open on transient errors', () => {
    it('retries once then returns null when BMS is unreachable', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetServiceUnavailableError('Budget Service unreachable'),
      )

      const result = await performBudgetPreCheck(
        { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', subscriptionId: 'sub-1', appId: 'app-1' },
        deps,
      )

      expect(result).toBeNull()
      expect(mockBudgetClient.createSession).toHaveBeenCalledTimes(2)
      expect(mockLogger.warn).toHaveBeenCalledWith('budget.precheck.retry', expect.objectContaining({
        appId: 'app-1',
        budgetId: 'budget-1',
        subscriptionId: 'sub-1',
        attempt: 1,
        maxAttempts: 2,
        reason: 'bms_unreachable',
      }))
      expect(mockLogger.error).toHaveBeenCalledWith('budget.precheck.fail_open', {
        appId: 'app-1',
        budgetId: 'budget-1',
        subscriptionId: 'sub-1',
        attempts: 2,
        reason: 'bms_unreachable',
        error: 'Budget Service unreachable',
      })
    })

    it('retries once then returns null when BMS times out', async () => {
      mockBudgetClient.createSession.mockRejectedValue(
        new BudgetServiceTimeoutError('Budget Service timeout: POST /api/v1/sessions'),
      )

      const result = await performBudgetPreCheck(
        { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', subscriptionId: 'sub-1', appId: 'app-1' },
        deps,
      )

      expect(result).toBeNull()
      expect(mockBudgetClient.createSession).toHaveBeenCalledTimes(2)
      expect(mockLogger.error).toHaveBeenCalledWith('budget.precheck.fail_open', {
        appId: 'app-1',
        budgetId: 'budget-1',
        subscriptionId: 'sub-1',
        attempts: 2,
        reason: 'bms_timeout',
        error: 'Budget Service timeout: POST /api/v1/sessions',
      })
    })

    it('succeeds on retry if second attempt works', async () => {
      mockBudgetClient.createSession
        .mockRejectedValueOnce(new BudgetServiceUnavailableError('BMS down'))
        .mockResolvedValueOnce({ sessionId: 'sess-retry' })

      const result = await performBudgetPreCheck(
        { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', subscriptionId: 'sub-1', appId: 'app-1' },
        deps,
      )

      expect(result).toEqual({ budgetId: 'budget-1', sessionId: 'sess-retry' })
      expect(mockBudgetClient.createSession).toHaveBeenCalledTimes(2)
      expect(mockLogger.warn).toHaveBeenCalledWith('budget.precheck.retry', expect.objectContaining({
        attempt: 1,
      }))
    })

    it('still throws non-transient BudgetServiceError without retry', async () => {
      const unknownError = new BudgetServiceError('Budget Service error: POST /api/v1/sessions', 500, '{"code":"INTERNAL"}')
      mockBudgetClient.createSession.mockRejectedValue(unknownError)

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1' },
          deps,
        ),
      ).rejects.toThrow(BudgetServiceError)
      expect(mockBudgetClient.createSession).toHaveBeenCalledTimes(1)
    })

    it('throws non-transient error on retry even after transient error on first attempt', async () => {
      mockBudgetClient.createSession
        .mockRejectedValueOnce(new BudgetServiceUnavailableError('BMS down'))
        .mockRejectedValueOnce(new BudgetServiceError('Budget Service auth failed', 401, '{"code":"UNAUTHORIZED"}'))

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1', subscriptionId: 'sub-1', appId: 'app-1' },
          deps,
        ),
      ).rejects.toThrow(BudgetServiceError)
      expect(mockBudgetClient.createSession).toHaveBeenCalledTimes(2)
    })
  })
})
