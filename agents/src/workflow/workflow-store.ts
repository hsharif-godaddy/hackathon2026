import { createForWorkspace } from '../workspace/index.js'
import type { WorkflowState, WorkflowStep, StepStatus, WorkflowArchetype } from './types.js'
import { Logger } from '../logging/index.js'
import { GitUtils } from '../utils/git.js'
import { AppRepository } from '../database/repositories/AppRepository.js'

const logger = Logger.create({ component: 'workflow-store' })
const WORKFLOW_PATH = 'docs/workflow.json'

/**
 * Per-app mutex for workflow state operations. Serializes all read-modify-write
 * sequences on the same appId so concurrent async paths (afterToolExecution hook,
 * resolveBlockedGates, workflow tool operations) cannot clobber each other's mutations.
 */
const appLocks: Map<string, Promise<void>> = new Map()

export async function withWorkflowLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const prev: Promise<void> = appLocks.get(appId) ?? Promise.resolve()
  let resolve: () => void
  const next: Promise<void> = new Promise<void>((r: () => void) => { resolve = r })
  appLocks.set(appId, next)
  try {
    await prev
    return await fn()
  } finally {
    resolve!()
    if (appLocks.get(appId) === next) appLocks.delete(appId)
  }
}

const LEGACY_ARCHETYPE_MAP: Record<string, WorkflowArchetype> = {
  'marketing-site': 'site',
  'admin-app': 'app',
}

const VALID_ARCHETYPES: Set<string> = new Set<string>(['site', 'app', 'game', 'custom'])

function migrateArchetype(obj: Record<string, unknown>): void {
  const raw: unknown = obj.archetype
  if (typeof raw === 'string' && !VALID_ARCHETYPES.has(raw)) {
    const mapped: WorkflowArchetype | undefined = LEGACY_ARCHETYPE_MAP[raw]
    if (mapped) {
      obj.archetype = mapped
    } else {
      obj.archetype = 'custom'
    }
  }
}

function isValidWorkflowState(value: unknown): value is WorkflowState {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (obj.schemaVersion !== 1 || typeof obj.appId !== 'string' || !Array.isArray(obj.steps)) return false
  migrateArchetype(obj)
  return true
}

export async function readWorkflowState(appId: string): Promise<WorkflowState | null> {
  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) {
    logger.warn('workflow_store.read.no_workspace', { appId })
    return null
  }
  try {
    const result = await workspace.files.view({ path: WORKFLOW_PATH })
    const state: unknown = JSON.parse(result.content)
    if (!isValidWorkflowState(state)) {
      logger.warn('workflow_store.read.invalid_schema', { appId })
      return null
    }
    return state
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error)
    if (message.includes('not_found') || message.includes('ENOENT') || message.includes('404')) {
      return null
    }
    logger.warn('workflow_store.read.error', { appId, error: message })
    return null
  }
}

export async function writeWorkflowState(appId: string, state: WorkflowState): Promise<boolean> {
  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) {
    logger.warn('workflow_store.write.no_workspace', { appId })
    return false
  }
  const updated: WorkflowState = { ...state, updatedAt: new Date().toISOString() }
  try {
    await workspace.files.write({ path: WORKFLOW_PATH, content: JSON.stringify(updated, null, 2) })
    return true
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error)
    logger.error('workflow_store.write.error', { appId, error: message })
    return false
  }
}

export function areDepsResolved(state: WorkflowState, step: WorkflowStep): boolean {
  const doneStatuses: Set<StepStatus> = new Set(['done', 'skipped'])
  return step.dependsOn.every(
    (depId: string) => {
      const dep: WorkflowStep | undefined = state.steps.find((s: WorkflowStep) => s.id === depId)
      return dep !== undefined && doneStatuses.has(dep.status)
    }
  )
}

export function computeNextActions(state: WorkflowState): WorkflowStep[] {
  const eligible: WorkflowStep[] = []

  for (const step of state.steps) {
    if (step.status !== 'pending') continue
    if (areDepsResolved(state, step)) {
      eligible.push(step)
    }
  }
  return eligible
}

export function validateOwnedFilesDisjoint(steps: WorkflowStep[]): string[] {
  const errors: string[] = []
  for (let i = 0; i < steps.length; i++) {
    for (let j = i + 1; j < steps.length; j++) {
      const a: WorkflowStep | undefined = steps[i]
      const b: WorkflowStep | undefined = steps[j]
      if (a === undefined || b === undefined) continue
      // If one depends on the other, they can't run concurrently — skip
      if (a.dependsOn.includes(b.id) || b.dependsOn.includes(a.id)) continue
      // Check for overlapping files
      const overlap: string[] = a.ownedFiles.filter((f: string) => b.ownedFiles.includes(f))
      if (overlap.length > 0) {
        errors.push(`Steps "${a.id}" and "${b.id}" share ownedFiles: ${overlap.join(', ')}`)
      }
    }
  }
  return errors
}

/**
 * Called by the orchestrator before its turn ends. Reverts any files owned by
 * failed steps so the git-hook-service's greedy `git add .` cannot accidentally
 * commit unverified work.
 *
 * Handles both tracked-modified files (git checkout HEAD -- <file>) and
 * untracked-new files (workspace delete). Processes each file independently so
 * one failure does not abort the batch.
 *
 * Returns the list of files that could not be reverted (empty = full success).
 * If no workflow state exists or no failed steps are found, returns [] immediately.
 */
export async function reconcileBeforeTurnEnd(appId: string): Promise<string[]> {
  const state: WorkflowState | null = await readWorkflowState(appId)
  if (!state) return []

  const failedSteps: WorkflowStep[] = state.steps.filter(
    (s: WorkflowStep) => s.status === 'failed'
  )
  if (failedSteps.length === 0) return []

  const filesToRevert: string[] = failedSteps.flatMap(
    (s: WorkflowStep) => s.ownedFiles
  )
  if (filesToRevert.length === 0) return []

  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) {
    logger.warn('workflow_store.reconcile.no_workspace', { appId })
    return filesToRevert
  }

  try {
    const appRepository: AppRepository = new AppRepository()
    const app = appRepository.findById(appId)
    if (!app) {
      logger.warn('workflow_store.reconcile.no_app', { appId })
      return filesToRevert
    }

    const gitUtils: GitUtils = new GitUtils(workspace.tasks)

    const porcelainResult = await workspace.tasks.runCommandSync({
      command: `git status --porcelain -- ${filesToRevert.map((f: string) => `'${f}'`).join(' ')}`,
      workingDir: app.path,
      timeoutSeconds: 10,
    })

    const untrackedFiles: Set<string> = new Set()
    const trackedFiles: Set<string> = new Set()

    if (porcelainResult.exitCode === 0) {
      const lines: string[] = porcelainResult.stdout.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        const status: string = line.substring(0, 2)
        const filePath: string = line.substring(3).trim()
        if (status === '??') {
          untrackedFiles.add(filePath)
        } else {
          trackedFiles.add(filePath)
        }
      }
    } else {
      trackedFiles.clear()
      for (const f of filesToRevert) trackedFiles.add(f)
    }

    const unrevertedFiles: string[] = []

    for (const file of trackedFiles) {
      const result = await gitUtils.checkoutFiles(app.path, [file])
      if (!result.success) {
        logger.warn('workflow_store.reconcile.checkout_file_failed', { appId, file, stderr: result.stderr })
        unrevertedFiles.push(file)
      }
    }

    for (const file of untrackedFiles) {
      try {
        await workspace.files.delete({ path: file })
      } catch (err: unknown) {
        logger.warn('workflow_store.reconcile.delete_file_failed', {
          appId, file, error: err instanceof Error ? err.message : String(err),
        })
        unrevertedFiles.push(file)
      }
    }

    const revertedCount: number = filesToRevert.length - unrevertedFiles.length
    if (revertedCount > 0) {
      logger.info('workflow_store.reconcile.reverted', { appId, fileCount: revertedCount })
    }
    return unrevertedFiles
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error)
    logger.warn('workflow_store.reconcile.error', { appId, error: message })
    return filesToRevert
  }
}
