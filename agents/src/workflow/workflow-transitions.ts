/**
 * Passive workflow state transitions.
 *
 * Called from the deep-build agent's `afterToolExecution` hook. Observes
 * tool calls (runAgent, awaitAgents, askQuestion) and auto-advances the
 * workflow state so the agent doesn't need to make explicit workflow tool
 * calls for bookkeeping.
 */

import { readWorkflowState, writeWorkflowState, withWorkflowLock, areDepsResolved } from './workflow-store.js'
import { runVerifyChecks } from './verify-runner.js'
import type { WorkflowState, WorkflowStep } from './types.js'
import type { JobResult } from '../agents/sub-agent-job-registry.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'workflow-transitions' })

/**
 * Observe a completed tool call and auto-advance workflow state.
 * Called from afterToolExecution — must not throw (failures are logged and swallowed).
 */
export async function handleToolCompletion(
  appId: string,
  toolName: string,
  args: unknown,
  result: unknown,
  error: unknown,
): Promise<void> {
  if (error) return

  try {
    switch (toolName) {
      case 'runAgent':
        await handleRunAgent(appId, args, result)
        break
      case 'awaitAgents':
        await handleAwaitAgents(appId, result)
        break
      case 'askQuestion':
        await handleAskQuestion(appId)
        break
      default:
        break
    }
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : String(err)
    logger.warn('workflow_transitions.error', { appId, toolName, error: message })
  }
}

function extractStepId(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const inputs: unknown = (args as Record<string, unknown>).inputs
  if (!inputs || typeof inputs !== 'object') return undefined
  const raw: unknown = (inputs as Record<string, unknown>).stepId
  return typeof raw === 'string' ? raw : undefined
}

function extractJobId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const jobId: unknown = (result as Record<string, unknown>).jobId
  return typeof jobId === 'string' ? jobId : undefined
}

function extractInteractiveAgent(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const rec = result as Record<string, unknown>
  if (rec.interactive !== true) return undefined
  const agent: unknown = rec.agent
  return typeof agent === 'string' ? agent : undefined
}

/**
 * runAgent with inputs.stepId → mark step in_progress, record assignedBuilder.
 * Supports both background (jobId) and interactive (agent name) tracking.
 */
async function handleRunAgent(appId: string, args: unknown, result: unknown): Promise<void> {
  const stepId: string | undefined = extractStepId(args)
  if (!stepId) return

  const trackingId: string | undefined = extractJobId(result) ?? extractInteractiveAgent(result)
  if (!trackingId) return

  await withWorkflowLock(appId, async (): Promise<void> => {
    const state: WorkflowState | null = await readWorkflowState(appId)
    if (!state) return

    const step: WorkflowStep | undefined = state.steps.find((s: WorkflowStep) => s.id === stepId)
    if (!step) {
      logger.warn('workflow_transitions.run_agent.step_not_found', { appId, stepId, trackingId })
      return
    }

    const assignableStatuses: Set<string> = new Set(['pending', 'blocked', 'failed'])
    if (!assignableStatuses.has(step.status)) return

    if (!areDepsResolved(state, step)) {
      logger.warn('workflow_transitions.run_agent.deps_not_resolved', { appId, stepId, trackingId })
      return
    }

    step.status = 'in_progress'
    step.assignedBuilder = trackingId
    if (step.notes) {
      step.notes = undefined
    }
    await writeWorkflowState(appId, state)
    logger.info('workflow_transitions.auto_assign', { appId, stepId, trackingId })
  })
}

/**
 * awaitAgents returns completed jobs → find their steps, verify, mark done/failed
 */
async function handleAwaitAgents(appId: string, result: unknown): Promise<void> {
  if (!result || typeof result !== 'object') return
  const resultsRaw: unknown = (result as Record<string, unknown>).results
  if (!Array.isArray(resultsRaw) || resultsRaw.length === 0) return
  const jobResults: JobResult[] = resultsRaw as JobResult[]

  await withWorkflowLock(appId, async (): Promise<void> => {
    const state: WorkflowState | null = await readWorkflowState(appId)
    if (!state) return

    let stateChanged: boolean = false

    for (const job of jobResults) {
      if (!job.jobId) continue

      const step: WorkflowStep | undefined = state.steps.find(
        (s: WorkflowStep) => s.assignedBuilder === job.jobId,
      )
      if (!step) continue
      if (step.status !== 'in_progress') continue

      if (job.status === 'success') {
        const verifyResult = await runVerifyChecks(appId, step.verify, step.ownedFiles)
        if (verifyResult.passed) {
          step.status = 'done'
          logger.info('workflow_transitions.auto_complete', { appId, stepId: step.id, jobId: job.jobId })
        } else {
          step.status = 'failed'
          step.notes = `Verification failed: ${verifyResult.failures.join('; ')}`
          logger.warn('workflow_transitions.auto_fail_verify', { appId, stepId: step.id, failures: verifyResult.failures })
        }
        stateChanged = true
      } else if (job.status === 'error' || job.status === 'aborted' || job.status === 'timeout') {
        step.status = 'failed'
        step.notes = `Builder ${job.status}: ${job.error ?? 'unknown'}`
        logger.warn('workflow_transitions.auto_fail_error', { appId, stepId: step.id, status: job.status, error: job.error })
        stateChanged = true
      }
    }

    if (stateChanged) {
      await writeWorkflowState(appId, state)
    }
  })
}

/**
 * askQuestion called → if there's a pending gate step that's next-eligible, mark it blocked
 * (signals it's awaiting user response; will be auto-resolved on next turn)
 */
async function handleAskQuestion(appId: string): Promise<void> {
  await withWorkflowLock(appId, async (): Promise<void> => {
    const state: WorkflowState | null = await readWorkflowState(appId)
    if (!state) return

    const doneStatuses: Set<string> = new Set(['done', 'skipped'])

    for (const step of state.steps) {
      if (step.type !== 'gate' || step.status !== 'pending') continue

      const depsResolved: boolean = step.dependsOn.every((depId: string) => {
        const dep: WorkflowStep | undefined = state.steps.find((s: WorkflowStep) => s.id === depId)
        return dep !== undefined && doneStatuses.has(dep.status)
      })

      if (depsResolved) {
        step.status = 'blocked'
        await writeWorkflowState(appId, state)
        logger.info('workflow_transitions.gate_blocked', { appId, stepId: step.id })
        return
      }
    }
  })
}
