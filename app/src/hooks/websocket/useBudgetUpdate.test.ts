/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-hooks/rules-of-hooks */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetItem, BudgetUpdatePayload } from '@airo/shared/budget'

import { renderHookWithProviders } from '@/tests/test-utils'
import { type BudgetUpdateController,useBudgetUpdate } from './useBudgetUpdate'

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockUseSwitchboard = vi.fn()
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (flag: string) => mockUseSwitchboard(flag),
}))

const mockInvalidateQueries = vi.fn()
const mockSetQueryData = vi.fn()
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query')
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: mockSetQueryData,
    }),
  }
})

const mockAdaptBudgetItemsToGrants = vi.fn()
vi.mock('@/lib/credit-adapter/adapt-budget-to-grants', () => ({
  adaptBudgetItemsToGrants: (...args: unknown[]) => mockAdaptBudgetItemsToGrants(...args),
}))

import { logger } from '@/lib/request-context'

function createBudgetItem(overrides: Partial<BudgetItem> = {}): BudgetItem {
  return {
    budgetItemId: 'item-1',
    creditsTotal: '100.000000',
    creditsUsed: '10.000000',
    costToCreditRatio: '1.000000',
    startsAt: '2024-01-01T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
    resetInterval: null,
    ...overrides,
  }
}

function createController(): {
  controller: BudgetUpdateController
  triggerUpdate: (payload: BudgetUpdatePayload) => void
  cleanup: ReturnType<typeof vi.fn>
} {
  let callback: ((data: BudgetUpdatePayload) => void) | null = null
  const cleanup = vi.fn()

  return {
    controller: {
      onBudgetUpdate: (cb) => {
        callback = cb
        return cleanup
      },
    },
    triggerUpdate: (payload) => {
      callback?.(payload)
    },
    cleanup,
  }
}

describe('useBudgetUpdate', function useBudgetUpdateTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
    mockUseSwitchboard.mockReturnValue(true) // Default: BMS enabled (this hook only runs in BMS mode)
    mockAdaptBudgetItemsToGrants.mockReturnValue([{ id: 'grant-1' }])
  })

  describe('BMS flag gating', function bmsFlagTests() {
    it('does not subscribe when BMS flag is disabled', function bmsDisabledNoSubscribe() {
      mockUseSwitchboard.mockReturnValue(false)
      const { controller, cleanup } = createController()

      renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
          enabled: true,
        })
      )

      // Should not have subscribed to budget updates
      expect(cleanup).not.toHaveBeenCalled()
    })

    it('does not subscribe when enabled is false', function enabledFalseNoSubscribe() {
      const { controller, cleanup } = createController()

      renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
          enabled: false,
        })
      )

      expect(cleanup).not.toHaveBeenCalled()
    })

    it('subscribes when BMS flag is enabled and enabled=true', function bmsEnabledSubscribes() {
      const { controller, cleanup } = createController()

      const { unmount } = renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
          enabled: true,
        })
      )

      // Cleanup should be called on unmount (proves subscription happened)
      unmount()
      expect(cleanup).toHaveBeenCalled()
    })
  })

  describe('refreshRequired=true path', function refreshRequiredTests() {
    it('invalidates credit-grants query when refreshRequired is true', function invalidatesOnRefreshRequired() {
      const { controller, triggerUpdate } = createController()

      renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
        })
      )

      triggerUpdate({ refreshRequired: true })

      expect(logger.info).toHaveBeenCalledWith('budget.update.invalidating', {
        subscriptionId: 'sub-1',
      })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['credit-grants'] })
      expect(mockSetQueryData).not.toHaveBeenCalled()
    })
  })

  describe('refreshRequired=false without subscriptionId', function noSubscriptionIdTests() {
    it('logs error and invalidates when subscriptionId is undefined', function logsErrorNoSubId() {
      const { controller, triggerUpdate } = createController()

      renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: undefined,
        })
      )

      triggerUpdate({
        refreshRequired: false,
        customerRemaining: 90,
        assignment: { customer: [], reportItems: [] },
        budgetItems: [createBudgetItem()],
        budgetId: 'budget-1',
        sessionWasFree: false,
      })

      expect(logger.error).toHaveBeenCalledWith('budget.update.no_subscription_id', {
        message: 'Cannot update cache without subscriptionId - hook mounted in unexpected state',
      })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['credit-grants'] })
      expect(mockSetQueryData).not.toHaveBeenCalled()
    })
  })

  describe('happy path - cache update', function happyPathTests() {
    it('adapts budget items and updates both cache variants', function updatesBothCacheVariants() {
      const { controller, triggerUpdate } = createController()
      const mockGrants = [{ id: 'adapted-grant-1' }, { id: 'adapted-grant-2' }]
      mockAdaptBudgetItemsToGrants.mockReturnValue(mockGrants)

      const budgetItem = createBudgetItem({ budgetItemId: 'item-happy' })

      renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-happy',
        })
      )

      triggerUpdate({
        refreshRequired: false,
        customerRemaining: 90,
        assignment: { customer: [], reportItems: [] },
        budgetItems: [budgetItem],
        budgetId: 'budget-happy',
        sessionWasFree: false,
      })

      // Should call adapter with correct args
      expect(mockAdaptBudgetItemsToGrants).toHaveBeenCalledWith(
        [budgetItem],
        'budget-happy',
        'sub-happy'
      )

      // Should log cache update with reportItems info
      expect(logger.info).toHaveBeenCalledWith('budget.update.cache_updated', {
        subscriptionId: 'sub-happy',
        grantCount: 2,
        reportItemCount: 0,
        sessionWasFree: false,
      })

      // Should update both syncSpend variants
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ['credit-grants', 'sub-happy', true],
        mockGrants
      )
      expect(mockSetQueryData).toHaveBeenCalledWith(
        ['credit-grants', 'sub-happy', false],
        mockGrants
      )
      expect(mockInvalidateQueries).not.toHaveBeenCalled()
    })

    it('logs sessionWasFree=true when server indicates session was free', function sessionWasFreeTrue() {
      const { controller, triggerUpdate } = createController()
      mockAdaptBudgetItemsToGrants.mockReturnValue([{ id: 'grant-1' }])

      renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-free',
        })
      )

      triggerUpdate({
        refreshRequired: false,
        customerRemaining: 100,
        assignment: {
          customer: [],
          reportItems: [
            { budgetCost: 0, productCost: 5, category: 'airo-builder:tool-failure' },
            { budgetCost: 0, productCost: 3, category: 'airo-builder:no-output' },
          ],
        },
        budgetItems: [createBudgetItem()],
        budgetId: 'budget-free',
        sessionWasFree: true,
      })

      expect(logger.info).toHaveBeenCalledWith('budget.update.cache_updated', {
        subscriptionId: 'sub-free',
        grantCount: 1,
        reportItemCount: 2,
        sessionWasFree: true,
      })
    })

    it('logs sessionWasFree=false when session had customer cost', function sessionWasFreeFalse() {
      const { controller, triggerUpdate } = createController()
      mockAdaptBudgetItemsToGrants.mockReturnValue([{ id: 'grant-1' }])

      renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-paid',
        })
      )

      triggerUpdate({
        refreshRequired: false,
        customerRemaining: 95,
        assignment: {
          customer: [{ budgetItemId: 'item-1', amount: 5 }],
          reportItems: [
            { budgetCost: 5, productCost: 0, category: 'airo-builder:general' },
          ],
        },
        budgetItems: [createBudgetItem()],
        budgetId: 'budget-paid',
        sessionWasFree: false,
      })

      expect(logger.info).toHaveBeenCalledWith('budget.update.cache_updated', {
        subscriptionId: 'sub-paid',
        grantCount: 1,
        reportItemCount: 1,
        sessionWasFree: false,
      })
    })
  })

  describe('cleanup', function cleanupTests() {
    it('unsubscribes on unmount', function unsubscribesOnUnmount() {
      const { controller, cleanup } = createController()

      const { unmount } = renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
        })
      )

      expect(cleanup).not.toHaveBeenCalled()
      unmount()
      expect(cleanup).toHaveBeenCalledTimes(1)
    })

    it('unsubscribes and resubscribes when controller changes', function resubscribesOnControllerChange() {
      const first = createController()
      const second = createController()

      const { rerender } = renderHookWithProviders(
        (props: { controller: BudgetUpdateController }) =>
          useBudgetUpdate({
            controller: props.controller,
            subscriptionId: 'sub-1',
          }),
        { initialProps: { controller: first.controller } }
      )

      expect(first.cleanup).not.toHaveBeenCalled()

      rerender({ controller: second.controller })

      expect(first.cleanup).toHaveBeenCalledTimes(1)
    })
  })
})
