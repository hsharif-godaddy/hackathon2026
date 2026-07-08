import { z } from 'zod'

import { validateStepDag } from '../../workflow/step-validation.js'

/**
 * Pure Zod schemas for the workflow step DAG. Deliberately free of the workflow
 * tool's executable dependencies (DB/AppRepository, workspace, git) so a consumer
 * that only needs the *shape* — e.g. run-agent requesting workflow-init's
 * structured return — can import them without pulling native better-sqlite3 into
 * its module graph (and its tests' import-time cost).
 */

export const VerifyCheckSchema = z.object({
  kind: z.enum(['files_exist', 'tsc', 'route_renders', 'test', 'manual']),
  spec: z.string(),
})

export const StepInputSchema = z.object({
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

/**
 * The workflow-init sub-agent's structured return — the full step DAG it produces.
 * Shared so run-agent can request it as that agent's `returnFormat` schema while the
 * workflow tool's `init` operation validates the same shape.
 */
export const WorkflowInitResultSchema = z.object({
  archetype: z.enum(['site', 'app', 'game', 'custom']),
  northStar: z.object({
    goals: z.array(z.string()),
    audience: z.string(),
    voice: z.string(),
  }),
  steps: z.array(StepInputSchema),
}).superRefine((value, ctx) => {
  // Reject a semantically-invalid DAG at the returnResult boundary so the worker
  // retries within its step budget, rather than emitting a shape-valid payload
  // that workflow(init) then rejects with an error string the orchestrator may
  // trust as success. These checks are a superset of init's own static checks.
  for (const message of validateStepDag(value.steps)) {
    ctx.addIssue({ code: 'custom', message, path: ['steps'] })
  }
})
