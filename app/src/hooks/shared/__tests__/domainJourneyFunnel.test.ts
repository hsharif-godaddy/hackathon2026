// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockTrackMilestone } = vi.hoisted(() => ({ mockTrackMilestone: vi.fn() }))

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/lib/journeyTracker', () => ({
  JourneyTracker: {
    current: () => ({ trackMilestone: mockTrackMilestone }),
  },
}))

import { shipAnalyticsLog } from '@/lib/logging'
import {
  finishDomainJourney,
  getDomainJourneyId,
  resetDomainJourneyFunnel,
  startDomainJourney,
  trackDomainConnectStep,
  trackDomainMilestone,
} from '../domainJourneyFunnel'

const mockShip = vi.mocked(shipAnalyticsLog)

function shipCall(event: string): Record<string, unknown> | undefined {
  const found = mockShip.mock.calls.find((call) => call[0] === event)
  return found?.[1] as Record<string, unknown> | undefined
}

beforeEach(() => {
  resetDomainJourneyFunnel()
  try {
    sessionStorage.clear()
  } catch {
    /* noop */
  }
  mockShip.mockClear()
  mockTrackMilestone.mockClear()
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  vi.useRealTimers()
  resetDomainJourneyFunnel()
})

describe('startDomainJourney', () => {
  it('emits funnel.domain.started on both sinks and returns an id', () => {
    const id: string = startDomainJourney({ appId: 'app-1', conversationId: 'c1', fqdn: 'x.com' })

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(mockShip).toHaveBeenCalledWith(
      'funnel.domain.started',
      expect.objectContaining({
        domainJourneyId: id,
        milestone: 'started',
        outcome: 'success',
        appId: 'app-1',
        conversationId: 'c1',
        fqdn: 'x.com',
        durationFromStartMs: 0,
        durationFromPrevMilestoneMs: null,
      })
    )
    expect(mockTrackMilestone).toHaveBeenCalledWith(
      'domain.started',
      expect.objectContaining({ domainJourneyId: id, milestone: 'started', outcome: 'success' })
    )
  })

  it('is idempotent per appId (no duplicate started)', () => {
    const id1: string = startDomainJourney({ appId: 'app-1' })
    const id2: string = startDomainJourney({ appId: 'app-1' })

    expect(id2).toBe(id1)
    expect(mockShip).toHaveBeenCalledTimes(1)
    expect(mockTrackMilestone).toHaveBeenCalledTimes(1)
  })

  it('re-mints when a different appId starts a journey', () => {
    const id1: string = startDomainJourney({ appId: 'app-1' })
    mockShip.mockClear()

    const id2: string = startDomainJourney({ appId: 'app-2' })

    expect(id2).not.toBe(id1)
    expect(mockShip).toHaveBeenCalledWith(
      'funnel.domain.started',
      expect.objectContaining({ appId: 'app-2', domainJourneyId: id2 })
    )
  })
})

describe('getDomainJourneyId', () => {
  it('returns the active id without emitting', () => {
    const id: string = startDomainJourney({ appId: 'app-1' })
    mockShip.mockClear()
    mockTrackMilestone.mockClear()

    expect(getDomainJourneyId('app-1')).toBe(id)
    expect(getDomainJourneyId()).toBe(id)
    expect(mockShip).not.toHaveBeenCalled()
    expect(mockTrackMilestone).not.toHaveBeenCalled()
  })

  it('returns null for a mismatched appId', () => {
    startDomainJourney({ appId: 'app-1' })
    expect(getDomainJourneyId('app-2')).toBeNull()
  })
})

describe('timing', () => {
  it('computes durationFromStartMs and durationFromPrevMilestoneMs across milestones', () => {
    startDomainJourney({ appId: 'app-1' })
    vi.setSystemTime(1000)
    trackDomainMilestone('search_triggered', 'success', { appId: 'app-1' })
    vi.setSystemTime(1500)
    trackDomainMilestone('search_completed', 'success', { appId: 'app-1' })

    expect(shipCall('funnel.domain.search_triggered')).toMatchObject({
      durationFromStartMs: 1000,
      durationFromPrevMilestoneMs: 1000,
    })
    expect(shipCall('funnel.domain.search_completed')).toMatchObject({
      durationFromStartMs: 1500,
      durationFromPrevMilestoneMs: 500,
    })
  })

  it('falls back to the journey appId when a milestone omits it', () => {
    startDomainJourney({ appId: 'app-1' })
    mockShip.mockClear()

    trackDomainMilestone('connect_started', 'success', { fqdn: 'x.com' })

    expect(shipCall('funnel.domain.connect_started')).toMatchObject({ appId: 'app-1', fqdn: 'x.com' })
  })
})

describe('trackDomainConnectStep', () => {
  it('emits once per distinct sub-step and dedupes repeats', () => {
    startDomainJourney({ appId: 'app-1' })
    mockShip.mockClear()

    trackDomainConnectStep('builder_domain_job_configuring_dns', { appId: 'app-1' })
    trackDomainConnectStep('builder_domain_job_configuring_dns', { appId: 'app-1' })
    trackDomainConnectStep('builder_domain_job_verifying_domain', { appId: 'app-1' })

    const stepCalls = mockShip.mock.calls.filter((call) => call[0] === 'funnel.domain.connect_step')
    expect(stepCalls).toHaveLength(2)
    expect(stepCalls[0][1]).toMatchObject({
      subStep: 'builder_domain_job_configuring_dns',
      milestone: 'connect_step',
      outcome: 'success',
    })
    expect(stepCalls[1][1]).toMatchObject({ subStep: 'builder_domain_job_verifying_domain' })
  })
})

describe('finishDomainJourney', () => {
  it('connect_completed clears the journey so the next flow re-mints', () => {
    const id1: string = startDomainJourney({ appId: 'app-1' })
    finishDomainJourney('connect_completed', 'success', { appId: 'app-1', fqdn: 'x.com' })

    expect(shipCall('funnel.domain.connect_completed')).toMatchObject({
      outcome: 'success',
      domainJourneyId: id1,
    })
    expect(getDomainJourneyId('app-1')).toBeNull()

    const id2: string = startDomainJourney({ appId: 'app-1' })
    expect(id2).not.toBe(id1)
  })

  it('connect_failed emits but keeps the journey for a retry', () => {
    const id1: string = startDomainJourney({ appId: 'app-1' })
    finishDomainJourney('connect_failed', 'failure', { appId: 'app-1', errorType: 'boom' })

    expect(shipCall('funnel.domain.connect_failed')).toMatchObject({
      outcome: 'failure',
      errorType: 'boom',
    })
    expect(getDomainJourneyId('app-1')).toBe(id1)
  })

  it('supports a timeout outcome on connect_failed', () => {
    startDomainJourney({ appId: 'app-1' })
    finishDomainJourney('connect_failed', 'timeout', { appId: 'app-1', errorType: 'poll_timeout', elapsedMs: 90000 })

    expect(shipCall('funnel.domain.connect_failed')).toMatchObject({
      outcome: 'timeout',
      errorType: 'poll_timeout',
      elapsedMs: 90000,
    })
  })

  it('purchase_failed carries errorType and keeps the journey', () => {
    const id1: string = startDomainJourney({ appId: 'app-1' })
    finishDomainJourney('purchase_failed', 'failure', { appId: 'app-1', errorType: 'CARD_DECLINED' })

    expect(shipCall('funnel.domain.purchase_failed')).toMatchObject({ errorType: 'CARD_DECLINED' })
    expect(getDomainJourneyId('app-1')).toBe(id1)
  })
})

describe('dual-sink parity', () => {
  it('sends identical journey id / outcome to both sinks', () => {
    const id: string = startDomainJourney({ appId: 'app-1' })
    mockShip.mockClear()
    mockTrackMilestone.mockClear()

    trackDomainMilestone('cart_added', 'success', { appId: 'app-1', fqdn: 'x.com' })

    const esPayload = shipCall('funnel.domain.cart_added')
    const fsPayload = mockTrackMilestone.mock.calls.find((call) => call[0] === 'domain.cart_added')?.[1] as
      | Record<string, unknown>
      | undefined
    expect(esPayload?.domainJourneyId).toBe(id)
    expect(fsPayload?.domainJourneyId).toBe(id)
    expect(esPayload?.outcome).toBe('success')
    expect(fsPayload?.outcome).toBe('success')
  })
})

describe('sessionStorage rehydration', () => {
  it('rehydrates the journey from sessionStorage after a reload', async () => {
    const id: string = startDomainJourney({ appId: 'app-1' })
    vi.setSystemTime(2000)
    trackDomainMilestone('connect_started', 'success', { appId: 'app-1' })

    vi.resetModules()
    const reloaded = await import('../domainJourneyFunnel')

    expect(reloaded.getDomainJourneyId('app-1')).toBe(id)
    expect(reloaded.startDomainJourney({ appId: 'app-1' })).toBe(id)
  })
})
