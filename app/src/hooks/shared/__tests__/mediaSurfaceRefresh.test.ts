/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetQueryClient, mockInvalidateQueries, mockLogger } = vi.hoisted(() => ({
  mockGetQueryClient: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/components/providers/QueryClientProvider', () => ({
  getQueryClient: mockGetQueryClient,
}))

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}))

import { refreshMediaSurfaces } from '../mediaSurfaceRefresh'

const APP_ID = 'app-123'
const KEYS = ['appPages', 'mediaSlotUsage', 'mediaManifest']

function invalidatedKeysFor(appId: string): string[] {
  return mockInvalidateQueries.mock.calls
    .map(([arg]) => arg.queryKey)
    .filter((key) => key[1] === appId)
    .map((key) => key[0])
}

describe('refreshMediaSurfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockInvalidateQueries.mockResolvedValue(undefined)
    mockGetQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('invalidates the three media surfaces immediately with refetchType active', () => {
    refreshMediaSurfaces(APP_ID)

    expect(invalidatedKeysFor(APP_ID).sort()).toEqual([...KEYS].sort())
    for (const call of mockInvalidateQueries.mock.calls) {
      expect(call[0].refetchType).toBe('active')
    }
  })

  it('re-invalidates on a widening retry schedule to catch late async manifest/usage writes', () => {
    refreshMediaSurfaces(APP_ID)
    expect(invalidatedKeysFor(APP_ID)).toHaveLength(3)

    vi.advanceTimersByTime(2_000)
    expect(invalidatedKeysFor(APP_ID)).toHaveLength(6)

    vi.advanceTimersByTime(3_000)
    expect(invalidatedKeysFor(APP_ID)).toHaveLength(9)

    vi.advanceTimersByTime(4_000)
    expect(invalidatedKeysFor(APP_ID)).toHaveLength(12)

    vi.advanceTimersByTime(6_000)
    expect(invalidatedKeysFor(APP_ID)).toHaveLength(15)

    vi.advanceTimersByTime(9_000)
    expect(invalidatedKeysFor(APP_ID)).toHaveLength(18)
  })

  it('does nothing without an appId', () => {
    refreshMediaSurfaces('')
    vi.advanceTimersByTime(30_000)
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
  })

  it('logs and bails when the query client is not yet mounted', () => {
    mockGetQueryClient.mockReturnValue(null)

    refreshMediaSurfaces(APP_ID)

    expect(mockInvalidateQueries).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'mediaSurfaceRefresh.no-query-client',
      expect.objectContaining({ appId: APP_ID }),
    )
  })
})
