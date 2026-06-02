import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
  logActionEvent: vi.fn(function () { return vi.fn(); }),
}))

import { shipAnalyticsLog } from '@/lib/logging'
import { logActionEvent, logImpressionEvent } from '@/utils/instrumentation'
import {
  activateInitialBuildFunnel,
  isInitialBuildComplete,
  isInitialBuildFunnelActive,
  resetInitialBuildFunnel,
  trackBuildComplete,
  trackHandoff,
  trackPostInteraction,
  trackQuestionReceived,
} from './initialBuildFunnel'

const mockShip = vi.mocked(shipAnalyticsLog)
const mockImpression = vi.mocked(logImpressionEvent)
const mockAction = vi.mocked(logActionEvent)

beforeEach(() => {
  resetInitialBuildFunnel()
  mockShip.mockClear()
  mockImpression.mockClear()
  mockAction.mockClear()
})

afterEach(() => {
  resetInitialBuildFunnel()
})

describe('activateInitialBuildFunnel', () => {
  it('fires started event + impression on first activation', () => {
    activateInitialBuildFunnel('app-1')

    expect(mockShip).toHaveBeenCalledWith('funnel.initial_build.started', { appId: 'app-1' })
    expect(mockImpression).toHaveBeenCalledWith('develop.initialBuild.start', { appId: 'app-1' })
    expect(isInitialBuildFunnelActive()).toBe(true)
  })

  it('is idempotent for the same appId', () => {
    activateInitialBuildFunnel('app-1')
    activateInitialBuildFunnel('app-1')

    expect(mockShip).toHaveBeenCalledTimes(1)
    expect(mockImpression).toHaveBeenCalledTimes(1)
  })

  it('resets and re-activates when navigating to a different app', () => {
    activateInitialBuildFunnel('app-1')
    trackQuestionReceived()
    trackHandoff()
    trackBuildComplete('abc123')

    expect(isInitialBuildComplete()).toBe(true)

    mockShip.mockClear()
    mockImpression.mockClear()
    mockAction.mockClear()

    activateInitialBuildFunnel('app-2')

    expect(isInitialBuildComplete()).toBe(false)
    expect(mockShip).toHaveBeenCalledWith('funnel.initial_build.started', { appId: 'app-2' })
    expect(mockImpression).toHaveBeenCalledWith('develop.initialBuild.start', { appId: 'app-2' })

    trackQuestionReceived()
    expect(mockShip).toHaveBeenCalledWith('funnel.initial_build.question_received', { appId: 'app-2' })
  })
})

describe('trackQuestionReceived', () => {
  it('no-ops when funnel inactive', () => {
    trackQuestionReceived()
    expect(mockShip).not.toHaveBeenCalled()
  })

  it('fires exactly once', () => {
    activateInitialBuildFunnel('app-1')
    mockShip.mockClear()

    trackQuestionReceived()
    trackQuestionReceived()

    expect(mockShip).toHaveBeenCalledTimes(1)
    expect(mockShip).toHaveBeenCalledWith('funnel.initial_build.question_received', { appId: 'app-1' })
  })
})

describe('trackHandoff', () => {
  it('no-ops when funnel inactive', () => {
    trackHandoff()
    expect(mockShip).not.toHaveBeenCalled()
  })

  it('fires exactly once', () => {
    activateInitialBuildFunnel('app-1')
    mockShip.mockClear()

    trackHandoff()
    trackHandoff()

    expect(mockShip).toHaveBeenCalledTimes(1)
    expect(mockShip).toHaveBeenCalledWith('funnel.initial_build.handoff', { appId: 'app-1' })
  })
})

describe('trackBuildComplete', () => {
  it('no-ops when funnel inactive', () => {
    trackBuildComplete('abc123')
    expect(mockShip).not.toHaveBeenCalled()
    expect(mockAction).not.toHaveBeenCalled()
  })

  it('fires shipAnalyticsLog + logActionEvent exactly once', () => {
    activateInitialBuildFunnel('app-1')
    mockShip.mockClear()
    mockAction.mockClear()

    trackBuildComplete('abc123')
    trackBuildComplete('def456')

    expect(mockShip).toHaveBeenCalledTimes(1)
    expect(mockShip).toHaveBeenCalledWith('funnel.initial_build.complete', {
      appId: 'app-1',
      commitHash: 'abc123',
    })
    expect(mockAction).toHaveBeenCalledTimes(1)
    expect(mockAction).toHaveBeenCalledWith({
      eid: 'develop.firstBuild.complete',
      action: 'load',
      customProperties: { appId: 'app-1' },
    })
    expect(isInitialBuildComplete()).toBe(true)
  })
})

describe('trackPostInteraction', () => {
  it('no-ops when funnel inactive', () => {
    trackPostInteraction()
    expect(mockShip).not.toHaveBeenCalled()
  })

  it('no-ops when build not complete', () => {
    activateInitialBuildFunnel('app-1')
    mockShip.mockClear()

    trackPostInteraction()

    expect(mockShip).not.toHaveBeenCalled()
  })

  it('fires exactly once after build complete', () => {
    activateInitialBuildFunnel('app-1')
    trackBuildComplete('abc123')
    mockShip.mockClear()

    trackPostInteraction()
    trackPostInteraction()

    expect(mockShip).toHaveBeenCalledTimes(1)
    expect(mockShip).toHaveBeenCalledWith('funnel.initial_build.post_interaction', { appId: 'app-1' })
  })
})

describe('resetInitialBuildFunnel', () => {
  it('clears all state', () => {
    activateInitialBuildFunnel('app-1')
    trackQuestionReceived()
    trackHandoff()
    trackBuildComplete('abc123')
    trackPostInteraction()

    resetInitialBuildFunnel()

    expect(isInitialBuildFunnelActive()).toBe(false)
    expect(isInitialBuildComplete()).toBe(false)

    mockShip.mockClear()
    trackQuestionReceived()
    trackHandoff()
    trackPostInteraction()
    expect(mockShip).not.toHaveBeenCalled()
  })
})
