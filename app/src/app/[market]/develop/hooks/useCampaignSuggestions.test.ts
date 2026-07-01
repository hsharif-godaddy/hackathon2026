/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import { renderHookWithProviders } from '@/tests/test-utils'

const mockAgentFetch = vi.hoisted(() => vi.fn())
const mockBuildDynamicAgentUrl = vi.hoisted(() => vi.fn())
const mockUseSwitchboard = vi.hoisted(() => vi.fn())

vi.mock('@/lib/agent-fetch', () => ({
  agentFetch: (...args: unknown[]) => mockAgentFetch(...args),
}))

vi.mock('@/config/dynamic-api', () => ({
  buildDynamicAgentUrl: (...args: unknown[]) => mockBuildDynamicAgentUrl(...args),
}))

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (...args: unknown[]) => mockUseSwitchboard(...args),
}))

import { useCampaignSuggestions } from './useCampaignSuggestions'

const APP_ID = 'abc1234567'
const CACHE_KEY = `campaign-suggestions-${APP_ID}`
const DISMISS_KEY = `campaign-suggestion-dismissed-${APP_ID}`

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  }
}

describe('useCampaignSuggestions', () => {
  beforeEach(() => {
    mockUseSwitchboard.mockReturnValue(true)
    mockBuildDynamicAgentUrl.mockImplementation(async (path: string) => `https://agent/${path}`)
    mockAgentFetch.mockReset()
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not fetch when the feature flag is off', async function flagOff() {
    mockUseSwitchboard.mockReturnValue(false)

    renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(mockAgentFetch).not.toHaveBeenCalled()
    })
  })

  it('uses a valid sessionStorage cache without fetching', async function cacheHit() {
    const cached = [
      { text: 'Holiday sale', prompt: 'Create a holiday sale campaign' },
    ]
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cached))

    const { result } = renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(result.current.suggestions).toEqual(cached)
    })
    expect(mockAgentFetch).not.toHaveBeenCalled()
  })

  it('refetches after removing corrupt cache data', async function corruptCache() {
    sessionStorage.setItem(CACHE_KEY, '{"not":"an-array"}')
    mockAgentFetch.mockResolvedValue(mockResponse({
      suggestions: [{ text: 'Newsletter', prompt: 'Start a newsletter campaign' }],
    }))

    const { result } = renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([
        { text: 'Newsletter', prompt: 'Start a newsletter campaign' },
      ])
    })
    expect(sessionStorage.getItem(CACHE_KEY)).toContain('Newsletter')
    expect(mockAgentFetch).toHaveBeenCalled()
  })

  it('does not fetch when dismissed', async function dismissed() {
    localStorage.setItem(DISMISS_KEY, 'true')

    renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(mockAgentFetch).not.toHaveBeenCalled()
    })
  })

  it('filters invalid suggestion items from the API response', async function filterInvalid() {
    mockAgentFetch.mockResolvedValue(mockResponse({
      suggestions: [
        { text: 'Holiday sale', prompt: 'Create a holiday sale campaign' },
        { text: { bad: true }, prompt: 'ignored' },
      ],
    }))

    const { result } = renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([
        { text: 'Holiday sale', prompt: 'Create a holiday sale campaign' },
      ])
    })
  })

  it('filters whitespace-only suggestion items from the API response', async function filterWhitespace() {
    mockAgentFetch.mockResolvedValue(mockResponse({
      suggestions: [
        { text: 'Holiday sale', prompt: 'Create a holiday sale campaign' },
        { text: '   ', prompt: 'Create a newsletter campaign' },
      ],
    }))

    const { result } = renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(result.current.suggestions).toEqual([
        { text: 'Holiday sale', prompt: 'Create a holiday sale campaign' },
      ])
    })
  })

  it('persists dismiss to localStorage', async function dismissPersist() {
    const { result } = renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(result.current.mounted).toBe(true)
    })

    result.current.dismiss()

    await waitFor(() => {
      expect(result.current.dismissed).toBe(true)
    })
    expect(localStorage.getItem(DISMISS_KEY)).toBe('true')
  })

  it('syncs dismiss across hook instances in the same tab', async function dismissSync() {
    const { result: settingsHook } = renderHookWithProviders(() => useCampaignSuggestions(APP_ID))
    const { result: chatHook } = renderHookWithProviders(() => useCampaignSuggestions(APP_ID))

    await waitFor(() => {
      expect(settingsHook.current.mounted).toBe(true)
      expect(chatHook.current.mounted).toBe(true)
    })

    settingsHook.current.dismiss()

    await waitFor(() => {
      expect(chatHook.current.dismissed).toBe(true)
    })
  })
})
