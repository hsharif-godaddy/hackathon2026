/**
 * @vitest-environment node
 */
import { beforeEach,describe, expect, it } from 'vitest'

import { useWorkflowProgressStore } from './useWorkflowProgressStore'

describe('useWorkflowProgressStore', () => {
  beforeEach(() => {
    useWorkflowProgressStore.getState().reset()
  })

  describe('hydrateFromApi', () => {
    it('populates steps from workflow state', () => {
      const state = {
        schemaVersion: 1 as const,
        appId: 'app-1',
        archetype: 'site' as const,
        northStar: { goals: ['sell'], audience: 'biz', voice: 'friendly' },
        steps: [
          { id: 'step-1', title: 'Interview', type: 'gate' as const, status: 'done' as const, dependsOn: [], ownedFiles: [], verify: [] },
          { id: 'step-2', title: 'Design', type: 'auto' as const, status: 'in_progress' as const, dependsOn: ['step-1'], ownedFiles: [], verify: [] },
        ],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T01:00:00Z',
      }

      useWorkflowProgressStore.getState().hydrateFromApi(state)

      const { steps, archetype, updatedAt } = useWorkflowProgressStore.getState()
      expect(steps).toHaveLength(2)
      expect(archetype).toBe('site')
      expect(updatedAt).toBe('2026-01-01T01:00:00Z')
    })

    it('does nothing when passed null', () => {
      useWorkflowProgressStore.getState().hydrateFromApi(null)

      const { steps } = useWorkflowProgressStore.getState()
      expect(steps).toHaveLength(0)
    })

    it('discards stale hydration when store has newer updatedAt', () => {
      const fresh = {
        schemaVersion: 1 as const,
        appId: 'app-1',
        archetype: 'site' as const,
        northStar: { goals: [], audience: '', voice: '' },
        steps: [{ id: 's1', title: 'A', type: 'auto' as const, status: 'in_progress' as const, dependsOn: [], ownedFiles: [], verify: [] }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T02:00:00Z',
      }
      const stale = { ...fresh, updatedAt: '2026-01-01T01:00:00Z', steps: [] }

      useWorkflowProgressStore.getState().hydrateFromApi(fresh)
      useWorkflowProgressStore.getState().hydrateFromApi(stale)

      expect(useWorkflowProgressStore.getState().steps).toHaveLength(1)
    })
  })

  describe('updateFromToolResult', () => {
    it('updates steps from a full state result', () => {
      const result = JSON.stringify({
        schemaVersion: 1,
        appId: 'app-1',
        archetype: 'app',
        northStar: { goals: [], audience: '', voice: '' },
        steps: [{ id: 's1', title: 'Build', type: 'auto', status: 'done', dependsOn: [], ownedFiles: [], verify: [] }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T03:00:00Z',
      })

      useWorkflowProgressStore.getState().updateFromToolResult('complete_step', result)

      expect(useWorkflowProgressStore.getState().steps[0]!.status).toBe('done')
    })

    it('ignores non-state operations like next_actions', () => {
      useWorkflowProgressStore.getState().updateFromToolResult('next_actions', '[]')

      expect(useWorkflowProgressStore.getState().steps).toHaveLength(0)
    })

    it('ignores init operation', () => {
      useWorkflowProgressStore.getState().updateFromToolResult('init', '{"initialized":true}')

      expect(useWorkflowProgressStore.getState().steps).toHaveLength(0)
    })

    it('ignores malformed JSON', () => {
      useWorkflowProgressStore.getState().updateFromToolResult('get_state', 'not json')

      expect(useWorkflowProgressStore.getState().steps).toHaveLength(0)
    })
  })
})

