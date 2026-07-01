/**
 * Cost Attribution Module
 *
 * Orchestrates failure extraction, pattern detection, and causal chain detection
 * to produce multi-label cost reports that fairly attribute costs between
 * customer and GoDaddy.
 *
 * Key principle: Zero custom tracking during execution. All analysis is post-hoc
 * using the SDK's built-in steps[] data.
 */

import { createLogger } from '@airo/ai-common'
import {
  ReportLabel,
  PatternType,
  StepContentType,
  CostOverrideAction,
  Payer,
  AttributionReason,
  InfrastructureToolType,
  type AttributionReasonType,
  type ExecutionStep,
  type ExecutionData,
  type AttributionResult,
  type AttributionContext,
  type ItemAttribution,
  type PatternResult,
  type CausalChain,
  type CostOverrideData,
  type InfrastructureToolTypeName,
  type PatternDetectionResult,
} from './types.js'
import { extractFailedCallIds, extractFailedTargets } from './failure-extraction.js'
import { detectHighConfidencePatterns } from './pattern-detection.js'
import { detectCausalChains, getCausalChainCallIds } from './causal-chain-detection.js'
import { analyzeCostOverrideActions } from './cost-override-detection.js'
import { extractInfrastructureCalls } from './infrastructure-detection.js'
import type { ReportItemRequest } from '../report-types.js'
import type { SessionItem } from '@airo/shared/budget'

const logger = createLogger('cost-attribution')

/**
 * All causal chain attribution reasons for filtering/counting.
 * Using explicit array instead of string matching for maintainability.
 */
const CAUSAL_CHAIN_REASONS: AttributionReasonType[] = [
  AttributionReason.CausalChain,
  AttributionReason.CausalChainTrigger,
  AttributionReason.CausalChainError,
  AttributionReason.CausalChainFix,
]


/**
 * Analyze SDK execution steps to extract failure data.
 * This should be called in onFinish and stored for later use in onBudgetReport.
 *
 * @param steps - Array of SDK execution steps from onFinish
 * @returns ExecutionData containing all detected failures and patterns
 */
export function analyzeExecution(steps: ExecutionStep[]): ExecutionData {
  const failedCallIds = extractFailedCallIds(steps)
  const { patterns, counts: patternCounts }: PatternDetectionResult = detectHighConfidencePatterns(steps)
  const causalChains = detectCausalChains(steps)
  const failedTargets = extractFailedTargets(steps)
  const costOverride = analyzeCostOverrideActions(steps)
  const hadFailures =
    failedCallIds.size > 0 || patterns.length > 0 || causalChains.length > 0

  // No value delivered: agent ran but produced nothing useful
  // - hasOutput: agent communicated (asking questions, explaining, etc.) = value
  // - hasSuccessfulToolCalls: any tool completed without error = value
  //   This includes read/search tools (Read, Grep) returning content — informational
  //   work like reading files or searching counts as value delivered.
  // If none of these, agent burned tokens silently without engaging or working
  // Note: wasUserAborted should be checked by caller before calling analyzeExecution
  const hasOutput = steps.some(s =>
    s.content.some(c => c.type === StepContentType.Text && c.text?.trim())
  )
  // Check for any successful tool execution (includes read/search tools with results)
  const hasSuccessfulToolCalls = steps.some(s =>
    s.content.some(c => c.type === StepContentType.ToolResult)
  )
  // Value was delivered if agent communicated OR executed tools successfully
  const noValueDelivered = !hasOutput && !hasSuccessfulToolCalls

  return {
    failedCallIds,
    patterns,
    patternCounts,
    causalChains,
    failedTargets,
    hadFailures,
    totalSteps: steps.length,
    noValueDelivered,
    costOverride,
    infrastructureCalls: extractInfrastructureCalls(steps),
  }
}

// COST ATTRIBUTION

function addLabel(labels: ReportLabel[], label: ReportLabel): void {
  if (!labels.includes(label)) {
    labels.push(label)
  }
}

/**
 * Determine labels describing the session.
 * Returns contextual labels first, then labels with actual attributed costs.
 */
function determineLabels(
  patterns: PatternResult[],
  causalChains: CausalChain[],
  hasDirectFailures: boolean,
  costOverride: CostOverrideData,
  attributedLabels: Iterable<ReportLabel>
): ReportLabel[] {
  const labels: ReportLabel[] = []

  // Cost override labels (publish/domain tasks)
  if (costOverride.actions.size > 0) {
    const actions = Array.from(costOverride.actions.values())
    if (actions.includes(CostOverrideAction.Publish)) {
      addLabel(labels, ReportLabel.PublishTask)
    }
    if (actions.includes(CostOverrideAction.Domain)) {
      addLabel(labels, ReportLabel.DomainTask)
    }
  }

  // Failure/pattern labels - add all that apply
  if (patterns.length > 0) {
    const sorted = [...patterns].sort((a, b) => b.severity - a.severity)
    const top = sorted[0]
    if (top) addLabel(labels, patternTypeToLabel(top.type))
  }
  if (causalChains.length > 0) {
    addLabel(labels, ReportLabel.CausalChain)
  }
  if (hasDirectFailures) {
    addLabel(labels, ReportLabel.ToolFailure)
  }

  for (const label of attributedLabels) {
    addLabel(labels, label)
  }

  // Default to General if no labels
  if (labels.length === 0) {
    labels.push(ReportLabel.General)
  }

  return labels
}

/**
 * Map pattern type to report label.
 */
function patternTypeToLabel(patternType: string): ReportLabel {
  switch (patternType) {
    case PatternType.RepeatedReads:
      return ReportLabel.RepeatedReads
    case PatternType.RepeatedEdits:
      return ReportLabel.RepeatedEdits
    case PatternType.GrepSpiral:
      return ReportLabel.GrepSpiral
    case PatternType.TerminalFailures:
      return ReportLabel.TerminalFailures
    case PatternType.EditReadLoop:
      return ReportLabel.EditReadLoop
    case PatternType.ToolRetry:
      return ReportLabel.ToolRetry
    default:
      return ReportLabel.ToolFailure
  }
}

function infrastructureToolTypeToLabel(toolType: InfrastructureToolTypeName): ReportLabel {
  switch (toolType) {
    case InfrastructureToolType.TodoList:
      return ReportLabel.TodoListOverhead
    case InfrastructureToolType.SuggestedResponse:
      return ReportLabel.SuggestedResponseOverhead
    default: {
      const exhaustive: never = toolType
      return exhaustive
    }
  }
}

/**
 * Determine attribution for a single session item.
 */
function determineAttribution(
  callRequestId: string,
  cost: number,
  godaddyCallIds: Set<string>,
  patterns: PatternResult[],
  causalChains: CausalChain[],
  costOverride: CostOverrideData,
  infrastructureCalls: Map<string, InfrastructureToolTypeName>
): ItemAttribution {
  // Check if this call is in the GoDaddy set
  if (!godaddyCallIds.has(callRequestId)) {
    return {
      callRequestId,
      cost,
      payer: Payer.Customer,
      reason: AttributionReason.Success,
      label: ReportLabel.General,
    }
  }

  // Check cost override (publish/domain tools)
  if (costOverride.actionCallIds.has(callRequestId)) {
    const action = costOverride.actions.get(callRequestId)
    const label = action === CostOverrideAction.Publish ? ReportLabel.PublishTask : ReportLabel.DomainTask
    return {
      callRequestId,
      cost,
      payer: Payer.GoDaddy,
      reason: AttributionReason.CostOverrideAction,
      label,
    }
  }
  if (costOverride.followUpCallIds.has(callRequestId)) {
    // Follow-up gets its corresponding action's label (from actions map)
    const followUpAction = costOverride.actions.get(callRequestId)
    if (!followUpAction) {
      // Defensive: followUpCallIds and actions map should be in sync, but log if not
      logger.warn('cost_attribution.followup.missing_action', {
        callRequestId,
        reason: 'callId in followUpCallIds but not in actions map',
      })
    }
    // Default to PublishTask if action not found (shouldn't happen, but safe fallback)
    const label = followUpAction === CostOverrideAction.Domain ? ReportLabel.DomainTask : ReportLabel.PublishTask
    return {
      callRequestId,
      cost,
      payer: Payer.GoDaddy,
      reason: AttributionReason.CostOverrideFollowup,
      label,
    }
  }

  // Check infrastructure tools (suggestedResponse, todoList) before generic
  // failure patterns so retry/error labels do not hide agent overhead.
  const infrastructureToolType = infrastructureCalls.get(callRequestId)
  if (infrastructureToolType) {
    return {
      callRequestId,
      cost,
      payer: Payer.GoDaddy,
      reason: AttributionReason.InfrastructureOverhead,
      label: infrastructureToolTypeToLabel(infrastructureToolType),
    }
  }

  // Find which pattern this call belongs to
  for (const pattern of patterns) {
    if (pattern.callIds.includes(callRequestId)) {
      return {
        callRequestId,
        cost,
        payer: Payer.GoDaddy,
        reason: AttributionReason.PatternDetected,
        label: patternTypeToLabel(pattern.type),
        patternType: pattern.type,
        patternDetails: pattern.details,
      }
    }
  }

  // Check causal chains
  // Note: verificationCallId is intentionally NOT checked here.
  // Verification confirms the fix worked and delivers value to the customer,
  // so the customer pays for that step. See getCausalChainCallIds().
  for (const chain of causalChains) {
    if (
      chain.triggerCallId === callRequestId ||
      chain.errorCallId === callRequestId ||
      chain.fixCallIds.includes(callRequestId)
    ) {
      let reason: AttributionReasonType = AttributionReason.CausalChain
      if (chain.triggerCallId === callRequestId) reason = AttributionReason.CausalChainTrigger
      if (chain.errorCallId === callRequestId) reason = AttributionReason.CausalChainError
      if (chain.fixCallIds.includes(callRequestId)) reason = AttributionReason.CausalChainFix

      return {
        callRequestId,
        cost,
        payer: Payer.GoDaddy,
        reason,
        label: ReportLabel.CausalChain,
        causalChainTarget: chain.triggerTarget,
      }
    }
  }

  // Default: direct tool error
  return {
    callRequestId,
    cost,
    payer: Payer.GoDaddy,
    reason: AttributionReason.ToolError,
    label: ReportLabel.ToolFailure,
  }
}

/**
 * Attribute session items and log each decision.
 *
 * Per-call attribution with cost override support:
 * - Cost override calls (publish/domain) → GoDaddy
 * - Follow-up calls after cost override → GoDaddy
 * - Failure-related calls → GoDaddy
 * - Other calls → Customer
 *
 * Special cases:
 * - No value delivered → 100% GoDaddy (NoOutput)
 *
 * @param sessionItems - BMS session items with costs
 * @param executionData - Analyzed execution data from onFinish
 * @param context - Attribution context for logging
 * @returns AttributionResult with costs and attributions
 */
export function attributeSessionItems(
  sessionItems: readonly SessionItem[],
  executionData: ExecutionData,
  context: AttributionContext
): AttributionResult {
  const {
    failedCallIds,
    patterns,
    causalChains,
    noValueDelivered,
    costOverride,
    infrastructureCalls,
  } = executionData
  const safeInfrastructureCalls = infrastructureCalls ?? new Map<string, InfrastructureToolTypeName>()
  const totalCost = sessionItems.reduce((sum, item) => sum + item.cost, 0)

  // Handle noValueDelivered override: 100% GoDaddy
  // Agent ran but didn't successfully execute any tools - no work was done
  // Note: caller should check wasUserAborted before calling this function
  if (noValueDelivered) {
    logger.info('budget.attribution.no_value_delivered', {
      budgetId: context.budgetId,
      sessionId: context.sessionId,
      conversationId: context.conversationId,
      appId: context.appId,
      totalCost,
      reason: 'Agent ran but no tools executed successfully',
    })
    return {
      customerCost: 0,
      godaddyCost: totalCost,
      costsByLabel: new Map([[ReportLabel.NoOutput, totalCost]]),
      attributions: sessionItems.map(item => ({
        callRequestId: item.callRequestId,
        cost: item.cost,
        payer: Payer.GoDaddy,
        reason: AttributionReason.NoValueDelivered,
        label: ReportLabel.NoOutput,
      })),
      labels: [ReportLabel.NoOutput],
    }
  }

  // Build set of all GoDaddy-attributed callIds (per-call attribution)
  const godaddyCallIds = new Set<string>()

  // 1. Cost override calls (publish/domain tools + follow-ups)
  for (const callId of costOverride.actionCallIds) {
    godaddyCallIds.add(callId)
  }
  for (const callId of costOverride.followUpCallIds) {
    godaddyCallIds.add(callId)
  }

  // 2. Direct tool errors
  for (const callId of failedCallIds) {
    godaddyCallIds.add(callId)
  }

  // 3. Pattern-detected calls
  for (const pattern of patterns) {
    for (const callId of pattern.callIds) {
      godaddyCallIds.add(callId)
    }
  }

  // 4. Causal chain calls
  const causalCallIds = getCausalChainCallIds(causalChains)
  for (const callId of causalCallIds) {
    godaddyCallIds.add(callId)
  }

  // 5. Infrastructure tools (suggestedResponse, todoList) - agent overhead
  for (const callId of safeInfrastructureCalls.keys()) {
    godaddyCallIds.add(callId)
  }

  // Log all GoDaddy-attributed call IDs for debugging
  logger.info('budget.attribution.godaddy_call_ids', {
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    totalGodaddyCallIds: godaddyCallIds.size,
    godaddyCallIds: Array.from(godaddyCallIds),
    fromCostOverride: costOverride ? costOverride.actionCallIds.size + costOverride.followUpCallIds.size : 0,
    fromDirectFailures: failedCallIds.size,
    fromPatterns: patterns.reduce((sum, p) => sum + p.callIds.length, 0),
    fromCausalChains: causalCallIds.size,
    fromInfrastructure: safeInfrastructureCalls.size,
  })

  // Attribute each session item and log
  const attributions: ItemAttribution[] = []
  const costsByLabel = new Map<ReportLabel, number>()
  let godaddyCost = 0

  for (const item of sessionItems) {
    const attribution = determineAttribution(
      item.callRequestId,
      item.cost,
      godaddyCallIds,
      patterns,
      causalChains,
      costOverride,
      safeInfrastructureCalls
    )

    // Log every attribution decision with cost override details
    const isCostOverrideAction = attribution.reason === AttributionReason.CostOverrideAction
    const isCostOverrideFollowup = attribution.reason === AttributionReason.CostOverrideFollowup
    const costOverrideAction = (isCostOverrideAction || isCostOverrideFollowup)
      ? costOverride.actions.get(item.callRequestId)
      : undefined

    logger.info('budget.attribution.decided', {
      budgetId: context.budgetId,
      sessionId: context.sessionId,
      conversationId: context.conversationId,
      appId: context.appId,
      callRequestId: item.callRequestId,
      cost: item.cost,
      attribution: attribution.payer,
      reason: attribution.reason,
      label: attribution.label,
      patternType: attribution.patternType,
      patternDetails: attribution.patternDetails,
      causalChainTarget: attribution.causalChainTarget,
      // Cost override specific fields
      isCostOverride: isCostOverrideAction || isCostOverrideFollowup,
      costOverrideAction,
      costOverrideType: isCostOverrideAction ? AttributionReason.CostOverrideAction : isCostOverrideFollowup ? AttributionReason.CostOverrideFollowup : undefined,
    })

    if (attribution.payer === Payer.GoDaddy) {
      godaddyCost += item.cost
      // Aggregate costs by label for multi-label reports
      const currentLabelCost = costsByLabel.get(attribution.label) ?? 0
      costsByLabel.set(attribution.label, currentLabelCost + item.cost)
    }

    attributions.push(attribution)
  }

  // Derive customerCost from totalCost to ensure invariant: customerCost + godaddyCost === totalCost
  const customerCost = totalCost - godaddyCost

  const labels = determineLabels(
    patterns,
    causalChains,
    failedCallIds.size > 0,
    costOverride,
    costsByLabel.keys()
  )

  // Log cost override summary if any cost overrides were applied
  const costOverrideAttributions = attributions.filter(
    a => a.reason === AttributionReason.CostOverrideAction || a.reason === AttributionReason.CostOverrideFollowup
  )
  if (costOverrideAttributions.length > 0) {
    const costOverrideCost = costOverrideAttributions.reduce((sum, a) => sum + a.cost, 0)
    const actionAttributions = costOverrideAttributions.filter(a => a.reason === AttributionReason.CostOverrideAction)
    const followupAttributions = costOverrideAttributions.filter(a => a.reason === AttributionReason.CostOverrideFollowup)

    logger.info('budget.attribution.cost_override_summary', {
      budgetId: context.budgetId,
      sessionId: context.sessionId,
      conversationId: context.conversationId,
      appId: context.appId,
      totalCostOverrideCost: costOverrideCost,
      totalCostOverrideCallIds: costOverrideAttributions.length,
      actionCallIds: actionAttributions.map(a => a.callRequestId),
      actionCost: actionAttributions.reduce((sum, a) => sum + a.cost, 0),
      followupCallIds: followupAttributions.map(a => a.callRequestId),
      followupCost: followupAttributions.reduce((sum, a) => sum + a.cost, 0),
      costOverrideActions: Array.from(costOverride.actions.entries()).map(([callId, action]) => ({
        callId,
        action,
      })),
      costOverridePercentage: totalCost > 0 ? ((costOverrideCost / totalCost) * 100).toFixed(1) : '0',
    })
  }

  return {
    customerCost,
    godaddyCost,
    costsByLabel,
    attributions,
    labels,
  }
}

// REPORT GENERATION

/**
 * Generate multi-label report items from attribution result.
 * Creates separate report items for each failure type with their allocated costs.
 *
 * @param result - Attribution result from attributeSessionItems
 * @returns Array of report items for BMS
 */
export function generateReportItems(result: AttributionResult): ReportItemRequest[] {
  const items: ReportItemRequest[] = []

  // Customer cost goes to General label
  if (result.customerCost > 0) {
    items.push({
      budgetCost: result.customerCost.toString(),
      productCost: '0',
      label: ReportLabel.General,
    })
  }

  // GoDaddy costs are split by label for granular analytics
  for (const [label, cost] of result.costsByLabel) {
    if (cost > 0) {
      items.push({
        budgetCost: '0',
        productCost: cost.toString(),
        label,
      })
    }
  }

  // If no items (shouldn't happen), add a zero-cost general item
  if (items.length === 0) {
    items.push({
      budgetCost: '0',
      productCost: '0',
      label: ReportLabel.General,
    })
  }

  return items
}

// LOGGING HELPERS

/**
 * Log execution analysis completion.
 */
export function logExecutionCompleted(
  executionData: ExecutionData,
  context: AttributionContext
): void {
  logger.info('budget.execution.completed', {
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    conversationId: context.conversationId,
    appId: context.appId,
    totalSteps: executionData.totalSteps,
    failedCallCount: executionData.failedCallIds.size,
    failedCallIds: Array.from(executionData.failedCallIds),
    patternsDetected: executionData.patterns.length,
    patternCounts: executionData.patternCounts,
    patterns: executionData.patterns.map(p => ({
      type: p.type,
      details: p.details,
      affectedCalls: p.callIds.length,
    })),
    causalChainsDetected: executionData.causalChains.length,
    causalChains: executionData.causalChains.map(c => ({
      triggerTarget: c.triggerTarget,
      errorMessage: c.errorMessage.slice(0, 100),
      fixCallsCount: c.fixCallIds.length,
      hasVerification: !!c.verificationCallId,
    })),
    failedTargets: executionData.failedTargets,
    hadFailures: executionData.hadFailures,
    // Cost override detection (product-funded actions)
    costOverrideActionsDetected: executionData.costOverride.actions.size,
    costOverrideActions: Array.from(executionData.costOverride.actions.entries()).map(([callId, action]) => ({
      callId,
      action,
    })),
    costOverrideActionCallIds: Array.from(executionData.costOverride.actionCallIds),
    costOverrideFollowUpCallIds: Array.from(executionData.costOverride.followUpCallIds),
  })
}

/**
 * Log causal chain detection.
 */
export function logCausalChainDetected(
  chain: CausalChain,
  context: AttributionContext
): void {
  logger.info('budget.causalChain.detected', {
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    conversationId: context.conversationId,
    appId: context.appId,
    triggerCallId: chain.triggerCallId,
    triggerTarget: chain.triggerTarget,
    errorCallId: chain.errorCallId,
    errorMessage: chain.errorMessage,
    fixCallIds: chain.fixCallIds,
    verificationCallId: chain.verificationCallId,
    totalCallsInChain: 2 + chain.fixCallIds.length,
    reason: 'Agent broke something and fixed it within execution',
  })
}

/**
 * Log final report creation.
 */
export function logReportCreated(
  result: AttributionResult,
  reportId: string,
  context: AttributionContext
): void {
  const totalCost = result.customerCost + result.godaddyCost
  const godaddyPercentage =
    totalCost > 0 ? ((result.godaddyCost / totalCost) * 100).toFixed(1) : '0'

  logger.info('budget.report.created', {
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    conversationId: context.conversationId,
    appId: context.appId,
    reportId,
    customerCost: result.customerCost,
    godaddyCost: result.godaddyCost,
    totalCost,
    godaddyPercentage,
    labels: result.labels,
    attributionSummary: {
      toolErrors: result.attributions.filter(a => a.reason === AttributionReason.ToolError).length,
      patternDetected: result.attributions.filter(a => a.reason === AttributionReason.PatternDetected).length,
      causalChain: result.attributions.filter(a => CAUSAL_CHAIN_REASONS.includes(a.reason)).length,
      costOverrideAction: result.attributions.filter(a => a.reason === AttributionReason.CostOverrideAction).length,
      costOverrideFollowup: result.attributions.filter(a => a.reason === AttributionReason.CostOverrideFollowup).length,
      infrastructureOverhead: result.attributions.filter(a => a.reason === AttributionReason.InfrastructureOverhead).length,
      success: result.attributions.filter(a => a.reason === AttributionReason.Success).length,
    },
    totalCalls: result.attributions.length,
  })
}

// EXPORTS - Rule-based only (no LLM components)

export * from './types.js'
export { extractFailedCallIds, extractFailedTargets, getCorrelationId, messageReferencesTarget } from './failure-extraction.js'
export { detectHighConfidencePatterns } from './pattern-detection.js'
export { detectCausalChains, getCausalChainCallIds } from './causal-chain-detection.js'
export {
  createExecutionHistory,
  detectRetry,
  logRetryDetectionEvaluated,
  logRetryOverride,
} from './retry-detection.js'
export { buildAttributionPayload, emitCostAttributionResult } from './emit-cost-attribution-result.js'
export type {
  AttributionAssessment,
  AttributionPayload,
  AttributionPerCall,
  CostAttributionEventContext,
} from './emit-cost-attribution-result.js'
export {
  getCostOverrideAction,
  getCostOverrideSignal,
  analyzeCostOverrideActions,
  COST_OVERRIDE_TOOLS,
  type CostOverrideResult,
} from './cost-override-detection.js'
export { extractInfrastructureCallIds, extractInfrastructureCalls } from './infrastructure-detection.js'
