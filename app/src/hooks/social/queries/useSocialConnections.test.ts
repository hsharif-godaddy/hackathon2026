/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

import type { EnrichedFacebookConnection, SocialConnection } from '@/types/social'
import { SocialPlatformKey } from '@/types/social'

vi.mock('@/hooks/useSocial', () => ({
  useSocialConnections: vi.fn()
}))

vi.mock('./useConnectionMetadata', () => ({
  useConnectionMetadata: vi.fn()
}))

import { useSocialConnections as useSocialConnectionsQuery } from '@/hooks/useSocial'
import { useConnectionMetadata } from './useConnectionMetadata'
import { useSocialConnections } from './useSocialConnections'

const mockUseSocialConnectionsQuery = vi.mocked(useSocialConnectionsQuery)
const mockUseConnectionMetadata = vi.mocked(useConnectionMetadata)

function facebook(socialId: string, pageId: string, extra: Partial<EnrichedFacebookConnection> = {}): EnrichedFacebookConnection {
  return { socialId, platform: SocialPlatformKey.FACEBOOK, pageId, userId: 'u1', pageName: 'Page', ...extra }
}

describe('useSocialConnections dedup wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Echo each per-platform batch straight back as "enriched" with no loading/error
    // state, so validConnections keeps every row and dedup is the only thing that
    // shrinks the list.
    mockUseConnectionMetadata.mockImplementation((connections: SocialConnection[]) => ({
      enrichedConnections: connections,
      isLoadingAnyMetadata: false,
      connectionsLoadingMetadata: new Set<string>(),
      connectionsWithErrors: new Set<string>()
    }))
  })

  it('collapses connections that resolve to the same provider entity', () => {
    mockUseSocialConnectionsQuery.mockReturnValue({
      data: [facebook('s1', 'p1'), facebook('s2', 'p1'), facebook('s3', 'p2')],
      isLoading: false,
      error: null
    } as unknown as ReturnType<typeof useSocialConnectionsQuery>)

    const { result } = renderHook(() => useSocialConnections())

    expect(result.current.connections.map(c => c.socialId)).toEqual(['s1', 's3'])
  })

  it('keeps the linked sibling over a richer one when linkedConnectionIds is provided', () => {
    mockUseSocialConnectionsQuery.mockReturnValue({
      data: [
        facebook('s1', 'p1', { category: 'Business', pictureUrl: 'https://x' }),
        facebook('s2', 'p1')
      ],
      isLoading: false,
      error: null
    } as unknown as ReturnType<typeof useSocialConnectionsQuery>)

    const { result } = renderHook(() => useSocialConnections({ linkedConnectionIds: new Set(['s2']) }))

    expect(result.current.connections).toHaveLength(1)
    expect(result.current.connections[0].socialId).toBe('s2')
  })
})
