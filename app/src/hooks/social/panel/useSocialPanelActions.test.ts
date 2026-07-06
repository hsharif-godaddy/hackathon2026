/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'

import { useSocialPanelActions } from '@/hooks/social/panel/useSocialPanelActions'
import { renderHookWithProviders } from '@/tests/test-utils'

const mockInvalidateQueries = vi.fn()
const mockUnlinkMutateAsync = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: mockInvalidateQueries,
    }),
  }
})

vi.mock('@/hooks/social/mutations/useUnlinkConnection', () => ({
  useUnlinkConnection: () => ({
    mutateAsync: mockUnlinkMutateAsync,
  }),
}))

describe('useSocialPanelActions', function socialPanelActionsTests() {
  const defaultParams = {
    siteId: 'site-123',
    siteLinks: [] as Array<{ id: string; socialId: string }>,
  }

  beforeEach(function resetMocks() {
    vi.clearAllMocks()
  })

  it('opens social-flows widget for facebook connect', function facebookWidget() {
    const { result } = renderHookWithProviders(() => useSocialPanelActions(defaultParams))

    act(function connectFacebook() {
      result.current.handleConnectPlatform('facebook')
    })

    expect(result.current.isSocialFlowsWidgetOpen).toBe(true)
    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.selectedPlatform).toBe('facebook')
    expect(result.current.oauthState).toMatch(/^facebook-/)
  })

  it('opens social-flows widget for instagram and google connect', function socialFlowsPlatforms() {
    const { result } = renderHookWithProviders(() => useSocialPanelActions(defaultParams))

    act(function connectInstagram() {
      result.current.handleConnectPlatform('instagram')
    })

    expect(result.current.isSocialFlowsWidgetOpen).toBe(true)
    expect(result.current.isModalOpen).toBe(false)

    act(function reset() {
      result.current.handleFlowsClose()
    })

    act(function connectGoogle() {
      result.current.handleConnectPlatform('google')
    })

    expect(result.current.isSocialFlowsWidgetOpen).toBe(true)
    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.selectedPlatform).toBe('google')
  })

  it('opens AAB connect modal for non-social-flows platforms', function legacyModal() {
    const { result } = renderHookWithProviders(() => useSocialPanelActions(defaultParams))

    act(function connectTiktok() {
      result.current.handleConnectPlatform('tiktok')
    })

    expect(result.current.isModalOpen).toBe(true)
    expect(result.current.isSocialFlowsWidgetOpen).toBe(false)
    expect(result.current.selectedPlatform).toBe('tiktok')
  })

  it('opens modal for link-account flow regardless of platform', function linkAccountModal() {
    const { result } = renderHookWithProviders(() => useSocialPanelActions(defaultParams))

    act(function selectFacebookConnection() {
      result.current.handleSelectConnection('facebook')
    })

    expect(result.current.isModalOpen).toBe(true)
    expect(result.current.isSocialFlowsWidgetOpen).toBe(false)
    expect(result.current.selectedPlatform).toBe('facebook')
  })

  it('hands off from modal to social-flows widget', function modalHandoff() {
    const { result } = renderHookWithProviders(() => useSocialPanelActions(defaultParams))

    act(function selectConnection() {
      result.current.handleSelectConnection('instagram')
    })

    expect(result.current.isModalOpen).toBe(true)
    expect(result.current.isSocialFlowsWidgetOpen).toBe(false)

    act(function handoff() {
      result.current.openSocialFlowsFromModal()
    })

    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.isSocialFlowsWidgetOpen).toBe(true)
    expect(result.current.selectedPlatform).toBe('instagram')
  })

  it('resets connect state on modal and flows close', function resetConnectState() {
    const { result } = renderHookWithProviders(() => useSocialPanelActions(defaultParams))

    act(function connectFacebook() {
      result.current.handleConnectPlatform('facebook')
    })

    act(function closeFlows() {
      result.current.handleFlowsClose()
    })

    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.isSocialFlowsWidgetOpen).toBe(false)
    expect(result.current.selectedPlatform).toBe('')
    expect(result.current.oauthState).toBe('')

    act(function connectTiktok() {
      result.current.handleConnectPlatform('tiktok')
    })

    act(function closeModal() {
      result.current.handleModalClose()
    })

    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.isSocialFlowsWidgetOpen).toBe(false)
    expect(result.current.selectedPlatform).toBe('')
  })

  it('resets connect state and invalidates associations on modal success', function modalSuccess() {
    const { result } = renderHookWithProviders(() => useSocialPanelActions(defaultParams))

    act(function connectTiktok() {
      result.current.handleConnectPlatform('tiktok')
    })

    act(function succeed() {
      result.current.handleModalSuccess()
    })

    expect(result.current.isModalOpen).toBe(false)
    expect(result.current.isSocialFlowsWidgetOpen).toBe(false)
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['site-associations', 'site-123'],
    })
  })
})
