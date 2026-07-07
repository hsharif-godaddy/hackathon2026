'use client'

import { useCallback, useState } from 'react'

import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'

// ─── airo-go / hosting run response shapes ─────────────────────────────────────

export type AutomationRunStatus = 'success' | 'partial' | 'failed' | 'cancelled' | 'running' | 'pending'

export interface AutomationRun {
  id: string
  runNumber?: number
  status: AutomationRunStatus
  startedAt: string
  finishedAt?: string
  /** Duration in seconds */
  durationSeconds?: number
  triggeredBy: 'scheduled' | 'manual'
  /** Hosting/agent error message when the run did not succeed */
  errorMessage?: string
  /** Workspace-relative path to the run summary .md file written by the agent */
  summaryRef?: string
}

export interface AiroGoRun {
  id: string
  runNumber?: number
  status: string
  startedAt?: string
  finishedAt?: string
  createdAt?: string
  updatedAt?: string
  scheduledSlot?: string
  durationSeconds?: number
  triggerType?: string
  triggeredBy?: string
  lastError?: string | null
  /** errorMessage field used by the local control plane */
  errorMessage?: string | null
  /** Workspace-relative path to the run summary .md file; present if airo-go persisted the callback payload */
  summaryRef?: string
}

interface AiroGoRunsResponse {
  runs: AiroGoRun[]
  total?: number
}

export function mapHostingRunStatus(raw: string): AutomationRunStatus {
  switch (raw) {
    case 'success':
    case 'succeeded':
      return 'success'
    case 'partial':
      return 'partial'
    case 'running':
    case 'in_progress':
    case 'dispatched':
      return 'running'
    case 'pending':
    case 'queued':
    case 'failed_retryable':
      return 'pending'
    case 'cancelled':
      return 'cancelled'
    default:
      if (raw.startsWith('failed')) return 'failed'
      return 'pending'
  }
}

export function mapHostingRun(r: AiroGoRun): AutomationRun {
  const startedAt = r.startedAt ?? r.createdAt ?? r.scheduledSlot ?? ''
  // Only use finishedAt for terminal states — updatedAt is always present and
  // would give a near-zero duration for running/pending runs.
  const isTerminal = r.status === 'succeeded' || r.status === 'success' || r.status === 'failed'
    || r.status === 'cancelled' || r.status === 'partial'
    || (typeof r.status === 'string' && r.status.startsWith('failed'))
  const finishedAt = r.finishedAt ?? (isTerminal ? r.updatedAt : undefined)
  let durationSeconds = r.durationSeconds
  if (durationSeconds == null && startedAt && finishedAt) {
    const start = new Date(startedAt).getTime()
    const end = new Date(finishedAt).getTime()
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durationSeconds = Math.round((end - start) / 1000)
    }
  }
  const trigger = r.triggeredBy ?? r.triggerType ?? 'cron'
  return {
    id: r.id,
    runNumber: r.runNumber,
    status: mapHostingRunStatus(r.status),
    startedAt,
    finishedAt,
    durationSeconds,
    triggeredBy: trigger === 'manual' ? 'manual' : 'scheduled',
    errorMessage: r.lastError ?? r.errorMessage ?? undefined,
    summaryRef: r.summaryRef ?? undefined,
  }
}

export interface UseAutomationRunsResult {
  runs: AutomationRun[]
  total: number
  loading: boolean
  fetched: boolean
  fetch: (opts?: { limit?: number; offset?: number }) => Promise<void>
}

export const PREVIEW_RUNS_LIMIT = 3
export const PAGE_SIZE = 10

export function useAutomationRuns(appId: string | null, automationId: string | null): UseAutomationRunsResult {
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)

  const fetch = useCallback(async function fetchRuns({ limit = PREVIEW_RUNS_LIMIT, offset = 0 } = {}) {
    if (!appId || !automationId) return
    setLoading(true)
    try {
      const res = await appFetch(
        `/api/automations/${appId}/${automationId}/runs?limit=${limit}&offset=${offset}`,
        undefined,
        { handle401: true },
      )
      if (!res.ok) {
        logger.warn('automations.runs.list_failed', { appId, automationId, status: res.status })
        return
      }
      const data: AiroGoRunsResponse = await res.json()
      setRuns((data.runs ?? []).map(mapHostingRun))
      setTotal(data.total ?? data.runs?.length ?? 0)
    } catch (err) {
      logger.error('automations.runs.list_error', { appId, automationId, error: String(err) })
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [appId, automationId])

  return { runs, total, loading, fetched, fetch }
}
