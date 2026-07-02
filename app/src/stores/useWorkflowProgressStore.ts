import { create } from 'zustand'

import { logger } from '@/lib/request-context'

export interface WorkflowProgressStep {
  id: string
  title: string
  type: string
  status: 'pending' | 'in_progress' | 'blocked' | 'done' | 'skipped' | 'failed'
  dependsOn: string[]
  ownedFiles: string[]
  verify: Array<{ kind: string; spec: string }>
  gate?: { prompt: string; satisfaction?: unknown }
  commitHash?: string
  assignedBuilder?: string
}

export interface WorkflowProgressFullState {
  schemaVersion: 1
  appId: string
  archetype: string
  northStar: { goals: string[]; audience: string; voice: string }
  steps: WorkflowProgressStep[]
  createdAt: string
  updatedAt: string
}

interface WorkflowProgressState {
  steps: WorkflowProgressStep[]
  archetype: string | null
  updatedAt: string | null
}

interface WorkflowProgressActions {
  hydrateFromApi: (state: WorkflowProgressFullState | null) => void
  updateFromToolResult: (operation: string, result: string) => void
  reset: () => void
}

type WorkflowProgressStore = WorkflowProgressState & WorkflowProgressActions

const STATE_RETURNING_OPERATIONS: ReadonlySet<string> = new Set([
  'get_state', 'assign', 'complete_step', 'satisfy_gate',
  'skip_step', 'fail_step', 'add_steps', 'update_step',
])

export function isValidWorkflowState(value: unknown): value is WorkflowProgressFullState {
  if (typeof value !== 'object' || value === null) return false
  const obj: Record<string, unknown> = value as Record<string, unknown>
  return obj.schemaVersion === 1 && typeof obj.appId === 'string' && Array.isArray(obj.steps)
}

export const useWorkflowProgressStore = create<WorkflowProgressStore>()((set, get) => ({
  steps: [],
  archetype: null,
  updatedAt: null,

  hydrateFromApi: (state: WorkflowProgressFullState | null): void => {
    if (!state) return

    const current: WorkflowProgressState = get()
    if (current.updatedAt && state.updatedAt && current.updatedAt > state.updatedAt) {
      return
    }

    set({
      steps: state.steps,
      archetype: state.archetype,
      updatedAt: state.updatedAt,
    })
  },

  updateFromToolResult: (operation: string, result: string): void => {
    if (!STATE_RETURNING_OPERATIONS.has(operation)) return

    try {
      const parsed: unknown = JSON.parse(result)
      if (!isValidWorkflowState(parsed)) return

      const current: WorkflowProgressState = get()
      if (current.updatedAt && parsed.updatedAt && current.updatedAt > parsed.updatedAt) {
        return
      }

      set({
        steps: parsed.steps,
        archetype: parsed.archetype,
        updatedAt: parsed.updatedAt,
      })
    } catch {
      logger.debug('workflowProgressStore.updateFromToolResult.parseFailed', { operation })
    }
  },

  reset: (): void => {
    set({ steps: [], archetype: null, updatedAt: null })
  },
}))

export const useWorkflowSteps = (): WorkflowProgressStep[] =>
  useWorkflowProgressStore(state => state.steps)

export const useWorkflowArchetype = (): string | null =>
  useWorkflowProgressStore(state => state.archetype)
