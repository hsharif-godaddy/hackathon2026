import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performBudgetPreCheck, type BudgetPreCheckDeps } from '../budget-pre-check.js'
import { BudgetExceededError } from '@airo/ai-common'
import { BudgetServiceUnavailableError, BudgetNoCapacityError } from '@airo/ai-lib/budget'

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
    it('throws BudgetServiceUnavailableError', async () => {
      const noBudgetClientDeps: BudgetPreCheckDeps = {
        getClient: () => null,
        logger: mockLogger as any,
      }

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1' },
          noBudgetClientDeps,
        ),
      ).rejects.toThrow(BudgetServiceUnavailableError)
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

      expect(mockBudgetClient.createSession).toHaveBeenCalledWith('budget-1')
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
      })
    })
  })

  describe('error propagation', () => {
    it('propagates non-capacity errors from createSession', async () => {
      const serviceError = new BudgetServiceUnavailableError('Budget Service unreachable')
      mockBudgetClient.createSession.mockRejectedValue(serviceError)

      await expect(
        performBudgetPreCheck(
          { budgetServiceEnabled: true, bmsBudgetId: 'budget-1' },
          deps,
        ),
      ).rejects.toThrow(BudgetServiceUnavailableError)
    })
  })
})
