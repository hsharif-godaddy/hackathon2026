import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { Logger } from '../../logging/index.js'
import {
  readWorkflowState,
  writeWorkflowState,
  computeNextActions,
  validateOwnedFilesDisjoint,
  withWorkflowLock,
} from '../../workflow/workflow-store.js'
import type { WorkflowState, WorkflowStep } from '../../workflow/types.js'
import { runVerifyChecks } from '../../workflow/verify-runner.js'
import { createForWorkspace } from '../../workspace/index.js'
import { GitUtils } from '../../utils/git.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

const logger = Logger.create({ component: 'workflow-tool' })

const VerifyCheckSchema = z.object({
  kind: z.enum(['files_exist', 'tsc', 'route_renders', 'test', 'manual']),
  spec: z.string(),
})

const StepInputSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(['auto', 'gate', 'judgment']),
  dependsOn: z.array(z.string()),
  ownedFiles: z.array(z.string()),
  verify: z.array(VerifyCheckSchema),
  gate: z.object({
    prompt: z.string(),
  }).optional(),
})

const OperationSchema = z.object({
  operation: z.enum([
    'init', 'get_state', 'next_actions', 'assign', 'complete_step',
    'satisfy_gate', 'skip_step', 'fail_step', 'add_steps', 'update_step',
  ]).describe('The workflow operation to perform'),
  stepId: z.string().optional().describe('Step ID (required for assign, complete_step, satisfy_gate, skip_step, fail_step, update_step)'),
  builder: z.string().optional().describe('Builder identifier (required for assign)'),
  archetype: z.enum(['site', 'app', 'game', 'custom']).optional().describe('Project archetype (required for init)'),
  northStar: z.object({
    goals: z.array(z.string()),
    audience: z.string(),
    voice: z.string(),
  }).optional().describe('Project goals (required for init)'),
  steps: z.array(StepInputSchema).optional().describe('Steps array (required for init and add_steps)'),
  satisfiedBy: z.enum(['user_approval', 'user_answer', 'attachment']).optional().describe('How the gate was satisfied (required for satisfy_gate)'),
  reference: z.string().optional().describe('Reference to satisfaction source (required for satisfy_gate)'),
  reason: z.string().optional().describe('Reason for skipping or failing (required for skip_step, fail_step)'),
  title: z.string().optional().describe('New title (for update_step)'),
  ownedFiles: z.array(z.string()).optional().describe('New ownedFiles (for update_step)'),
  notes: z.string().optional().describe('Notes (for update_step)'),
})

type OperationInput = z.infer<typeof OperationSchema>

function findStep(state: WorkflowState, stepId: string): WorkflowStep | undefined {
  return state.steps.find((s: WorkflowStep) => s.id === stepId)
}

export const workflowAITool: Tool = createTool(
  'Manage the workflow step plan. Most state transitions happen automatically (assign on runAgent, complete on awaitAgents, gate resolve on user response). You only need to call: init (create the step plan), skip_step (explicitly skip a step with reason), add_steps (extend the plan mid-build), update_step (modify step metadata). Other operations (get_state, next_actions, assign, complete_step, satisfy_gate, fail_step) exist but are handled automatically — call them only if you need to override the automatic behavior.',
  OperationSchema,
  async (input: OperationInput, context: unknown): Promise<string> => {
    const appId: string | undefined = (context as Record<string, Record<string, unknown>> | undefined)?.metadata?.appId as string | undefined
    if (!appId) {
      return 'No app ID available in context'
    }

    return withWorkflowLock(appId, async (): Promise<string> => {

    if (input.operation === 'init') {
      if (!input.steps || !input.archetype || !input.northStar) {
        return 'init requires: archetype, northStar, steps'
      }
      const existing: WorkflowState | null = await readWorkflowState(appId)
      if (existing !== null) {
        return 'Workflow already initialized'
      }

      const steps: WorkflowStep[] = input.steps.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        status: 'pending',
        dependsOn: s.dependsOn,
        ownedFiles: s.ownedFiles,
        verify: s.verify,
        gate: s.gate,
      }))

      const ids: string[] = steps.map((s: WorkflowStep) => s.id)
      const dupeIds: string[] = ids.filter((id: string, i: number) => ids.indexOf(id) !== i)
      if (dupeIds.length > 0) {
        return `Duplicate step ids: ${[...new Set(dupeIds)].join(', ')}`
      }

      const disjointErrors: string[] = validateOwnedFilesDisjoint(steps)
      if (disjointErrors.length > 0) {
        return `ownedFiles conflict: ${disjointErrors.join('; ')}`
      }

      const now: string = new Date().toISOString()
      const state: WorkflowState = {
        schemaVersion: 1,
        appId,
        archetype: input.archetype,
        northStar: input.northStar,
        steps,
        createdAt: now,
        updatedAt: now,
      }

      const ok: boolean = await writeWorkflowState(appId, state)
      if (!ok) {
        logger.error('workflow_tool.init.write_failed', { appId })
        return 'Failed to write workflow state'
      }

      return JSON.stringify({ initialized: true, stepCount: steps.length, archetype: input.archetype })
    }

    if (input.operation === 'get_state') {
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      return JSON.stringify(state)
    }

    if (input.operation === 'next_actions') {
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const eligible: WorkflowStep[] = computeNextActions(state)
      return JSON.stringify(eligible)
    }

    if (input.operation === 'assign') {
      if (!input.stepId || !input.builder) {
        return 'assign requires: stepId, builder'
      }
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const step: WorkflowStep | undefined = findStep(state, input.stepId)
      if (step === undefined) {
        return `Step not found: ${input.stepId}`
      }
      if (step.status !== 'pending') {
        return `Step "${input.stepId}" is not pending (status: ${step.status})`
      }
      step.status = 'in_progress'
      step.assignedBuilder = input.builder
      const ok: boolean = await writeWorkflowState(appId, state)
      if (!ok) {
        logger.error('workflow_tool.assign.write_failed', { appId, stepId: input.stepId })
        return 'Failed to write workflow state'
      }
      return `Step "${input.stepId}" assigned to ${input.builder}`
    }

    if (input.operation === 'complete_step') {
      if (!input.stepId) {
        return 'complete_step requires: stepId'
      }
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const step: WorkflowStep | undefined = findStep(state, input.stepId)
      if (step === undefined) {
        return `Step not found: ${input.stepId}`
      }
      if (step.type === 'gate' && step.gate?.satisfaction === undefined) {
        return 'Cannot complete gate step: user input required. Call satisfy_gate first.'
      }

      // Run verification checks
      const verifyResult = await runVerifyChecks(appId, step.verify, step.ownedFiles)
      if (!verifyResult.passed) {
        step.status = 'failed'
        step.notes = `Verification failed: ${verifyResult.failures.join('; ')}`
        const failOk: boolean = await writeWorkflowState(appId, state)
        if (!failOk) logger.error('workflow_tool.complete_step.fail_write_failed', { appId, stepId: step.id })
        return `Step "${step.id}" verification failed: ${verifyResult.failures.join('; ')}`
      }

      // Update state BEFORE commit (so workflow.json in the commit reflects done status)
      step.status = 'done'

      const workspace = createForWorkspace(appId, 'preview')
      if (workspace) {
        try {
          const appRepository: AppRepository = new AppRepository()
          const app = appRepository.findById(appId)
          const appPath: string = app?.path ?? '/app'
          const gitUtils: GitUtils = new GitUtils(workspace.tasks)
          const filesToCommit: string[] = [...step.ownedFiles, 'docs/workflow.json']

          const writeOk: boolean = await writeWorkflowState(appId, state)
          if (!writeOk) {
            logger.error('workflow_tool.complete_step.write_failed', { appId, stepId: step.id })
            return 'Failed to write workflow state'
          }

          // Stage and commit only this step's files
          await gitUtils.addFiles(appPath, filesToCommit)
          const commitResult = await gitUtils.commitFiles(appPath, `Complete: ${step.title}`, filesToCommit)

          if (commitResult.success) {
            const commitHash: string = await gitUtils.getCurrentCommit(appPath)
            step.commitHash = commitHash
            const hashOk: boolean = await writeWorkflowState(appId, state)
            if (!hashOk) logger.warn('workflow_tool.complete_step.hash_write_failed', { appId, stepId: step.id })
          } else {
            logger.warn('workflow.complete_step.commit_failed', { appId, stepId: step.id, error: commitResult.stderr })
          }
        } catch (error: unknown) {
          const message: string = error instanceof Error ? error.message : String(error)
          logger.warn('workflow.complete_step.git_error', { appId, stepId: step.id, error: message })
        }
      } else {
        // No workspace — just write state without git commit
        const ok: boolean = await writeWorkflowState(appId, state)
        if (!ok) {
          logger.error('workflow_tool.complete_step.write_failed', { appId, stepId: input.stepId })
          return 'Failed to write workflow state'
        }
      }

      return `Step "${step.id}" completed${step.commitHash ? ` (commit: ${step.commitHash.substring(0, 7)})` : ''}.`
    }

    if (input.operation === 'satisfy_gate') {
      if (!input.stepId || !input.satisfiedBy || !input.reference) {
        return 'satisfy_gate requires: stepId, satisfiedBy, reference'
      }
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const step: WorkflowStep | undefined = findStep(state, input.stepId)
      if (step === undefined) {
        return `Step not found: ${input.stepId}`
      }
      if (step.type !== 'gate') {
        return `Step "${input.stepId}" is not a gate step`
      }
      if (step.gate === undefined) {
        return `Step "${input.stepId}" has no gate configuration`
      }
      step.gate.satisfaction = {
        satisfiedBy: input.satisfiedBy,
        reference: input.reference,
        recordedAt: new Date().toISOString(),
      }
      if (step.status === 'blocked') {
        step.status = 'pending'
      }
      const ok: boolean = await writeWorkflowState(appId, state)
      if (!ok) {
        logger.error('workflow_tool.satisfy_gate.write_failed', { appId, stepId: input.stepId })
        return 'Failed to write workflow state'
      }
      return `Gate satisfied for step "${input.stepId}" via ${input.satisfiedBy}`
    }

    if (input.operation === 'skip_step') {
      if (!input.stepId || !input.reason) {
        return 'skip_step requires: stepId, reason'
      }
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const step: WorkflowStep | undefined = findStep(state, input.stepId)
      if (step === undefined) {
        return `Step not found: ${input.stepId}`
      }
      step.status = 'skipped'
      step.notes = input.reason
      const ok: boolean = await writeWorkflowState(appId, state)
      if (!ok) {
        logger.error('workflow_tool.skip_step.write_failed', { appId, stepId: input.stepId })
        return 'Failed to write workflow state'
      }
      return `Step "${input.stepId}" skipped: ${input.reason}`
    }

    if (input.operation === 'fail_step') {
      if (!input.stepId || !input.reason) {
        return 'fail_step requires: stepId, reason'
      }
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const step: WorkflowStep | undefined = findStep(state, input.stepId)
      if (step === undefined) {
        return `Step not found: ${input.stepId}`
      }
      step.status = 'failed'
      step.notes = input.reason
      const ok: boolean = await writeWorkflowState(appId, state)
      if (!ok) {
        logger.error('workflow_tool.fail_step.write_failed', { appId, stepId: input.stepId })
        return 'Failed to write workflow state'
      }
      return `Step "${input.stepId}" failed: ${input.reason}`
    }

    if (input.operation === 'add_steps') {
      if (!input.steps) {
        return 'add_steps requires: steps'
      }
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const newSteps: WorkflowStep[] = input.steps.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        status: 'pending',
        dependsOn: s.dependsOn,
        ownedFiles: s.ownedFiles,
        verify: s.verify,
        gate: s.gate,
      }))

      const existingIds: Set<string> = new Set(state.steps.map((s: WorkflowStep) => s.id))
      const newIds: string[] = newSteps.map((s: WorkflowStep) => s.id)
      const dupeIds: string[] = newIds.filter((id: string) => existingIds.has(id))
      const internalDupes: string[] = newIds.filter((id: string, i: number) => newIds.indexOf(id) !== i)
      const allDupes: string[] = [...new Set([...dupeIds, ...internalDupes])]
      if (allDupes.length > 0) {
        return `Duplicate step ids: ${allDupes.join(', ')}`
      }

      const activeSteps: WorkflowStep[] = state.steps.filter(
        (s: WorkflowStep) => s.status !== 'done' && s.status !== 'skipped',
      )
      const disjointErrors: string[] = validateOwnedFilesDisjoint([...activeSteps, ...newSteps])
      if (disjointErrors.length > 0) {
        return `ownedFiles conflict: ${disjointErrors.join('; ')}`
      }

      state.steps = [...state.steps, ...newSteps]
      const ok: boolean = await writeWorkflowState(appId, state)
      if (!ok) {
        logger.error('workflow_tool.add_steps.write_failed', { appId })
        return 'Failed to write workflow state'
      }
      return JSON.stringify({ added: newSteps.length, totalSteps: state.steps.length })
    }

    if (input.operation === 'update_step') {
      if (!input.stepId) {
        return 'update_step requires: stepId'
      }
      const state: WorkflowState | null = await readWorkflowState(appId)
      if (state === null) {
        return 'No workflow state found. Call init first.'
      }
      const step: WorkflowStep | undefined = findStep(state, input.stepId)
      if (step === undefined) {
        return `Step not found: ${input.stepId}`
      }
      if (input.title !== undefined) {
        step.title = input.title
      }
      if (input.ownedFiles !== undefined) {
        step.ownedFiles = input.ownedFiles
      }
      if (input.notes !== undefined) {
        step.notes = input.notes
      }
      const ok: boolean = await writeWorkflowState(appId, state)
      if (!ok) {
        logger.error('workflow_tool.update_step.write_failed', { appId, stepId: input.stepId })
        return 'Failed to write workflow state'
      }
      return `Step "${input.stepId}" updated`
    }

    return 'Unknown operation'
    }) // withWorkflowLock
  },
)
