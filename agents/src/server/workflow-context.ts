/**
 * Builds a structured context message describing the current workflow state
 * for the Deep Build orchestrator.
 *
 * Injected after history on every turn so the orchestrator always sees its
 * current step plan, north star goals, and progress without needing to call
 * `workflow({ operation: "get_state" })` explicitly. This guarantees state
 * visibility even if the model forgets the tool call.
 *
 * Only injected when the active agent is `deep-build`.
 */

import { readWorkflowState, computeNextActions } from '../workflow/workflow-store.js'
import { resolveBlockedGates, resolveInteractiveSteps } from '../workflow/workflow-gate-resolver.js'
import type { WorkflowState, WorkflowStep } from '../workflow/types.js'
import { logger } from '../logging/index.js'
import { readDoc } from '../reference/reference-service.js'

export interface WorkflowContextMessage {
  role: 'user'
  content: string
  insertionOrder: 'after_history'
  cachePoint?: { type: 'ephemeral' }
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function extractInjectBlock(content: string): string | null {
  const startMarker: string = '<!-- inject-start -->'
  const endMarker: string = '<!-- inject-end -->'
  const startIdx: number = content.indexOf(startMarker)
  const endIdx: number = content.indexOf(endMarker)
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null
  return content.substring(startIdx + startMarker.length, endIdx).trim()
}

async function loadArchetypeGuidance(archetype: string): Promise<string | null> {
  try {
    const content: string = await readDoc(`archetypes/${archetype}.md`, 'deep-build')
    return extractInjectBlock(content)
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error)
    logger.warn('workflow_context.archetype_guidance_failed', { archetype, error: message })
    return null
  }
}

function formatStepXml(step: WorkflowStep): string {
  const attrs: string[] = [
    `id="${escapeXmlAttr(step.id)}"`,
    `status="${step.status}"`,
    `type="${step.type}"`,
  ]
  if (step.dependsOn.length > 0) attrs.push(`deps="${escapeXmlAttr(step.dependsOn.join(','))}"`)
  if (step.assignedBuilder) attrs.push(`builder="${escapeXmlAttr(step.assignedBuilder)}"`)
  if (step.commitHash) attrs.push(`commit="${escapeXmlAttr(step.commitHash.substring(0, 7))}"`)
  if (step.gate?.satisfaction) attrs.push('gate_satisfied="true"')
  const title: string = escapeXmlText(step.title.substring(0, 200))
  return `  <step ${attrs.join(' ')}>${title}</step>`
}

export async function buildWorkflowContextMessage(
  appId?: string
): Promise<WorkflowContextMessage | null> {
  if (!appId) return null

  try {
    await resolveBlockedGates(appId)
    await resolveInteractiveSteps(appId)

    const state: WorkflowState | null = await readWorkflowState(appId)
    if (!state) return null

    const eligible: WorkflowStep[] = computeNextActions(state)
    const doneCount: number = state.steps.filter((s: WorkflowStep) => s.status === 'done').length
    const totalCount: number = state.steps.length

    const lines: string[] = [
      '## Workflow State',
      '',
      `Archetype: ${state.archetype} · Progress: ${doneCount}/${totalCount} steps done`,
      '',
      `**North Star:** ${state.northStar.goals.join('; ')} — for ${state.northStar.audience} (voice: ${state.northStar.voice})`,
      '',
      '<workflow_steps>',
      ...state.steps.map(formatStepXml),
      '</workflow_steps>',
    ]

    if (eligible.length > 0) {
      lines.push('')
      lines.push(`<next_eligible>${eligible.map((s: WorkflowStep) => s.id).join(', ')}</next_eligible>`)
    }

    const guidance: string | null = await loadArchetypeGuidance(state.archetype)
    if (guidance) {
      lines.push('')
      lines.push(`<archetype_guidance type="${escapeXmlAttr(state.archetype)}">`)
      lines.push(escapeXmlText(guidance))
      lines.push('</archetype_guidance>')
    }

    return {
      role: 'user',
      content: lines.join('\n'),
      insertionOrder: 'after_history',
    }
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error)
    logger.warn('workflow_context.build_failed', { appId, error: message })
    return null
  }
}
