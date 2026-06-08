import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: vi.fn(() => vi.fn()),
}))

import { shipAnalyticsLog } from '@/lib/logging'
import { logImpressionEvent } from '@/utils/instrumentation'
import {
  isGathering,
  reset,
  trackFromToolResult,
} from './contextGatheringTracker'

const mockShip = vi.mocked(shipAnalyticsLog)
const mockImpression = vi.mocked(logImpressionEvent)

function track(name: string, appId: string | null, input?: { command?: string }, hasError = false) {
  trackFromToolResult({ name, input }, appId, hasError)
}

beforeEach(() => {
  reset()
  mockShip.mockClear()
  mockImpression.mockClear()
})

afterEach(() => {
  reset()
})

describe('contextGatheringTracker', () => {
  describe('#trackFromToolResult', () => {
    it('fires started once when first question tool result arrives', () => {
      track('askQuestion', 'app-1')

      expect(isGathering()).toBe(true)
      expect(mockShip).toHaveBeenCalledTimes(1)
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.started', { appId: 'app-1' })
      expect(mockImpression).toHaveBeenCalledTimes(1)
      expect(mockImpression).toHaveBeenCalledWith('develop.contextGathering.started', { appId: 'app-1' })
    })

    it('does not re-fire started for consecutive question tool results', () => {
      track('askQuestion', 'app-1')
      track('suggestedResponse', 'app-1')
      track('askQuestion', 'app-1')

      expect(mockShip).toHaveBeenCalledTimes(1)
      expect(mockImpression).toHaveBeenCalledTimes(1)
    })

    it('stays in gathering when gather-phase tool results arrive', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      track('setProjectName', 'app-1')
      track('todoList', 'app-1')
      track('colorScheme', 'app-1')
      track('fontTheme', 'app-1')
      track('brandBook', 'app-1')
      track('memorySet', 'app-1')

      expect(isGathering()).toBe(true)
      expect(mockShip).not.toHaveBeenCalled()
      expect(mockImpression).not.toHaveBeenCalled()
    })

    it('does not complete on read-only editor results during gathering', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      track('textEditor', 'app-1', { command: 'view' })
      track('str_replace_based_edit_tool', 'app-1', { command: 'view' })

      expect(isGathering()).toBe(true)
      expect(mockShip).not.toHaveBeenCalled()
    })

    it('fires completed when handoff result arrives after questions', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      track('handoff', 'app-1')

      expect(isGathering()).toBe(false)
      expect(mockShip).toHaveBeenCalledTimes(1)
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })
      expect(mockImpression).toHaveBeenCalledTimes(1)
      expect(mockImpression).toHaveBeenCalledWith('develop.contextGathering.completed', { appId: 'app-1' })
    })

    it('fires completed when a build tool result arrives after questions', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      track('fileEdit', 'app-1')

      expect(isGathering()).toBe(false)
      expect(mockShip).toHaveBeenCalledTimes(1)
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })
      expect(mockImpression).toHaveBeenCalledTimes(1)
      expect(mockImpression).toHaveBeenCalledWith('develop.contextGathering.completed', { appId: 'app-1' })
    })

    it('fires completed when any non-gather tool result arrives after questions', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      track('commerce__search_tools', 'app-1')

      expect(isGathering()).toBe(false)
      expect(mockShip).toHaveBeenCalledTimes(1)
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })
    })

    it('does not fire completed for non-gather tools when not gathering', () => {
      track('handoff', 'app-1')
      track('fileEdit', 'app-1')

      expect(isGathering()).toBe(false)
      expect(mockShip).not.toHaveBeenCalled()
    })

    it('supports multiple question/completion rounds', () => {
      track('askQuestion', 'app-1')
      track('handoff', 'app-1')

      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.started', { appId: 'app-1' })
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })

      mockShip.mockClear()
      mockImpression.mockClear()

      track('suggestedResponse', 'app-1')
      track('handoff', 'app-1')

      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.started', { appId: 'app-1' })
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })
      expect(mockShip).toHaveBeenCalledTimes(2)
    })

    it('fires completed and re-starts when appId changes mid-gathering', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      track('askQuestion', 'app-2')

      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.started', { appId: 'app-2' })
      expect(isGathering()).toBe(true)
    })

    it('handles appId change when not gathering without spurious events', () => {
      track('handoff', 'app-1')
      mockShip.mockClear()

      track('handoff', 'app-2')

      expect(mockShip).not.toHaveBeenCalled()
      expect(isGathering()).toBe(false)
    })

    it('handles null appId', () => {
      track('askQuestion', null)

      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.started', { appId: null })
      expect(mockImpression).toHaveBeenCalledWith('develop.contextGathering.started', { appId: '' })
    })

    it('does not fire when question tool result has an error', () => {
      track('askQuestion', 'app-1', undefined, true)

      expect(isGathering()).toBe(false)
      expect(mockShip).not.toHaveBeenCalled()
    })

    it('does not fire completed when turn ends with questions awaiting user input', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      expect(isGathering()).toBe(true)
      expect(mockShip).not.toHaveBeenCalled()
      expect(mockImpression).not.toHaveBeenCalled()
    })

    it('completes after follow-up questions when agent handoffs', () => {
      track('askQuestion', 'app-1')
      mockShip.mockClear()
      mockImpression.mockClear()

      track('askQuestion', 'app-1')
      track('handoff', 'app-1')

      expect(isGathering()).toBe(false)
      expect(mockShip).toHaveBeenCalledTimes(1)
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })
    })
  })

  describe('#reset', () => {
    it('clears gathering state', () => {
      track('askQuestion', 'app-1')
      expect(isGathering()).toBe(true)

      reset()
      expect(isGathering()).toBe(false)
    })

    it('allows fresh tracking after reset', () => {
      track('askQuestion', 'app-1')
      reset()
      mockShip.mockClear()
      mockImpression.mockClear()

      track('askQuestion', 'app-1')

      expect(mockShip).toHaveBeenCalledTimes(1)
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.started', { appId: 'app-1' })
    })
  })

  describe('realistic agent conversation sequence', () => {
    it('ask, brand tools, ask, file edit = one started + one completed', () => {
      track('askQuestion', 'app-1')
      track('setProjectName', 'app-1')
      track('colorScheme', 'app-1')
      track('askQuestion', 'app-1')
      track('suggestedResponse', 'app-1')
      track('brandBook', 'app-1')
      track('str_replace_based_edit_tool', 'app-1', { command: 'str_replace' })

      const startedCalls = mockShip.mock.calls.filter(
        ([event]) => event === 'funnel.context_gathering.started'
      )
      const completedCalls = mockShip.mock.calls.filter(
        ([event]) => event === 'funnel.context_gathering.completed'
      )

      expect(startedCalls).toHaveLength(1)
      expect(completedCalls).toHaveLength(1)
      expect(isGathering()).toBe(false)
    })

    it('initial build: ask, brand, handoff, fileEdit = started at ask, completed at handoff', () => {
      track('askQuestion', 'app-1')
      track('setProjectName', 'app-1')
      track('colorScheme', 'app-1')
      track('fontTheme', 'app-1')
      track('brandBook', 'app-1')
      track('handoff', 'app-1')

      const startedCalls = mockShip.mock.calls.filter(
        ([event]) => event === 'funnel.context_gathering.started'
      )
      const completedCalls = mockShip.mock.calls.filter(
        ([event]) => event === 'funnel.context_gathering.completed'
      )

      expect(startedCalls).toHaveLength(1)
      expect(completedCalls).toHaveLength(1)
      expect(isGathering()).toBe(false)

      mockShip.mockClear()
      track('fileEdit', 'app-1')

      expect(mockShip).not.toHaveBeenCalled()
    })

    it('multi-round edit: ask, handoff, ask again, fileEdit = two started + two completed', () => {
      track('askQuestion', 'app-1')
      track('handoff', 'app-1')

      mockShip.mockClear()
      mockImpression.mockClear()

      track('askQuestion', 'app-1')
      track('fileEdit', 'app-1')

      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.started', { appId: 'app-1' })
      expect(mockShip).toHaveBeenCalledWith('funnel.context_gathering.completed', { appId: 'app-1' })
    })
  })
})
