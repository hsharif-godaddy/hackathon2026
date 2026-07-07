'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ScheduleConfig } from '@/app/[market]/develop/components/automations/AutomationScheduleModal'
import { scheduleToCronExpr } from '@/app/[market]/develop/components/automations/AutomationScheduleModal'
import type { AutomationSchedule } from '@/app/[market]/develop/components/automations/types'
import { appFetch } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import * as automationFiles from '@/services/automation-files'

// ─── airo-go response shapes ─────────────────────────────────────────────────

interface AiroGoAutomation {
  id: string
  name: string
  defnRef: string
  triggerType: 'cron' | 'manual'
  cronExpr: string
  enabled: boolean
  nextRunAt?: string
}

interface AiroGoListResponse {
  automations: AiroGoAutomation[]
}

// ─── Hook result ─────────────────────────────────────────────────────────────

export interface AutomationJobData {
  name: string
  description: string
  prompt: string
}

export interface UseAutomationsResult {
  /** Map from local automation id (defnRef) → its hosted record (schedule or manual registration) */
  scheduleByDefnRef: Record<string, AutomationSchedule>
  loading: boolean
  /** Set when the hosted schedule list could not be loaded — block saves until cleared */
  loadError: string | null
  /**
   * Register a new automation with airo-go as triggerType: manual (no cron).
   * Call this when the user creates or adds an automation so it gets a hosted ID
   * immediately, enabling run history and hosted dispatch for all automations.
   * Idempotent — if already registered, does nothing.
   */
  registerAutomation: (defnRef: string, jobData: AutomationJobData) => Promise<void>
  /**
   * Create or update a schedule for a local automation (identified by defnRef).
   * jobData is required when the job file may not exist yet (e.g. scheduling a
   * recommended automation without having clicked Add first) — writes
   * `.airo/jobs/{defnRef}/{defnRef}.md` idempotently before registering the cron.
   */
  saveSchedule: (defnRef: string, jobData: AutomationJobData, config: ScheduleConfig) => Promise<void>
  /** Remove the schedule for a local automation */
  removeSchedule: (defnRef: string) => Promise<void>
  /** Reload from airo-go */
  reload: () => Promise<void>
  /** Trigger an immediate manual run for a hosted automation. Returns the runId. */
  triggerRun: (defnRef: string) => Promise<string>
}

function automationApiBase(appId: string) {
  return `/api/automations/${appId}`
}

function mapAiroGoToSchedule(a: AiroGoAutomation): AutomationSchedule {
  return {
    id: a.id,
    triggerType: a.triggerType ?? 'cron',
    ...(a.cronExpr ? { cronExpr: a.cronExpr } : {}),
    enabled: a.enabled,
    nextRunAt: a.nextRunAt,
  }
}

export function useAutomations(appId: string | null): UseAutomationsResult {
  const [scheduleByDefnRef, setScheduleByDefnRef] = useState<Record<string, AutomationSchedule>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Keep a ref of defnRef → airo-go automation id for update/delete
  const hostedIdRef = useRef<Record<string, string>>({})

  const reload = useCallback(async function fetchSchedules() {
    if (!appId) return
    setLoading(true)
    try {
      const res = await appFetch(automationApiBase(appId), undefined, { handle401: true })
      if (!res.ok) {
        logger.warn('automations.schedules.list_failed', { appId, status: res.status })
        setLoadError(`list_failed_${res.status}`)
        return
      }
      const data: AiroGoListResponse = await res.json()
      const automations = data.automations ?? []

      const next: Record<string, AutomationSchedule> = {}
      const ids: Record<string, string> = {}
      for (const a of automations) {
        next[a.defnRef] = mapAiroGoToSchedule(a)
        ids[a.defnRef] = a.id
      }
      setScheduleByDefnRef(next)
      hostedIdRef.current = ids
      setLoadError(null)
    } catch (err) {
      logger.error('automations.schedules.list_error', { appId, error: String(err) })
      setLoadError('network_error')
    } finally {
      setLoading(false)
    }
  }, [appId])

  useEffect(() => {
    void reload()
  }, [reload])

  const registerAutomation = useCallback(async function register(
    defnRef: string,
    jobData: AutomationJobData,
  ) {
    if (!appId) return
    // Already registered — nothing to do.
    if (hostedIdRef.current[defnRef]) return

    await automationFiles.create(appId, jobData, defnRef)

    const res = await appFetch(automationApiBase(appId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: jobData.name,
        defnType: 'file',
        defnLocation: '.airo/jobs',
        defnRef,
        triggerType: 'manual',
      }),
    }, { handle401: true })
    if (!res.ok) {
      const body = await res.text()
      let code: string | undefined
      try { code = (JSON.parse(body) as { code?: string }).code } catch { /* not JSON */ }
      throw Object.assign(new Error(`Failed to register automation: ${body}`), { code })
    }
    const created: AiroGoAutomation = await res.json()
    setScheduleByDefnRef(prev => ({ ...prev, [defnRef]: mapAiroGoToSchedule(created) }))
    hostedIdRef.current[defnRef] = created.id
  }, [appId])

  const saveSchedule = useCallback(async function save(
    defnRef: string,
    jobData: AutomationJobData,
    config: ScheduleConfig,
  ) {
    if (!appId) return
    if (loadError) {
      throw new Error('Cannot save schedule: hosted automation list failed to load')
    }

    // Conflict check: reject if another automation is already scheduled at the
    // same cron slot (same UTC minute+hour). Two runs at the same time would
    // cause the second dispatch to 409 (activeAutomationRuns guard in the agent).
    const newCron = scheduleToCronExpr(config)
    const conflict = Object.entries(scheduleByDefnRef).find(
      ([existingDefnRef, s]) => existingDefnRef !== defnRef && s.cronExpr === newCron
    )
    if (conflict) {
      throw new Error(`schedule_conflict:${conflict[0]}`)
    }

    // Ensure the job file exists at .airo/jobs/{defnRef}/{defnRef}.md before
    // registering with hosting. Without this, every cron dispatch fails with
    // job_not_found because the agent reads that file to get the prompt.
    // automation-files.create() is idempotent for a given id: if the file
    // already exists (custom automations added via Add), writeFile overwrites
    // with the same content — safe, and picks up any prompt edits made since.
    await automationFiles.create(appId, jobData, defnRef)

    const existingId = hostedIdRef.current[defnRef]

    if (existingId) {
      // Update existing via PATCH
      const res = await appFetch(`${automationApiBase(appId)}/${existingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'cron', cronExpr: newCron, enabled: true }),
      }, { handle401: true })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Failed to update schedule: ${body}`)
      }
      const updated: AiroGoAutomation = await res.json()
      setScheduleByDefnRef(prev => ({ ...prev, [defnRef]: mapAiroGoToSchedule(updated) }))
      hostedIdRef.current[defnRef] = updated.id
    } else {
      // Create new via POST
      const res = await appFetch(automationApiBase(appId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: jobData.name,
          defnType: 'file',
          defnLocation: '.airo/jobs',
          defnRef,
          triggerType: 'cron',
          cronExpr: newCron,
          enabled: true,
        }),
      }, { handle401: true })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Failed to create schedule: ${body}`)
      }
      const created: AiroGoAutomation = await res.json()
      setScheduleByDefnRef(prev => ({ ...prev, [defnRef]: mapAiroGoToSchedule(created) }))
      hostedIdRef.current[defnRef] = created.id
    }
  }, [appId, loadError, scheduleByDefnRef])

  const removeSchedule = useCallback(async function remove(defnRef: string) {
    if (!appId) return
    const existingId = hostedIdRef.current[defnRef]
    if (!existingId) return

    const res = await appFetch(`${automationApiBase(appId)}/${existingId}`, {
      method: 'DELETE',
    }, { handle401: true })
    if (!res.ok && res.status !== 404) {
      const body = await res.text()
      throw new Error(`Failed to remove schedule: ${body}`)
    }
    setScheduleByDefnRef(prev => {
      const next = { ...prev }
      delete next[defnRef]
      return next
    })
    delete hostedIdRef.current[defnRef]
  }, [appId])

  const triggerRun = useCallback(async function run(defnRef: string): Promise<string> {
    if (!appId) throw new Error('No appId')
    const hostedId = hostedIdRef.current[defnRef]
    if (!hostedId) throw new Error(`No hosted automation for defnRef: ${defnRef}`)
    const res = await appFetch(`${automationApiBase(appId)}/${hostedId}/runs`, { method: 'POST' }, { handle401: true })
    if (!res.ok) {
      const body = await res.text()
      const err = new Error(`Failed to trigger run: ${body}`) as Error & { status: number }
      err.status = res.status
      throw err
    }
    const data = await res.json()
    return data.runId as string
  }, [appId])

  return { scheduleByDefnRef, loading, loadError, registerAutomation, saveSchedule, removeSchedule, reload, triggerRun }
}
