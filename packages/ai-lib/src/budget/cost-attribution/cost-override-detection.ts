/**
 * Cost Override Detection
 *
 * Detects product-funded actions (publish, domain) by matching tool names.
 * Any call to these tools triggers GoDaddy cost attribution.
 *
 * Key insight: ExecutionStep.response.headers['x-correlation-id'] === SessionItem.callRequestId
 * The step containing a tool-call IS the LLM request that decided to call the tool.
 */

import { createLogger } from '@airo/ai-common'
import {
  CostOverrideAction,
  INFRASTRUCTURE_TOOLS,
  StepContentType,
  type CostOverrideActionType,
  type ExecutionStep,
} from './types.js'

const logger = createLogger('cost-override-detection')

/**
 * Tools allowed to stay in the cost override flow.
 * Infrastructure tools + publish/domain-specific tools stay in the flow.
 * Any other tool call (including loading other skills) exits the flow.
 *
 * Note: We use fully-qualified skill-namespaced names (e.g., 'publishing__status')
 * rather than bare names to avoid matching unrelated tools. A bare 'status' would
 * incorrectly match 'database__status' or 'commerce__status'.
 */
const COST_OVERRIDE_FLOW_TOOLS = new Set([
  ...INFRASTRUCTURE_TOOLS,
  // Publish flow tools (skill-namespaced to avoid matching unrelated status tools)
  'publish',
  'publishing__publish',
  'publishing__status',
  // Domain flow tools
  'domainpurchase',
  'custom-domain__domainpurchase',
])

/**
 * Maps skill names to their corresponding cost override actions.
 * Used for retroactive promotion of skill-loading steps.
 */
const SKILL_TO_ACTION: ReadonlyMap<string, CostOverrideActionType> = new Map([
  ['publishing', CostOverrideAction.Publish],
  ['custom-domain', CostOverrideAction.Domain],
])

/**
 * Check if a tool is allowed to stay in the cost override flow.
 * Only matches exact tool names in the allowlist (no base-name matching)
 * to avoid false positives like 'database__status' staying in publish flow.
 *
 * @param toolName - The tool name to check
 * @returns Whether this step should stay in the cost override flow
 */
function isAllowedInCostOverrideFlow(toolName: string | undefined): boolean {
  if (!toolName) return true // Text-only steps stay in flow
  return COST_OVERRIDE_FLOW_TOOLS.has(toolName.toLowerCase())
}

/**
 * Check if a tool name is the skill-loading tool.
 */
function isSkillTool(toolName: string | undefined): boolean {
  if (!toolName) return false
  return toolName.toLowerCase() === 'skill'
}

/**
 * Extract skill names from a step's tool results.
 * The skill tool returns results like { skill: "custom-domain" } or { loaded: "publishing" }.
 */
function extractLoadedSkills(step: ExecutionStep): string[] {
  const skills: string[] = []
  for (const item of step.content) {
    if (item.type === StepContentType.ToolResult && isSkillTool(item.toolName)) {
      const output = item.output ?? item.result
      if (output && typeof output === 'object') {
        const obj = output as Record<string, unknown>
        // Check common field names for skill name
        const skillName = obj.skill ?? obj.loaded ?? obj.name
        if (typeof skillName === 'string') {
          skills.push(skillName.toLowerCase())
        } else {
          logger.debug('cost_override.skill_load.unrecognized_output', {
            toolName: item.toolName,
            outputKeys: Object.keys(obj),
            reason: 'skill name not found in expected fields (skill, loaded, name)',
          })
        }
      } else if (output !== undefined) {
        logger.debug('cost_override.skill_load.unexpected_output_type', {
          toolName: item.toolName,
          outputType: typeof output,
          reason: 'expected object output from skill tool',
        })
      }
    }
  }
  return skills
}

/**
 * Check if a step loaded a skill that corresponds to the given action.
 * Used for retroactive promotion of skill-loading steps.
 */
function stepLoadedSkillForAction(step: ExecutionStep, action: CostOverrideActionType): boolean {
  const loadedSkills = extractLoadedSkills(step)
  for (const skillName of loadedSkills) {
    const skillAction = SKILL_TO_ACTION.get(skillName)
    if (skillAction === action) {
      return true
    }
  }
  return false
}

/**
 * Product-funded tools: tool name pattern -> cost override action
 * Tool names may be skill-namespaced (e.g., "publishing__publish")
 */
export const COST_OVERRIDE_TOOLS: ReadonlyMap<string, CostOverrideActionType> = new Map([
  ['publish', CostOverrideAction.Publish],
  ['domainpurchase', CostOverrideAction.Domain],
])

/**
 * Result of analyzing execution steps for cost override actions.
 * Matches CostOverrideData interface for direct assignment.
 */
export interface CostOverrideResult {
  /** Correlation IDs for the cost override action calls themselves */
  actionCallIds: Set<string>
  /** Correlation IDs for follow-up steps after cost override actions */
  followUpCallIds: Set<string>
  /** Map of callId to action type (includes both action calls and follow-ups) */
  actions: Map<string, CostOverrideActionType>
}

/**
 * Check if a tool name triggers a cost override.
 * Handles skill-namespaced tools (e.g., "publishing__publish" matches "publish")
 *
 * @param toolName - The tool name from the step content
 * @returns The cost override action if matched, null otherwise
 */
export function getCostOverrideAction(toolName: string | undefined): CostOverrideActionType | null {
  if (!toolName) return null

  const lower = toolName.toLowerCase()

  // Direct match
  const direct = COST_OVERRIDE_TOOLS.get(lower)
  if (direct) return direct

  // Skill-namespaced match (e.g., "publishing__publish" -> "publish")
  const skillSeparator = '__'
  if (lower.includes(skillSeparator)) {
    const baseName = lower.split(skillSeparator).pop()
    if (baseName) {
      const namespaced = COST_OVERRIDE_TOOLS.get(baseName)
      if (namespaced) return namespaced
    }
  }

  return null
}

/**
 * Check if a step contains a cost override tool call or result.
 * Matches both the decision (tool-call) and execution (tool-result) steps.
 *
 * @param step - Execution step to check
 * @returns Action type if step contains a cost override tool, null otherwise
 */
export function getCostOverrideSignal(step: ExecutionStep): { action: CostOverrideActionType; toolName: string } | null {
  for (const item of step.content) {
    // Check both tool-call (decision) and tool-result (execution)
    if (item.type === StepContentType.ToolCall || item.type === StepContentType.ToolResult) {
      const action = getCostOverrideAction(item.toolName)
      if (action) {
        return { action, toolName: item.toolName ?? '' }
      }
    }
  }
  return null
}

/** Tracked info about a skipped prep step for potential retroactive promotion */
interface SkippedPrepStep {
  correlationId: string
  stepIndex: number
  step: ExecutionStep
  toolNames: string[]
}

/**
 * Analyze execution steps for cost override actions.
 *
 * Returns correlation IDs for:
 * 1. Steps containing cost override tool calls/results (decision + execution)
 * 2. Text-only follow-up steps (completion message to user)
 * 3. Skill-loading steps that loaded the skill for a detected action (retroactive promotion)
 *
 * Text-only follow-ups are captured because "publish my app" should attribute
 * the entire publish flow (decision → execution → success message) to GoDaddy.
 * But if a tool call is encountered, we exit the flow since it could be
 * unrelated work (e.g., "publish my app and build an about page").
 *
 * Retroactive skill promotion: When a cost override action is detected, we look back
 * at skipped prep steps to see if any loaded the corresponding skill. If so, those
 * steps are promoted to follow-ups since they're part of the action flow.
 *
 * @param steps - Array of execution steps from onFinish
 * @returns CostOverrideResult with correlation IDs for attribution
 */
export function analyzeCostOverrideActions(steps: ExecutionStep[]): CostOverrideResult {
  const actionCallIds = new Set<string>()
  const followUpCallIds = new Set<string>()
  const actions = new Map<string, CostOverrideActionType>()

  // Track steps before the first action (prep work like loading skills)
  const prepCallIds: string[] = []
  // Track skipped prep steps for potential retroactive promotion
  const skippedPrepSteps: SkippedPrepStep[] = []

  let inCostOverrideFlow = false
  let foundFirstAction = false
  let currentFlowAction: CostOverrideActionType | null = null

  logger.info('cost_override.analysis.started', {
    totalSteps: steps.length,
  })

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex]!
    const correlationId = step.response?.headers?.['x-correlation-id']

    if (!correlationId) {
      logger.debug('cost_override.step.skipped', {
        stepIndex,
        reason: 'no_correlation_id',
      })
      continue
    }

    const signal = getCostOverrideSignal(step)
    if (signal) {
      inCostOverrideFlow = true
      currentFlowAction = signal.action
      actionCallIds.add(correlationId)
      actions.set(correlationId, signal.action)

      // On first action, promote prep steps and map them to this action
      if (!foundFirstAction) {
        foundFirstAction = true
        const prepStepsPromotedCount = prepCallIds.length

        // Promote allowed prep steps (text-only, suggestedResponse, etc.)
        for (const prepCallId of prepCallIds) {
          followUpCallIds.add(prepCallId)
          actions.set(prepCallId, signal.action) // Map follow-up to its action
          logger.info('cost_override.prep.captured', {
            correlationId: prepCallId,
            action: signal.action,
            reason: 'prep_for_action',
          })
        }

        // Retroactive promotion: check skipped prep steps for skill loading
        // that matches this action (e.g., 'skill' loading 'custom-domain' for domain action)
        for (const skipped of skippedPrepSteps) {
          if (stepLoadedSkillForAction(skipped.step, signal.action)) {
            followUpCallIds.add(skipped.correlationId)
            actions.set(skipped.correlationId, signal.action) // Map follow-up to its action
            logger.info('cost_override.skill_load.retroactive_promotion', {
              correlationId: skipped.correlationId,
              stepIndex: skipped.stepIndex,
              action: signal.action,
              toolNames: skipped.toolNames,
              reason: 'skill_loaded_for_action',
            })
          }
        }

        logger.info('cost_override.action.detected', {
          stepIndex,
          correlationId,
          action: signal.action,
          toolName: signal.toolName,
          flowState: 'entered',
          prepStepsPromoted: prepStepsPromotedCount,
        })
      } else {
        logger.info('cost_override.action.detected', {
          stepIndex,
          correlationId,
          action: signal.action,
          toolName: signal.toolName,
          flowState: 'entered',
          prepStepsPromoted: 0,
        })
      }
    } else if (!foundFirstAction) {
      // Before any action - track as potential prep work ONLY if all tools are allowed in flow
      // Other tools before the action represent customer's own work, not prep for the action
      const toolItems = step.content.filter(c =>
        c.type === StepContentType.ToolCall || c.type === StepContentType.ToolResult
      )
      const allToolsAllowed = toolItems.every(c => isAllowedInCostOverrideFlow(c.toolName))
      const toolNames = toolItems.map(c => c.toolName).filter((n): n is string => Boolean(n))

      if (allToolsAllowed) {
        prepCallIds.push(correlationId)
        logger.debug('cost_override.prep.tracked', {
          stepIndex,
          correlationId,
          reason: 'before_first_action',
          toolNames,
        })
      } else {
        // Track skipped steps for potential retroactive promotion
        // (in case they loaded a skill that matches a later action)
        skippedPrepSteps.push({ correlationId, stepIndex, step, toolNames })
        logger.debug('cost_override.prep.skipped', {
          stepIndex,
          correlationId,
          reason: 'non_flow_tool_before_action',
          toolNames,
        })
      }
    } else if (inCostOverrideFlow) {
      // After an action - check if this is a follow-up or work that exits the flow
      const toolItems = step.content.filter(c =>
        c.type === StepContentType.ToolCall || c.type === StepContentType.ToolResult
      )
      const isTextOnly = toolItems.length === 0
      const allToolsAllowed = toolItems.every(c => isAllowedInCostOverrideFlow(c.toolName))

      if (!allToolsAllowed) {
        // Tool not in allowlist - exit the flow
        const toolNames = toolItems.map(c => c.toolName).filter(Boolean)
        const exitingTools = toolItems.filter(c => !isAllowedInCostOverrideFlow(c.toolName)).map(c => c.toolName)

        logger.info('cost_override.flow.exited', {
          stepIndex,
          correlationId,
          previousAction: currentFlowAction,
          reason: 'non_flow_tool_encountered',
          toolNames,
          exitingTools: exitingTools.length > 0 ? exitingTools : undefined,
        })

        inCostOverrideFlow = false
        currentFlowAction = null
      } else {
        // Allowed tools (suggestedResponse, status, etc.) or text-only - stay in flow
        followUpCallIds.add(correlationId)
        if (currentFlowAction) {
          actions.set(correlationId, currentFlowAction) // Map follow-up to its action
        }
        const toolNames = toolItems.map(c => c.toolName).filter(Boolean)

        logger.info('cost_override.followup.captured', {
          stepIndex,
          correlationId,
          action: currentFlowAction,
          reason: isTextOnly ? 'text_only_response' : 'flow_tool_call',
          toolNames: toolNames.length > 0 ? toolNames : undefined,
          flowState: 'in_flow',
        })
      }
    }
  }

  logger.info('cost_override.analysis.completed', {
    totalSteps: steps.length,
    actionCallIdsCount: actionCallIds.size,
    actionCallIds: Array.from(actionCallIds),
    followUpCallIdsCount: followUpCallIds.size,
    followUpCallIds: Array.from(followUpCallIds),
    prepStepsCount: foundFirstAction ? prepCallIds.length : 0,
    actionsDetected: Array.from(actions.entries()).map(([callId, action]) => ({
      callId,
      action,
    })),
  })

  return { actionCallIds, followUpCallIds, actions }
}
