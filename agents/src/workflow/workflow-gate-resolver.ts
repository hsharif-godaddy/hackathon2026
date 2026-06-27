/**
 * Auto-resolves blocked gate steps and completed interactive steps at context-build time.
 *
 * Gates: When the user responds to an askQuestion that blocked a gate, this module
 * detects the blocked gate and marks it done — the gate's purpose (pause for
 * user input) has been fulfilled by the user sending a new message.
 *
 * Interactive steps: When an interactive session completes (child agent calls
 * returnToParent), the orchestrator resumes on the next turn. At context-build
 * time we detect in_progress steps with interactive-* assignedBuilder and mark
 * them done — the interactive session has finished by definition if the
 * orchestrator is running again.
 */

import { readWorkflowState, writeWorkflowState, withWorkflowLock } from './workflow-store.js'
import { runVerifyChecks } from './verify-runner.js'
import type { WorkflowState, WorkflowStep } from './types.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'workflow-gate-resolver' })

/**
 * If there's a blocked gate step, mark it done (user responded).
 * Called before building the workflow context message on each turn.
 */
export async function resolveBlockedGates(appId: string): Promise<void> {
  await withWorkflowLock(appId, async (): Promise<void> => {
    const state: WorkflowState | null = await readWorkflowState(appId)
    if (!state) return

    let resolved: boolean = false

    for (const step of state.steps) {
      if (step.type === 'gate' && step.status === 'blocked') {
        step.status = 'done'
        if (!step.gate) {
          step.gate = { prompt: '' }
        }
        step.gate.satisfaction = {
          satisfiedBy: 'user_answer',
          reference: 'auto-resolved: user responded after askQuestion',
          recordedAt: new Date().toISOString(),
        }
        logger.info('workflow_gate_resolver.auto_resolved', { appId, stepId: step.id })
        resolved = true
        break
      }
    }

    if (resolved) {
      await writeWorkflowState(appId, state)
    }
  })
}

/**
 * Auto-complete interactive steps whose sessions have ended.
 *
 * When the orchestrator's turn begins after an interactive session (child called
 * returnToParent → handoff → orchestrator resumes), any in_progress step with
 * an `interactive-*` assignedBuilder is complete. We run verification and mark
 * done/failed accordingly.
 *
 * Called alongside resolveBlockedGates before building the workflow context message.
 */
export async function resolveInteractiveSteps(appId: string): Promise<void> {
  await withWorkflowLock(appId, async (): Promise<void> => {
    const state: WorkflowState | null = await readWorkflowState(appId)
    if (!state) return

    let changed: boolean = false

    for (const step of state.steps) {
      if (step.status !== 'in_progress') continue
      if (!step.assignedBuilder?.startsWith('interactive-')) continue

      const verifyResult = await runVerifyChecks(appId, step.verify, step.ownedFiles)
      if (verifyResult.passed) {
        step.status = 'done'
        logger.info('workflow_gate_resolver.interactive_completed', { appId, stepId: step.id, agent: step.assignedBuilder })
      } else {
        step.status = 'failed'
        step.notes = `Verification failed: ${verifyResult.failures.join('; ')}`
        logger.warn('workflow_gate_resolver.interactive_failed', { appId, stepId: step.id, failures: verifyResult.failures })
      }
      changed = true
    }

    if (changed) {
      await writeWorkflowState(appId, state)
    }
  })
}
