/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BudgetUpdatePayload, BudgetUpdateSuccess } from '@airo/shared/budget'
import { QueryClient } from '@tanstack/react-query'
import { act } from '@testing-library/react'

import { renderHookWithProviders } from '@/tests/test-utils'
import { BUDGET_STATUS_QUERY_KEY, type CreditStatusResponse } from '@/types/budget'
import { type BudgetUpdateController, useBudgetUpdate } from './useBudgetUpdate'

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

function makeCachedStatus(overrides?: Partial<CreditStatusResponse>): CreditStatusResponse {
  return {
    budgetId: 'budget-1',
    productKey: 'airo',
    creditsTotal: '100',
    creditsUsed: '20',
    creditsPending: '0',
    creditsTotalNumeric: 100,
    creditsUsedNumeric: 20,
    creditsPendingNumeric: 0,
    items: [],
    ...overrides,
  }
}

function makeSuccessPayload(customerRemaining: number): BudgetUpdateSuccess {
  return {
    refreshRequired: false,
    customerRemaining,
    budgets: [],
    assignment: { customer: [] },
  }
}

function makeController(): BudgetUpdateController & {
  _budgetHandler: ((data: BudgetUpdatePayload) => void) | null
  _reconnectHandler: (() => void) | null
  _budgetCleanup: ReturnType<typeof vi.fn>
} {
  const ctrl = {
    _budgetHandler: null as ((data: BudgetUpdatePayload) => void) | null,
    _reconnectHandler: null as (() => void) | null,
    _budgetCleanup: vi.fn(),
    onBudgetUpdate: vi.fn((cb: (data: BudgetUpdatePayload) => void) => {
      ctrl._budgetHandler = cb
      return ctrl._budgetCleanup
    }),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'reconnect:success') ctrl._reconnectHandler = cb
    }),
    off: vi.fn((event: string, cb: () => void) => {
      if (event === 'reconnect:success' && ctrl._reconnectHandler === cb) {
        ctrl._reconnectHandler = null
      }
    }),
  }
  return ctrl
}

describe('useBudgetUpdate', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
  })

  it('optimistically updates cache and invalidates on refreshRequired: false', async () => {
    const cached = makeCachedStatus({ creditsTotalNumeric: 100, creditsUsedNumeric: 20 })
    queryClient.setQueryData([BUDGET_STATUS_QUERY_KEY, 'sub-1'], cached)

    const ctrl = makeController()

    renderHookWithProviders(
      () => useBudgetUpdate({ controller: ctrl, subscriptionId: 'sub-1', enabled: true }),
      { queryClient },
    )

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      ctrl._budgetHandler!(makeSuccessPayload(60))
    })

    const updated = queryClient.getQueryData<CreditStatusResponse>([BUDGET_STATUS_QUERY_KEY, 'sub-1'])
    expect(updated?.creditsUsedNumeric).toBe(40) // 100 - 60
    expect(updated?.creditsUsed).toBe('40')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [BUDGET_STATUS_QUERY_KEY, 'sub-1'],
    })
  })

  it('invalidates without optimistic update on refreshRequired: true', async () => {
    const cached = makeCachedStatus()
    queryClient.setQueryData([BUDGET_STATUS_QUERY_KEY, 'sub-1'], cached)

    const ctrl = makeController()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHookWithProviders(
      () => useBudgetUpdate({ controller: ctrl, subscriptionId: 'sub-1', enabled: true }),
      { queryClient },
    )

    await act(async () => {
      ctrl._budgetHandler!({ refreshRequired: true })
    })

    // Cache should not have been modified via setQueryData
    const data = queryClient.getQueryData<CreditStatusResponse>([BUDGET_STATUS_QUERY_KEY, 'sub-1'])
    expect(data?.creditsUsedNumeric).toBe(20) // unchanged
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [BUDGET_STATUS_QUERY_KEY, 'sub-1'],
    })
  })

  it('invalidates on socket reconnect', async () => {
    const ctrl = makeController()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHookWithProviders(
      () => useBudgetUpdate({ controller: ctrl, subscriptionId: 'sub-1', enabled: true }),
      { queryClient },
    )

    await act(async () => {
      ctrl._reconnectHandler!()
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [BUDGET_STATUS_QUERY_KEY, 'sub-1'],
    })
  })

  it('does not optimistically update when no cached data exists', async () => {
    const ctrl = makeController()
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    renderHookWithProviders(
      () => useBudgetUpdate({ controller: ctrl, subscriptionId: 'sub-1', enabled: true }),
      { queryClient },
    )

    await act(async () => {
      ctrl._budgetHandler!(makeSuccessPayload(60))
    })

    expect(setQueryDataSpy).not.toHaveBeenCalled()
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: [BUDGET_STATUS_QUERY_KEY, 'sub-1'],
    })
  })

  it('sets creditsUsedNumeric to creditsTotalNumeric when customerRemaining is 0', async () => {
    const cached = makeCachedStatus({ creditsTotalNumeric: 100, creditsUsedNumeric: 20 })
    queryClient.setQueryData([BUDGET_STATUS_QUERY_KEY, 'sub-1'], cached)

    const ctrl = makeController()

    renderHookWithProviders(
      () => useBudgetUpdate({ controller: ctrl, subscriptionId: 'sub-1', enabled: true }),
      { queryClient },
    )

    await act(async () => {
      ctrl._budgetHandler!(makeSuccessPayload(0))
    })

    const updated = queryClient.getQueryData<CreditStatusResponse>([BUDGET_STATUS_QUERY_KEY, 'sub-1'])
    expect(updated?.creditsUsedNumeric).toBe(100)
    expect(updated?.creditsUsed).toBe('100')
  })

  it('cleans up listeners on unmount', () => {
    const ctrl = makeController()

    const { unmount } = renderHookWithProviders(
      () => useBudgetUpdate({ controller: ctrl, subscriptionId: 'sub-1', enabled: true }),
      { queryClient },
    )

    expect(ctrl.onBudgetUpdate).toHaveBeenCalled()
    expect(ctrl.on).toHaveBeenCalledWith('reconnect:success', expect.any(Function))

    unmount()

    expect(ctrl._budgetCleanup).toHaveBeenCalled()
    expect(ctrl.off).toHaveBeenCalledWith('reconnect:success', expect.any(Function))
  })

  it('does not register listeners when enabled is false', () => {
    const ctrl = makeController()

    renderHookWithProviders(
      () => useBudgetUpdate({ controller: ctrl, subscriptionId: 'sub-1', enabled: false }),
      { queryClient },
    )

    expect(ctrl.onBudgetUpdate).not.toHaveBeenCalled()
    expect(ctrl.on).not.toHaveBeenCalled()
  })

  it('does not register listeners when controller is null', () => {
    renderHookWithProviders(
      () => useBudgetUpdate({ controller: null, subscriptionId: 'sub-1', enabled: true }),
      { queryClient },
    )

    // No crash, no listeners registered
  })
})
