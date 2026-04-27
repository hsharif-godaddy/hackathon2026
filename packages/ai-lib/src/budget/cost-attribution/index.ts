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
  isFullOverrideIntent,
  type ExecutionStep,
  type ExecutionData,
  type AttributionResult,
  type AttributionContext,
  type ItemAttribution,
  type PatternResult,
  type CausalChain,
  type AssessmentIntent,
} from './types.js'
import { extractFailedCallIds, extractFailedTargets } from './failure-extraction.js'
import { detectHighConfidencePatterns } from './pattern-detection.js'
import { detectCausalChains, getCausalChainCallIds } from './causal-chain-detection.js'
import type { ReportItemRequest } from '../report-types.js'
import type { SessionItem } from '@airo/shared/budget'

const logger = createLogger('cost-attribution')


/**
 * Analyze SDK execution steps to extract failure data.
 * This should be called in onFinish and stored for later use in onBudgetReport.
 *
 * @param steps - Array of SDK execution steps from onFinish
 * @returns ExecutionData containing all detected failures and patterns
 */
export function analyzeExecution(steps: ExecutionStep[]): ExecutionData {
  const failedCallIds = extractFailedCallIds(steps)
  const patterns = detectHighConfidencePatterns(steps)
  const causalChains = detectCausalChains(steps)
  const failedTargets = extractFailedTargets(steps)

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
    causalChains,
    failedTargets,
    hadFailures,
    totalSteps: steps.length,
    noValueDelivered,
  }
}

// FULL OVERRIDE BYPASS

/**
 * Check if intent should bypass execution analysis entirely.
 * For publish/domain intents, all costs go to GoDaddy without per-call analysis.
 *
 * @param intent - Assessment intent from the assessment agent
 * @returns true if execution analysis should be skipped
 */
export function shouldBypassAnalysis(intent: AssessmentIntent | undefined): boolean {
  return isFullOverrideIntent(intent)
}

/**
 * Get the report label for a full override intent.
 */
function getFullOverrideLabel(intent: AssessmentIntent): ReportLabel {
  switch (intent) {
    case 'publish':
      return ReportLabel.PublishTask
    case 'domain':
      return ReportLabel.DomainTask
    default:
      return ReportLabel.General
  }
}

/**
 * Create a full override result where all costs go to GoDaddy.
 * Used when intent is publish/domain - no per-call analysis needed.
 *
 * @param totalCost - Total cost of all session items
 * @param intent - The full override intent (publish or domain)
 * @returns AttributionResult with 100% GoDaddy attribution
 */
export function createFullOverrideResult(
  totalCost: number,
  intent: AssessmentIntent
): AttributionResult {
  const label = getFullOverrideLabel(intent)

  return {
    customerCost: 0,
    godaddyCost: totalCost,
    costsByLabel: new Map([[label, totalCost]]),
    attributions: [], // No per-call attributions for full override
    primaryLabel: label,
  }
}

/**
 * Create minimal execution data for full override cases.
 * Skips pattern detection, causal chain detection, etc.
 */
export function createFullOverrideExecutionData(intent: AssessmentIntent): ExecutionData {
  return {
    failedCallIds: new Set(),
    patterns: [],
    causalChains: [],
    failedTargets: [],
    hadFailures: false,
    totalSteps: 0,
    intent,
    noValueDelivered: false,
  }
}

// COST ATTRIBUTION

/**
 * Determine the primary label based on detected patterns.
 * Uses highest-severity pattern as the dominant category.
 */
function determinePrimaryLabel(
  patterns: PatternResult[],
  causalChains: CausalChain[],
  hasDirectFailures: boolean
): ReportLabel {
  // Find highest-severity pattern
  if (patterns.length > 0) {
    const sorted = [...patterns].sort((a, b) => b.severity - a.severity)
    const top = sorted[0]
    if (top) return patternTypeToLabel(top.type)
  }

  if (causalChains.length > 0) return ReportLabel.CausalChain
  if (hasDirectFailures) return ReportLabel.ToolFailure

  return ReportLabel.General
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

/**
 * Determine attribution for a single session item.
 */
function determineAttribution(
  callRequestId: string,
  cost: number,
  godaddyCallIds: Set<string>,
  patterns: PatternResult[],
  causalChains: CausalChain[]
): ItemAttribution {
  // Check if this call is in the GoDaddy set
  if (!godaddyCallIds.has(callRequestId)) {
    return {
      callRequestId,
      cost,
      payer: 'customer',
      reason: 'success',
      label: ReportLabel.General,
    }
  }

  // Find which pattern this call belongs to
  for (const pattern of patterns) {
    if (pattern.callIds.includes(callRequestId)) {
      return {
        callRequestId,
        cost,
        payer: 'godaddy',
        reason: 'pattern_detected',
        label: patternTypeToLabel(pattern.type),
        patternType: pattern.type,
        patternDetails: pattern.details,
      }
    }
  }

  // Check causal chains
  for (const chain of causalChains) {
    if (
      chain.triggerCallId === callRequestId ||
      chain.errorCallId === callRequestId ||
      chain.fixCallIds.includes(callRequestId) ||
      chain.verificationCallId === callRequestId
    ) {
      let reason = 'causal_chain'
      if (chain.triggerCallId === callRequestId) reason = 'causal_chain_trigger'
      if (chain.errorCallId === callRequestId) reason = 'causal_chain_error'
      if (chain.fixCallIds.includes(callRequestId)) reason = 'causal_chain_fix'
      if (chain.verificationCallId === callRequestId) reason = 'causal_chain_verification'

      return {
        callRequestId,
        cost,
        payer: 'godaddy',
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
    payer: 'godaddy',
    reason: 'tool_error',
    label: ReportLabel.ToolFailure,
  }
}

/**
 * Attribute session items and log each decision.
 *
 * Priority order (checked by caller before calling this function):
 * 1. Full override intent      → 100% GoDaddy (use createFullOverrideResult)
 * 2. Has failures             → per-call attribution (this function)
 * 3. No value delivered        → 100% GoDaddy (NoOutput)
 * 4. No failures               → 100% Customer
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
  const { failedCallIds, patterns, causalChains, noValueDelivered } = executionData

  // Handle noValueDelivered override: 100% GoDaddy
  // Agent ran but didn't successfully execute any tools - no work was done
  // Note: caller should check wasUserAborted before calling this function
  if (noValueDelivered) {
    const totalCost = sessionItems.reduce((sum, item) => sum + item.cost, 0)
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
        payer: 'godaddy' as const,
        reason: 'no_value_delivered',
        label: ReportLabel.NoOutput,
      })),
      primaryLabel: ReportLabel.NoOutput,
    }
  }

  // Build set of all GoDaddy-attributed callIds (per-call attribution)
  const godaddyCallIds = new Set<string>()

  // 1. Direct tool errors
  for (const callId of failedCallIds) {
    godaddyCallIds.add(callId)
  }

  // 2. Pattern-detected calls
  for (const pattern of patterns) {
    for (const callId of pattern.callIds) {
      godaddyCallIds.add(callId)
    }
  }

  // 3. Causal chain calls
  const causalCallIds = getCausalChainCallIds(causalChains)
  for (const callId of causalCallIds) {
    godaddyCallIds.add(callId)
  }

  // Log all GoDaddy-attributed call IDs for debugging
  logger.info('budget.attribution.godaddy_call_ids', {
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    totalGodaddyCallIds: godaddyCallIds.size,
    godaddyCallIds: Array.from(godaddyCallIds),
    fromDirectFailures: failedCallIds.size,
    fromPatterns: patterns.reduce((sum, p) => sum + p.callIds.length, 0),
    fromCausalChains: causalCallIds.size,
  })

  // Attribute each session item and log
  const attributions: ItemAttribution[] = []
  const costsByLabel = new Map<ReportLabel, number>()
  let godaddyCost = 0

  // Compute totalCost once for deriving customerCost (avoids floating-point drift)
  const totalCost = sessionItems.reduce((sum, item) => sum + item.cost, 0)

  for (const item of sessionItems) {
    const attribution = determineAttribution(
      item.callRequestId,
      item.cost,
      godaddyCallIds,
      patterns,
      causalChains
    )

    // Log every attribution decision
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
    })

    if (attribution.payer === 'godaddy') {
      godaddyCost += item.cost
      // Aggregate costs by label for multi-label reports
      const currentLabelCost = costsByLabel.get(attribution.label) ?? 0
      costsByLabel.set(attribution.label, currentLabelCost + item.cost)
    }

    attributions.push(attribution)
  }

  // Derive customerCost from totalCost to ensure invariant: customerCost + godaddyCost === totalCost
  const customerCost = totalCost - godaddyCost

  const primaryLabel = determinePrimaryLabel(
    patterns,
    causalChains,
    failedCallIds.size > 0
  )

  return {
    customerCost,
    godaddyCost,
    costsByLabel,
    attributions,
    primaryLabel,
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
    primaryLabel: result.primaryLabel,
    attributionSummary: {
      toolErrors: result.attributions.filter(a => a.reason === 'tool_error').length,
      patternDetected: result.attributions.filter(a => a.reason === 'pattern_detected').length,
      causalChain: result.attributions.filter(a => a.reason.startsWith('causal_chain')).length,
      success: result.attributions.filter(a => a.reason === 'success').length,
    },
    totalCalls: result.attributions.length,
  })
}

// EXPORTS - Rule-based only (no LLM components)

export * from './types.js'
export { extractFailedCallIds, extractFailedTargets, messageReferencesTarget } from './failure-extraction.js'
export { detectHighConfidencePatterns } from './pattern-detection.js'
export { detectCausalChains, getCausalChainCallIds } from './causal-chain-detection.js'
export {
  createExecutionHistory,
  detectRetry,
  logRetryDetectionEvaluated,
  logRetryOverride,
} from './retry-detection.js'
