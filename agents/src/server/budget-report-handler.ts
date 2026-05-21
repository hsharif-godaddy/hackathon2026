/**
 * Budget Report Handler
 *
 * Handles cost attribution logic for onBudgetReport callback.
 * Analyzes execution steps and determines how costs should be split
 * between customer and GoDaddy based on rule-based detection.
 */

import { logger } from '../logging/index.js'
import type { AssessmentOutcome } from '../agents/assessment-agent/index.js'
import {
  emptyExecutionData,
  generateReportItems,
  analyzeExecution,
  attributeSessionItems,
  getCorrelationId,
  logExecutionCompleted,
  logCausalChainDetected,
  ReportLabel,
  Payer,
  type AssessmentIntent,
  type AttributionContext,
  type AttributionPath,
  type AttributionResult,
  type ExecutionData,
  type ExecutionStep,
} from '@airo/ai-lib/budget'
import { isBmsOverride, BudgetOverride } from '@airo/ai-grants'

export interface BudgetReportContext {
  budgetId: string
  sessionId: string
  totalCost: number
  sessionItems: readonly { callRequestId: string; cost: number }[]
  steps?: ExecutionStep[]
  assessmentOutcome?: AssessmentOutcome
  /** True if user clicked Stop - prevents misattributing user-aborted sessions as GoDaddy cost */
  wasUserAborted?: boolean
  /** Original subscriptionId for override detection (care agent, test accounts) */
  subscriptionId?: string
}

export interface BudgetReportResult {
  reportItems: Array<{ budgetCost: string; productCost: string; label: string }>
  /** Always present. Defaults to emptyExecutionData() when no steps were available. */
  executionData: ExecutionData
  /** True if GoDaddy covered 100% of the cost (customer paid nothing) */
  sessionWasFree: boolean
  /** Full attribution result for logging (only present for per-call attribution) */
  attributionResult?: AttributionResult
  /** Which decision branch produced this result */
  attributionPath: AttributionPath
  /** Session labels. Producer defaults to [General] when no other labels apply. */
  labels: ReportLabel[]
}

/**
 * Analyze execution and determine cost attribution.
 *
 * Rule-based attribution logic (per-call when any condition met):
 * 1. Cost override tools (publish/domain) -> those calls to GoDaddy
 * 2. Infrastructure tools (suggestedResponse/todoList) -> always GoDaddy
 * 3. Has failures -> per-call attribution based on patterns/chains
 * 4. No value delivered -> 100% GoDaddy
 * 5. Default (no failures, no overrides, no infrastructure) -> 100% Customer
 */
export function processBudgetReport(context: BudgetReportContext): BudgetReportResult {
  const { budgetId, sessionId, totalCost, sessionItems, steps, assessmentOutcome, wasUserAborted, subscriptionId } = context

  // Override sessions (care agents, test accounts): 100% GoDaddy attribution
  // Only CareAgent and TestAccounts trigger BMS override attribution - other BudgetOverride
  // values (AssessAgent, PublishTask, etc.) are for the legacy grants system
  if (isBmsOverride(subscriptionId)) {
    // Map BMS override subscriptionId to the corresponding ReportLabel
    // Exhaustive switch ensures compile error if a new BMS override is added
    let overrideLabel: ReportLabel
    switch (subscriptionId) {
      case BudgetOverride.CareAgent:
        overrideLabel = ReportLabel.CareAgent
        break
      case BudgetOverride.TestAccounts:
        overrideLabel = ReportLabel.TestAccounts
        break
      default: {
        // TypeScript exhaustiveness check - this should never execute
        const _exhaustive: never = subscriptionId
        throw new Error(`Unhandled BMS override: ${_exhaustive}`)
      }
    }

    logger.info('budget.report.override_session', {
      budgetId,
      sessionId,
      subscriptionId,
      totalCost,
      label: overrideLabel,
      reason: 'Budget override session - all costs attributed to GoDaddy',
    })

    return {
      reportItems: [{
        budgetCost: '0',
        productCost: totalCost.toString(),
        label: overrideLabel,
      }],
      executionData: emptyExecutionData(),
      sessionWasFree: true,
      attributionPath: 'override_session',
      labels: [overrideLabel],
    }
  }

  // Log steps received for debugging
  logger.info('budget.report.steps_received', {
    budgetId,
    sessionId,
    stepsAvailable: !!steps,
    stepCount: steps?.length ?? 0,
  })

  // Default to empty so downstream code (and the emitted event) always has a concrete
  // shape. analyzeExecution overwrites it when steps are available.
  let executionData: ExecutionData = emptyExecutionData()

  if (steps && steps.length > 0) {
    executionData = analyzeExecution(steps)

    // Add assessment intent to execution data
    if (assessmentOutcome?.result?.taskType) {
      executionData.intent = assessmentOutcome.result.taskType as AssessmentIntent
    }

    // Attribution context for logging
    const analysisContext: AttributionContext = {
      budgetId,
      sessionId,
      conversationId: undefined,
      appId: undefined,
    }

    // Log detailed execution analysis
    logExecutionCompleted(executionData, analysisContext)

    // Log each detected causal chain for debugging edit→error→fix sequences
    for (const chain of executionData.causalChains) {
      logCausalChainDetected(chain, analysisContext)
    }

    logger.info('budget.report.steps_analyzed', {
      budgetId,
      sessionId,
      totalSteps: executionData.totalSteps,
      hadFailures: executionData.hadFailures,
      failedCallCount: executionData.failedCallIds.size,
      patternsDetected: executionData.patterns.length,
      patternTypes: executionData.patterns.map(p => p.type),
      causalChainsDetected: executionData.causalChains.length,
      noValueDelivered: executionData.noValueDelivered,
      costOverrideActionsDetected: executionData.costOverride.actions.size,
      costOverrideActions: Array.from(executionData.costOverride.actions.values()),
    })
  } else if (wasUserAborted) {
    // analyzeExecution is skipped when steps are empty, so noValueDelivered is never derived.
    // Force it here to reach the user_aborted attribution branch.
    executionData.noValueDelivered = true
  }

  // Determine report items using cost attribution logic
  let reportItems: Array<{ budgetCost: string; productCost: string; label: string }>
  let sessionWasFree = false
  let attributionResult: AttributionResult | undefined
  let attributionPath: AttributionPath
  let labels: ReportLabel[]

  const assessmentIntent = assessmentOutcome?.result?.taskType as AssessmentIntent | undefined

  {
    // Per-call attribution using rule-based detection
    const attributionContext: AttributionContext = {
      budgetId,
      sessionId,
      conversationId: undefined,
      appId: undefined,
    }

    // Per-call attribution when there are failures, cost overrides, or infrastructure overhead to analyze
    // Skip if user aborted AND noValueDelivered AND no cost override - user's choice to abort, not an agent failure
    // But if there's a cost override (publish/domain) or infrastructure tools, always do per-call attribution
    const hasCostOverride = executionData.costOverride.actionCallIds.size > 0
    const hasInfrastructure = executionData.infrastructureCallIds.size > 0
    const needsPerCallAttribution = executionData.hadFailures || hasCostOverride || hasInfrastructure
    if (
      needsPerCallAttribution &&
      sessionItems.length > 0 &&
      !(executionData.noValueDelivered && wasUserAborted && !hasCostOverride && !hasInfrastructure)
    ) {
      // Per-call attribution: analyze failures and attribute costs
      const result = attributeSessionItems(sessionItems, executionData, attributionContext)
      reportItems = generateReportItems(result)
      sessionWasFree = result.customerCost === 0 // GoDaddy covers 100% if no customer cost
      attributionResult = result
      attributionPath = 'per_call'
      labels = result.labels

      // Log correlation ID mapping for debugging cost attribution
      // This shows all inputs: BMS session items (with x-request-id) vs detected failures (with correlation IDs)
      logger.info('budget.attribution.correlation_ids', {
        budgetId,
        sessionId,
        sessionItemCallIds: sessionItems.map(item => item.callRequestId),
        failedCallIds: Array.from(executionData.failedCallIds),
        patternCallIds: executionData.patterns.flatMap(p => p.callIds),
        causalChainCallIds: executionData.causalChains.flatMap(c => [
          c.triggerCallId,
          c.errorCallId,
          ...c.fixCallIds,
          ...(c.verificationCallId ? [c.verificationCallId] : []),
        ]),
      })

      // Note: Per-decision logging happens in attributeSessionItems() at budget.attribution.decided

      const godaddyAttributions = result.attributions.filter(a => a.payer === Payer.GoDaddy)
      const customerAttributions = result.attributions.filter(a => a.payer === Payer.Customer)

      logger.info('budget.attribution.per_call', {
        budgetId,
        sessionId,
        assessmentIntent,
        totalCost,
        customerCost: result.customerCost,
        godaddyCost: result.godaddyCost,
        labels: result.labels,
        totalAttributions: result.attributions.length,
        godaddyAttributions: godaddyAttributions.length,
        customerAttributions: customerAttributions.length,
        failedCallCount: executionData.failedCallIds.size,
        patternsDetected: executionData.patterns.length,
        causalChainsDetected: executionData.causalChains.length,
        sessionWasFree,
      })
    } else if (executionData.noValueDelivered && !wasUserAborted) {
      // No value delivered: agent ran but produced nothing useful -> 100% GoDaddy
      // Skip if user aborted - that's the user's choice, not an agent failure
      const label = ReportLabel.NoOutput
      reportItems = [{
        budgetCost: '0',
        productCost: totalCost.toString(),
        label,
      }]
      sessionWasFree = true // GoDaddy covers 100%
      attributionPath = 'no_value'
      labels = [label]

      logger.info('budget.attribution.no_value', {
        budgetId,
        sessionId,
        totalCost,
        label,
        reason: 'Agent ran but no output or successful tool calls',
        sessionWasFree,
      })
    } else if (executionData.noValueDelivered && wasUserAborted) {
      // User aborted before any output - charge to customer (their choice)
      const label = ReportLabel.General
      reportItems = [{
        budgetCost: totalCost.toString(),
        productCost: '0',
        label,
      }]
      sessionWasFree = false // Customer pays
      attributionPath = 'user_aborted'
      labels = [label]

      logger.info('budget.attribution.user_aborted', {
        budgetId,
        sessionId,
        totalCost,
        label,
        reason: 'User aborted session before output',
        sessionWasFree,
      })
    } else {
      // Default: 100% Customer
      const label = ReportLabel.General
      reportItems = [{
        budgetCost: totalCost.toString(),
        productCost: '0',
        label,
      }]
      sessionWasFree = false // Customer pays 100%
      attributionPath = 'default'
      labels = [label]

      // Log warning for unexpected state: failures detected but couldn't attribute
      if (executionData.hadFailures && sessionItems.length === 0) {
        logger.warn('budget.attribution.failures_without_session_items', {
          budgetId,
          sessionId,
          hadFailures: true,
          sessionItemCount: 0,
          failedCallCount: executionData.failedCallIds.size,
          patternsDetected: executionData.patterns.length,
          reason: 'Failures detected but no BMS session items to attribute - costs may be misattributed',
        })
      }

      logger.info('budget.attribution.default', {
        budgetId,
        sessionId,
        assessmentIntent,
        hasSteps: executionData.totalSteps > 0,
        // undefined when no steps were available - distinguishes "no data" from "data, no failures".
        hadFailures: executionData.totalSteps > 0 ? executionData.hadFailures : undefined,
        sessionItemCount: sessionItems.length,
        totalCost,
        label,
        sessionWasFree,
      })
    }
  }

  return { reportItems, executionData, sessionWasFree, attributionResult, attributionPath, labels }
}

/**
 * Result returned when attribution analysis crashes: customer pays 100%,
 * signalled via `attributionPath: 'attribution_failed'`.
 */
export function attributionFailedFallback(totalCost: number): BudgetReportResult {
  return {
    reportItems: [{
      budgetCost: totalCost.toString(),
      productCost: '0',
      label: ReportLabel.General,
    }],
    executionData: emptyExecutionData(),
    sessionWasFree: false,
    attributionResult: undefined,
    attributionPath: 'attribution_failed',
    labels: [ReportLabel.General],
  }
}

export interface SafeProcessBudgetReportResult {
  result: BudgetReportResult
  /** True if attribution crashed and we fell back to 100% customer */
  didFallback: boolean
}

/**
 * Wrapper around processBudgetReport that catches attribution errors and
 * degrades gracefully to 100% customer attribution. Ensures createReport
 * can still execute even if attribution logic crashes.
 *
 * Use this instead of try-catching processBudgetReport directly to ensure
 * consistent fallback behavior and logging across WebSocket and SSE paths.
 */
export function safeProcessBudgetReport(
  context: BudgetReportContext,
  logContext: { budgetId: string; sessionId: string },
): SafeProcessBudgetReportResult {
  try {
    return { result: processBudgetReport(context), didFallback: false }
  } catch (err) {
    // Attribution logic crashed - degrade gracefully so createReport still executes.
    // Customer pays 100% when we can't determine attribution (safe default).
    // Event name is camelCase to preserve existing dashboards; do not rename.
    logger.error('budget.report.attributionFailed', {
      budgetId: logContext.budgetId,
      sessionId: logContext.sessionId,
      attributionPath: 'attribution_failed',
      sessionWasFree: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return { result: attributionFailedFallback(context.totalCost), didFallback: true }
  }
}

/**
 * Walk steps backwards and return the first correlation ID found.
 * Not restricted to LLM-only steps — any step type that carried a
 * correlation ID header counts (tool-result, text, etc.).
 */
function findLastCorrelationId(steps: ExecutionStep[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const id = getCorrelationId(steps[i]!)
    if (id) return id
  }
  return undefined
}

/**
 * Log whether the last step's correlation ID was found in the BMS session items.
 * Emits on every session so dashboards can compute a miss rate
 * (found=false / total) to decide whether polling is worth the latency.
 */
export function checkCorrelationIdRace(
  steps: ExecutionStep[],
  sessionItems: readonly { callRequestId: string }[],
  context: { budgetId: string; sessionId: string },
): void {
  if (steps.length === 0) return

  const lastCorrelationId = findLastCorrelationId(steps)
  if (!lastCorrelationId) return

  const found = sessionItems.some(item => item.callRequestId === lastCorrelationId)

  logger.info('budget.report.correlation_id_race', {
    budgetId: context.budgetId,
    sessionId: context.sessionId,
    lastCorrelationId,
    found,
    itemCount: sessionItems.length,
  })
}
