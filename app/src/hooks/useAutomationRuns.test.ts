import { describe, expect, it } from 'vitest'

import { mapHostingRun, mapHostingRunStatus } from '@/hooks/useAutomationRuns'

describe('mapHostingRunStatus', () => {
  it('maps hosting success statuses', () => {
    expect(mapHostingRunStatus('succeeded')).toBe('success')
    expect(mapHostingRunStatus('success')).toBe('success')
  })

  it('maps hosting failed statuses', () => {
    expect(mapHostingRunStatus('failed_permanent')).toBe('failed')
    // failed_retryable shows as pending — the run is expected to be re-dispatched by hosting
    expect(mapHostingRunStatus('failed_retryable')).toBe('pending')
  })

  it('maps in-flight statuses', () => {
    expect(mapHostingRunStatus('running')).toBe('running')
    expect(mapHostingRunStatus('dispatched')).toBe('running')
    expect(mapHostingRunStatus('queued')).toBe('pending')
  })
})

describe('mapHostingRun', () => {
  it('maps airo-go hosting wire shape to UI model', () => {
    const run = mapHostingRun({
      id: 'fveytpw0uk',
      scheduledSlot: '2026-06-30T10:34:44Z',
      triggerType: 'cron',
      status: 'failed_permanent',
      lastError: 'Token purpose must be automation',
      createdAt: '2026-06-30T10:35:20.308541Z',
      updatedAt: '2026-06-30T10:35:24.037756Z',
    })

    expect(run.status).toBe('failed')
    expect(run.startedAt).toBe('2026-06-30T10:35:20.308541Z')
    expect(run.triggeredBy).toBe('scheduled')
    expect(run.errorMessage).toBe('Token purpose must be automation')
    expect(run.durationSeconds).toBe(4)
  })

  it('prefers explicit startedAt and manual trigger when present', () => {
    const run = mapHostingRun({
      id: 'abc',
      status: 'succeeded',
      startedAt: '2026-06-01T12:00:00Z',
      finishedAt: '2026-06-01T12:01:30Z',
      triggeredBy: 'manual',
      durationSeconds: 90,
    })

    expect(run.status).toBe('success')
    expect(run.startedAt).toBe('2026-06-01T12:00:00Z')
    expect(run.triggeredBy).toBe('manual')
    expect(run.durationSeconds).toBe(90)
  })

  it('maps dispatched as running (not failed)', () => {
    const run = mapHostingRun({
      id: 'mdxryrjpih',
      automationId: '1kvlfpxbjo',
      scheduledSlot: '2026-06-30T12:32:59Z',
      triggerType: 'cron',
      status: 'dispatched',
      createdAt: '2026-06-30T12:33:18.529955Z',
      updatedAt: '2026-06-30T12:33:18.536341Z',
    })

    expect(run.status).toBe('running')
    expect(run.errorMessage).toBeUndefined()
    expect(run.durationSeconds).toBeUndefined()
  })
})
