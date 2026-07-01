'use client'

import { useCallback, useEffect, useState } from 'react'

import { buildDynamicAgentUrl } from '@/config/dynamic-api'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { agentFetch } from '@/lib/agent-fetch'
import { logger } from '@/lib/request-context'

export interface CampaignSuggestion {
  text: string
  prompt: string
}

function isCampaignSuggestion(value: unknown): value is CampaignSuggestion {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as CampaignSuggestion).text === 'string'
    && (value as CampaignSuggestion).text.trim().length > 0
    && typeof (value as CampaignSuggestion).prompt === 'string'
    && (value as CampaignSuggestion).prompt.trim().length > 0
  )
}

function parseCachedSuggestions(raw: string): CampaignSuggestion[] | null {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) return null
  return parsed.filter(isCampaignSuggestion)
}

const DISMISS_KEY_PREFIX = 'campaign-suggestion-dismissed-'
const CACHE_KEY_PREFIX = 'campaign-suggestions-'
const DISMISS_EVENT = 'campaign-suggestion-dismissed'

function readDismissed(appId: string | null): boolean {
  if (!appId) return false
  return localStorage.getItem(`${DISMISS_KEY_PREFIX}${appId}`) === 'true'
}

export function useCampaignSuggestions(appId: string | null): {
  suggestions: CampaignSuggestion[]
  loading: boolean
  dismissed: boolean
  dismiss: () => void
  mounted: boolean
} {
  const flagEnabled = useSwitchboard('appbuilder-marketing-campaigns') === true
  const [suggestions, setSuggestions] = useState<CampaignSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [, setDismissRevision] = useState(0)
  const dismissed = mounted && readDismissed(appId)

  useEffect(() => {
    if (!appId) return
    setMounted(true)
  }, [appId])

  useEffect(() => {
    if (!appId) return

    function onDismissed(event: Event) {
      const detail = (event as CustomEvent<{ appId: string }>).detail
      if (detail?.appId === appId) {
        setDismissRevision((value) => value + 1)
      }
    }

    window.addEventListener(DISMISS_EVENT, onDismissed)
    return () => window.removeEventListener(DISMISS_EVENT, onDismissed)
  }, [appId])

  useEffect(() => {
    if (!appId || !flagEnabled || !mounted || dismissed) return

    const cacheKey = `${CACHE_KEY_PREFIX}${appId}`
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      try {
        const parsed = parseCachedSuggestions(cached)
        if (parsed) {
          setSuggestions(parsed)
          return
        }
        logger.warn('campaigns.suggestions.cache.invalid', { appId })
        sessionStorage.removeItem(cacheKey)
      } catch (error) {
        logger.warn('campaigns.suggestions.cache.parse_failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
        sessionStorage.removeItem(cacheKey)
      }
    }

    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const url = await buildDynamicAgentUrl(`campaigns/${appId}/suggestions`, appId)
        const response = await agentFetch(url, { siteId: appId })
        if (cancelled) return
        if (!response.ok) {
          logger.warn('campaigns.suggestions.fetch.not_ok', { appId, status: response.status })
          return
        }
        const data = await response.json() as { suggestions?: unknown[] }
        if (!Array.isArray(data.suggestions)) {
          logger.warn('campaigns.suggestions.fetch.invalid_shape', { appId })
          return
        }
        const result = data.suggestions.filter(isCampaignSuggestion)
        if (data.suggestions.length > 0 && result.length === 0) {
          logger.warn('campaigns.suggestions.fetch.all_filtered', {
            appId,
            rawCount: data.suggestions.length,
          })
        }
        sessionStorage.setItem(cacheKey, JSON.stringify(result))
        if (!cancelled) setSuggestions(result)
      } catch (error) {
        logger.warn('campaigns.suggestions.fetch.failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [appId, flagEnabled, mounted, dismissed])

  const dismiss = useCallback(() => {
    if (!appId) return
    localStorage.setItem(`${DISMISS_KEY_PREFIX}${appId}`, 'true')
    window.dispatchEvent(new CustomEvent(DISMISS_EVENT, { detail: { appId } }))
    setDismissRevision((value) => value + 1)
  }, [appId])

  return { suggestions, loading, dismissed, dismiss, mounted }
}
