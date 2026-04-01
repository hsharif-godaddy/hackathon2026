/**
 * @vitest-environment jsdom
 */
/* eslint-disable react-hooks/rules-of-hooks */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryObserverResult } from '@tanstack/react-query'
import { act, waitFor } from '@testing-library/react'

import { renderHookWithProviders } from '@/tests/test-utils'
import { type CreditGrant, GrantType } from '@/types/credits'
import { useGrantContext } from './useGrantContext'

const { streamingRef } = vi.hoisted(() => ({
  streamingRef: { current: false },
}))

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
  useCreditGrants: () => mockUseCreditGrants(),
}))

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsActivelyStreaming: () => streamingRef.current,
}))

import { logger } from '@/lib/request-context'

function creditGrant(overrides: Partial<CreditGrant> & Pick<CreditGrant, 'id'>): CreditGrant {
  return {
    subscriptionId: 'sub-1',
    type: GrantType.CreditPack,
    llmBudgetUserId: 'llm-user',
    llmBudgetId: 'llm-budget',
    creditsMax: 100,
    creditsSpent: 0,
    isAvailable: true,
    finalState: null,
    useBefore: '2099-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('useGrantContext', function useGrantContextTests() {
  beforeEach(function setup() {
    vi.clearAllMocks()
    streamingRef.current = false
    vi.useRealTimers()
  })

  it('after agent refresh refetch succeeds, emits grant_context with refetched grants', async function agentRefreshSuccess() {
    const grantFromHook = creditGrant({ id: 'grant-hook' })
    const grantFromRefetch = creditGrant({ id: 'grant-refetch', creditsSpent: 5 })

    const mockRefetch = vi.fn().mockResolvedValue({
      data: [grantFromRefetch],
      isError: false,
      error: null,
      status: 'success',
      isSuccess: true,
    } as QueryObserverResult<CreditGrant[], Error>)

    mockUseCreditGrants.mockReturnValue({
      data: [grantFromHook],
      refetch: mockRefetch,
      isLoading: false,
    })

    let refreshHandler: (() => void) | undefined
    const emitGrantContext = vi.fn(() => true)
    const controller = {
      emitGrantContext,
      onGrantRefreshRequested: vi.fn((cb: () => void) => {
        refreshHandler = cb
        return vi.fn()
      }),
    }

    renderHookWithProviders(() =>
      useGrantContext({
        controller,
        subscriptionId: 'sub-1',
        isConnected: true,
      })
    )

    expect(controller.onGrantRefreshRequested).toHaveBeenCalled()
    expect(refreshHandler).toBeDefined()

    emitGrantContext.mockClear()

    await act(async () => {
      refreshHandler!()
    })

    await waitFor(() => {
      expect(emitGrantContext).toHaveBeenCalledTimes(1)
    })

    const payload = emitGrantContext.mock.calls[0]![0] as {
      grants: CreditGrant[]
    }
    expect(payload.grants).toHaveLength(1)
    expect(payload.grants[0]!.id).toBe('grant-refetch')
    expect(payload.grants[0]!.creditsSpent).toBe(5)
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('after agent refresh refetch errors, does not emit grant_context on refresh path', async function agentRefreshError() {
    const grantFromHook = creditGrant({ id: 'grant-hook' })

    const mockRefetch = vi.fn().mockResolvedValue({
      data: undefined,
      isError: true,
      error: new Error('refetch failed'),
      status: 'error',
      isSuccess: false,
    } as QueryObserverResult<CreditGrant[], Error>)

    mockUseCreditGrants.mockReturnValue({
      data: [grantFromHook],
      refetch: mockRefetch,
      isLoading: false,
    })

    let refreshHandler: (() => void) | undefined
    const emitGrantContext = vi.fn(() => true)
    const controller = {
      emitGrantContext,
      onGrantRefreshRequested: vi.fn((cb: () => void) => {
        refreshHandler = cb
        return vi.fn()
      }),
    }

    renderHookWithProviders(() =>
      useGrantContext({
        controller,
        subscriptionId: 'sub-1',
        isConnected: true,
      })
    )

    emitGrantContext.mockClear()

    await act(async () => {
      refreshHandler!()
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(emitGrantContext).not.toHaveBeenCalled()
  })

  it('does not emit stale grants when refetch succeeds with undefined data', async function refreshSuccessUndefinedData() {
    const grantFromHook = creditGrant({ id: 'hook-only' })

    const mockRefetch = vi.fn().mockResolvedValue({
      data: undefined,
      isError: false,
      error: null,
      status: 'success',
      isSuccess: true,
    } as QueryObserverResult<CreditGrant[], Error>)

    mockUseCreditGrants.mockReturnValue({
      data: [grantFromHook],
      refetch: mockRefetch,
      isLoading: false,
    })

    let refreshHandler: (() => void) | undefined
    const emitGrantContext = vi.fn(() => true)
    const controller = {
      emitGrantContext,
      onGrantRefreshRequested: vi.fn((cb: () => void) => {
        refreshHandler = cb
        return vi.fn()
      }),
    }

    renderHookWithProviders(() =>
      useGrantContext({
        controller,
        subscriptionId: 'sub-1',
        isConnected: true,
      })
    )

    emitGrantContext.mockClear()

    await act(async () => {
      refreshHandler!()
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(emitGrantContext).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'websocket.grant_context.refresh_no_data',
      expect.objectContaining({ source: 'agent_refresh' }),
    )
  })

  it('after agent refresh, emits even when refetch data matches current grant hash', async function agentRefreshForceSameHash() {
    const same = creditGrant({ id: 'same-grant', creditsSpent: 10, creditsMax: 100 })

    const mockRefetch = vi.fn().mockResolvedValue({
      data: [same],
      isError: false,
      error: null,
      status: 'success',
      isSuccess: true,
    } as QueryObserverResult<CreditGrant[], Error>)

    mockUseCreditGrants.mockReturnValue({
      data: [same],
      refetch: mockRefetch,
      isLoading: false,
    })

    let refreshHandler: (() => void) | undefined
    const emitGrantContext = vi.fn(() => true)
    const controller = {
      emitGrantContext,
      onGrantRefreshRequested: vi.fn((cb: () => void) => {
        refreshHandler = cb
        return vi.fn()
      }),
    }

    renderHookWithProviders(() =>
      useGrantContext({
        controller,
        subscriptionId: 'sub-1',
        isConnected: true,
      })
    )

    emitGrantContext.mockClear()

    await act(async () => {
      refreshHandler!()
    })

    await waitFor(() => {
      expect(emitGrantContext).toHaveBeenCalledTimes(1)
    })

    const payload = emitGrantContext.mock.calls[0]![0] as { grants: CreditGrant[] }
    expect(payload.grants).toHaveLength(1)
    expect(payload.grants[0]!.id).toBe('same-grant')
  })

  describe('visibility change refetch', function visibilityRefetch() {
    function fireTabBecameVisible() {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    it('emits grant_context with refetched grants when refetch succeeds', async function visibilitySuccess() {
      const grantFromHook = creditGrant({ id: 'vis-hook' })
      const grantFromRefetch = creditGrant({ id: 'vis-refetch', creditsSpent: 3 })

      const mockRefetch = vi.fn().mockResolvedValue({
        data: [grantFromRefetch],
        isError: false,
        error: null,
        status: 'success',
        isSuccess: true,
      } as QueryObserverResult<CreditGrant[], Error>)

      mockUseCreditGrants.mockReturnValue({
        data: [grantFromHook],
        refetch: mockRefetch,
        isLoading: false,
      })

      const emitGrantContext = vi.fn(() => true)
      const controller = {
        emitGrantContext,
        onGrantRefreshRequested: vi.fn(() => vi.fn()),
      }

      renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
        })
      )

      emitGrantContext.mockClear()

      await act(async () => {
        fireTabBecameVisible()
      })

      await waitFor(() => {
        expect(emitGrantContext).toHaveBeenCalledTimes(1)
      })

      const payload = emitGrantContext.mock.calls[0]![0] as { grants: CreditGrant[] }
      expect(payload.grants[0]!.id).toBe('vis-refetch')
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })

    it('does not emit grant_context on visibility path when refetch returns error', async function visibilityError() {
      const grantFromHook = creditGrant({ id: 'vis-hook' })

      const mockRefetch = vi.fn().mockResolvedValue({
        data: undefined,
        isError: true,
        error: new Error('visibility refetch failed'),
        status: 'error',
        isSuccess: false,
      } as QueryObserverResult<CreditGrant[], Error>)

      mockUseCreditGrants.mockReturnValue({
        data: [grantFromHook],
        refetch: mockRefetch,
        isLoading: false,
      })

      const emitGrantContext = vi.fn(() => true)
      const controller = {
        emitGrantContext,
        onGrantRefreshRequested: vi.fn(() => vi.fn()),
      }

      renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
        })
      )

      emitGrantContext.mockClear()

      await act(async () => {
        fireTabBecameVisible()
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(emitGrantContext).not.toHaveBeenCalled()
    })

    it('emits even when refetch data matches current grant hash', async function visibilityForceSameHash() {
      const same = creditGrant({ id: 'vis-same', creditsSpent: 7, creditsMax: 100 })

      const mockRefetch = vi.fn().mockResolvedValue({
        data: [same],
        isError: false,
        error: null,
        status: 'success',
        isSuccess: true,
      } as QueryObserverResult<CreditGrant[], Error>)

      mockUseCreditGrants.mockReturnValue({
        data: [same],
        refetch: mockRefetch,
        isLoading: false,
      })

      const emitGrantContext = vi.fn(() => true)
      const controller = {
        emitGrantContext,
        onGrantRefreshRequested: vi.fn(() => vi.fn()),
      }

      renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
        })
      )

      emitGrantContext.mockClear()

      await act(async () => {
        fireTabBecameVisible()
      })

      await waitFor(() => {
        expect(emitGrantContext).toHaveBeenCalledTimes(1)
      })

      const payload = emitGrantContext.mock.calls[0]![0] as { grants: CreditGrant[] }
      expect(payload.grants[0]!.id).toBe('vis-same')
    })
  })

  describe('stream complete refetch', function streamCompleteRefetch() {
    it('after stream ends, emits grant_context with refetched grants after delay', async function streamSuccess() {
      const grantFromHook = creditGrant({ id: 'stream-hook' })
      const grantFromRefetch = creditGrant({ id: 'stream-refetch', creditsSpent: 2 })

      const mockRefetch = vi.fn().mockResolvedValue({
        data: [grantFromRefetch],
        isError: false,
        error: null,
        status: 'success',
        isSuccess: true,
      } as QueryObserverResult<CreditGrant[], Error>)

      mockUseCreditGrants.mockReturnValue({
        data: [grantFromHook],
        refetch: mockRefetch,
        isLoading: false,
      })

      const emitGrantContext = vi.fn(() => true)
      const controller = {
        emitGrantContext,
        onGrantRefreshRequested: vi.fn(() => vi.fn()),
      }

      streamingRef.current = true

      const { rerender } = renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
        })
      )

      emitGrantContext.mockClear()

      streamingRef.current = false
      vi.useFakeTimers()

      await act(async () => {
        rerender()
      })

      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(emitGrantContext).toHaveBeenCalledTimes(1)

      const payload = emitGrantContext.mock.calls[0]![0] as { grants: CreditGrant[] }
      expect(payload.grants[0]!.id).toBe('stream-refetch')
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })

    it('does not emit grant_context on stream-complete path when refetch returns error', async function streamError() {
      const grantFromHook = creditGrant({ id: 'stream-hook' })

      const mockRefetch = vi.fn().mockResolvedValue({
        data: undefined,
        isError: true,
        error: new Error('stream refetch failed'),
        status: 'error',
        isSuccess: false,
      } as QueryObserverResult<CreditGrant[], Error>)

      mockUseCreditGrants.mockReturnValue({
        data: [grantFromHook],
        refetch: mockRefetch,
        isLoading: false,
      })

      const emitGrantContext = vi.fn(() => true)
      const controller = {
        emitGrantContext,
        onGrantRefreshRequested: vi.fn(() => vi.fn()),
      }

      streamingRef.current = true

      const { rerender } = renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
        })
      )

      emitGrantContext.mockClear()

      streamingRef.current = false
      vi.useFakeTimers()

      await act(async () => {
        rerender()
      })

      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(emitGrantContext).not.toHaveBeenCalled()
    })

    it('emits even when refetch data matches current grant hash', async function streamForceSameHash() {
      const same = creditGrant({ id: 'stream-same', creditsSpent: 8, creditsMax: 100 })

      const mockRefetch = vi.fn().mockResolvedValue({
        data: [same],
        isError: false,
        error: null,
        status: 'success',
        isSuccess: true,
      } as QueryObserverResult<CreditGrant[], Error>)

      mockUseCreditGrants.mockReturnValue({
        data: [same],
        refetch: mockRefetch,
        isLoading: false,
      })

      const emitGrantContext = vi.fn(() => true)
      const controller = {
        emitGrantContext,
        onGrantRefreshRequested: vi.fn(() => vi.fn()),
      }

      streamingRef.current = true

      const { rerender } = renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
        })
      )

      emitGrantContext.mockClear()

      streamingRef.current = false
      vi.useFakeTimers()

      await act(async () => {
        rerender()
      })

      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(emitGrantContext).toHaveBeenCalledTimes(1)

      const payload = emitGrantContext.mock.calls[0]![0] as { grants: CreditGrant[] }
      expect(payload.grants[0]!.id).toBe('stream-same')
    })

    it('does not refetch or emit if hook unmounts before stream-complete delay', async function streamUnmountedBeforeDelay() {
      const grantFromHook = creditGrant({ id: 'stream-unmount' })

      const mockRefetch = vi.fn().mockResolvedValue({
        data: [creditGrant({ id: 'stream-never' })],
        isError: false,
        error: null,
        status: 'success',
        isSuccess: true,
      } as QueryObserverResult<CreditGrant[], Error>)

      mockUseCreditGrants.mockReturnValue({
        data: [grantFromHook],
        refetch: mockRefetch,
        isLoading: false,
      })

      const emitGrantContext = vi.fn(() => true)
      const controller = {
        emitGrantContext,
        onGrantRefreshRequested: vi.fn(() => vi.fn()),
      }

      streamingRef.current = true

      const { rerender, unmount } = renderHookWithProviders(() =>
        useGrantContext({
          controller,
          subscriptionId: 'sub-1',
          isConnected: true,
        })
      )

      emitGrantContext.mockClear()

      streamingRef.current = false
      vi.useFakeTimers()

      await act(async () => {
        rerender()
      })

      unmount()

      await act(async () => {
        vi.advanceTimersByTime(2_000)
      })

      await act(async () => {
        await Promise.resolve()
      })

      expect(mockRefetch).not.toHaveBeenCalled()
      expect(emitGrantContext).not.toHaveBeenCalled()
    })
  })
})
