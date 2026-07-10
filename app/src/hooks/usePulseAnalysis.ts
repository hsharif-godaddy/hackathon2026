'use client'

import { useCallback, useState } from 'react'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import type { PulseAnalyzeResponse, PulseInsight } from '@/lib/pulse/types'
import { useSiteStore } from '@/stores/useSiteStore'

type PulseState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'insight'; insight: PulseInsight }
  | { status: 'healthy'; message: string }
  | { status: 'error'; message: string }

export interface UsePulseAnalysisResult {
  state: PulseState
  publishedUrl: string | null
  trigger: () => Promise<void>
  dismiss: () => void
}

export function usePulseAnalysis(): UsePulseAnalysisResult {
  const [state, setState] = useState<PulseState>({ status: 'idle' })
  const appId: string | null = useAppIdFromParams()
  const site = useSiteStore((s) => (appId ? s.getSite(appId) : null))
  const publishedUrl: string | null = site?.published_url ?? null

  const trigger = useCallback(async (): Promise<void> => {
    if (!appId || !publishedUrl) return
    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/pulse/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, publishedUrl }),
      })
      const data = await res.json() as PulseAnalyzeResponse
      if (data.status === 'insight') {
        setState({ status: 'insight', insight: data.insight })
      } else if (data.status === 'healthy') {
        setState({ status: 'healthy', message: data.message })
      } else {
        setState({ status: 'error', message: data.message })
      }
    } catch {
      setState({ status: 'error', message: 'Analysis failed. Please try again.' })
    }
  }, [appId, publishedUrl])

  const dismiss = useCallback((): void => {
    setState({ status: 'idle' })
  }, [])

  return { state, publishedUrl, trigger, dismiss }
}
