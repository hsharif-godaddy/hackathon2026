/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'

import { useBillingModeStore, useResolvedBillingMode } from '@/stores/useBillingModeStore'
import { renderHookWithProviders } from '@/tests/test-utils'
import { type BudgetUpdateController, useBudgetUpdate } from '../useBudgetUpdate'
import { type GrantContextController, useGrantContext } from '../useGrantContext'

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const mockUseCreditGrants = vi.fn()
vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: (options: unknown) => mockUseCreditGrants(options),
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => false,
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

vi.mock('@/lib/credit-adapter/adapt-budget-to-grants', () => ({
  adaptBudgetItemsToGrants: () => [],
}))

function createGrantController(): GrantContextController {
  return {
    emitGrantContext: vi.fn(function () { return true; }),
    onGrantRefreshRequested: vi.fn(function () { return vi.fn(); }),
  }
}

function createBudgetController(): { controller: BudgetUpdateController; cleanup: ReturnType<typeof vi.fn> } {
  const cleanup = vi.fn()
  return {
    controller: {
      onBudgetUpdate: vi.fn(function () { return cleanup; }),
    },
    cleanup,
  }
}

describe('resolved billing mode mismatch tests', function resolvedBillingModeTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
    useBillingModeStore.setState({ modes: {} })
    mockUseCreditGrants.mockReturnValue({
      data: [{ id: 'grant-1', creditsSpent: 0, finalState: null, isAvailable: true }],
      refetch: vi.fn().mockResolvedValue({ data: [] }),
      isLoading: false,
    })
  })

  describe('switchboard true / JWT false (grants mode resolved)', function switchTrueJwtFalse() {
    it('useGrantContext stays active when budgetServiceEnabled=false', function grantsActive() {
      const controller = createGrantController()

      renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
          budgetServiceEnabled: false,
          enabled: true,
        })
      )

      expect(controller.emitGrantContext).toHaveBeenCalled()
    })

    it('useBudgetUpdate is disabled when budgetServiceEnabled=false', function budgetDisabled() {
      const { controller, cleanup } = createBudgetController()

      const { unmount } = renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
          budgetServiceEnabled: false,
          enabled: true,
        })
      )

      unmount()
      expect(cleanup).not.toHaveBeenCalled()
    })
  })

  describe('switchboard false / JWT true (BMS mode resolved)', function switchFalseJwtTrue() {
    it('useGrantContext is disabled when budgetServiceEnabled=true', function grantsDisabled() {
      const controller = createGrantController()

      renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
          budgetServiceEnabled: true,
          enabled: true,
        })
      )

      expect(controller.emitGrantContext).not.toHaveBeenCalled()
    })

    it('useBudgetUpdate is active when budgetServiceEnabled=true', function budgetActive() {
      const { controller, cleanup } = createBudgetController()

      const { unmount } = renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
          budgetServiceEnabled: true,
          enabled: true,
        })
      )

      unmount()
      expect(cleanup).toHaveBeenCalled()
    })
  })

  describe('undefined (pre-resolution)', function preResolution() {
    it('useGrantContext is disabled when budgetServiceEnabled=undefined', function grantsDisabledPre() {
      const controller = createGrantController()

      renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
          budgetServiceEnabled: undefined,
          enabled: true,
        })
      )

      expect(controller.emitGrantContext).not.toHaveBeenCalled()
    })

    it('useBudgetUpdate is disabled when budgetServiceEnabled=undefined', function budgetDisabledPre() {
      const { controller, cleanup } = createBudgetController()

      const { unmount } = renderHookWithProviders(() =>
        useBudgetUpdate({
          controller,
          subscriptionId: 'sub-1',
          budgetServiceEnabled: undefined,
          enabled: true,
        })
      )

      unmount()
      expect(cleanup).not.toHaveBeenCalled()
    })
  })

  describe('late resolution transitions', function lateResolution() {
    it('useGrantContext activates when budgetServiceEnabled transitions undefined → false', function lateGrantActivation() {
      const controller = createGrantController()

      const { rerender } = renderHookWithProviders(
        (props: { budgetServiceEnabled: boolean | undefined }) =>
          useGrantContext({
            controller,
            subscriptionId: 'sub-1',
            isConnected: true,
            budgetServiceEnabled: props.budgetServiceEnabled,
            enabled: true,
          }),
        { initialProps: { budgetServiceEnabled: undefined as boolean | undefined } }
      )

      expect(controller.emitGrantContext).not.toHaveBeenCalled()

      act(() => {
        rerender({ budgetServiceEnabled: false })
      })

      expect(controller.emitGrantContext).toHaveBeenCalled()
    })

    it('useBudgetUpdate subscribes when budgetServiceEnabled transitions undefined → true', function budgetSubscribesAfterResolve() {
      const { controller, cleanup } = createBudgetController()

      const { rerender, unmount } = renderHookWithProviders(
        (props: { budgetServiceEnabled: boolean | undefined }) =>
          useBudgetUpdate({
            controller,
            subscriptionId: 'sub-1',
            budgetServiceEnabled: props.budgetServiceEnabled,
            enabled: true,
          }),
        { initialProps: { budgetServiceEnabled: undefined as boolean | undefined } }
      )

      act(() => {
        rerender({ budgetServiceEnabled: true })
      })

      unmount()
      expect(cleanup).toHaveBeenCalled()
    })
  })

  describe('useResolvedBillingMode store', function storeTests() {
    it('returns undefined for unknown siteId', function unknownSite() {
      const { result } = renderHookWithProviders(() => useResolvedBillingMode('unknown-site'))
      expect(result.current).toBeUndefined()
    })

    it('returns undefined when siteId is undefined', function undefinedSite() {
      const { result } = renderHookWithProviders(() => useResolvedBillingMode(undefined))
      expect(result.current).toBeUndefined()
    })

    it('returns stored value after setMode', function afterSetMode() {
      act(() => {
        useBillingModeStore.getState().setMode('site-1', true)
      })

      const { result } = renderHookWithProviders(() => useResolvedBillingMode('site-1'))
      expect(result.current).toBe(true)
    })

    it('returns undefined after clearMode', function afterClearMode() {
      act(() => {
        useBillingModeStore.getState().setMode('site-1', true)
        useBillingModeStore.getState().clearMode('site-1')
      })

      const { result } = renderHookWithProviders(() => useResolvedBillingMode('site-1'))
      expect(result.current).toBeUndefined()
    })

    it('tracks correct site when siteId changes', function appSwitchRace() {
      act(() => {
        useBillingModeStore.getState().setMode('site-a', false)
        useBillingModeStore.getState().setMode('site-b', true)
      })

      const { result, rerender } = renderHookWithProviders(
        (props: { siteId: string }) => useResolvedBillingMode(props.siteId),
        { initialProps: { siteId: 'site-a' } }
      )

      expect(result.current).toBe(false)

      act(() => {
        rerender({ siteId: 'site-b' })
      })

      expect(result.current).toBe(true)
    })

    it('setMode updates reactive selector', function setModeReactivity() {
      const { result } = renderHookWithProviders(() => useResolvedBillingMode('site-reactive'))

      expect(result.current).toBeUndefined()

      act(() => {
        useBillingModeStore.getState().setMode('site-reactive', true)
      })

      expect(result.current).toBe(true)
    })

    it('clearMode resets reactive selector to undefined', function clearModeReactivity() {
      act(() => {
        useBillingModeStore.getState().setMode('site-clear', false)
      })

      const { result } = renderHookWithProviders(() => useResolvedBillingMode('site-clear'))

      expect(result.current).toBe(false)

      act(() => {
        useBillingModeStore.getState().clearMode('site-clear')
      })

      expect(result.current).toBeUndefined()
    })
  })
})
