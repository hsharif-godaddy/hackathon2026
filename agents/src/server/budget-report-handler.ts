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
  generateReportItems,
  analyzeExecution,
  attributeSessionItems,
  logExecutionCompleted,
  logCausalChainDetected,
  ReportLabel,
  Payer,
  type AssessmentIntent,
  type ExecutionData,
  type ExecutionStep,
  type AttributionContext,
  type AttributionResult,
} from '@airo/ai-lib/budget'

export interface BudgetReportContext {
  budgetId: string
  sessionId: string
  totalCost: number
  sessionItems: readonly { callRequestId: string; cost: number }[]
  steps?: ExecutionStep[]
  assessmentOutcome?: AssessmentOutcome
  /** True if user clicked Stop - prevents misattributing user-aborted sessions as GoDaddy cost */
  wasUserAborted?: boolean
}

export interface BudgetReportResult {
  reportItems: Array<{ budgetCost: string; productCost: string; label: string }>
  executionData?: ExecutionData
  /** True if GoDaddy covered 100% of the cost (customer paid nothing) */
  sessionWasFree: boolean
  /** Full attribution result for logging (only present for per-call attribution) */
  attributionResult?: AttributionResult
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
  const { budgetId, sessionId, totalCost, sessionItems, steps, assessmentOutcome, wasUserAborted } = context

  // Log steps received for debugging
  logger.info('budget.report.steps_received', {
    budgetId,
    sessionId,
    stepsAvailable: !!steps,
    stepCount: steps?.length ?? 0,
  })

  // Analyze execution steps if available
  let executionData: ExecutionData | undefined

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
  }

  // Determine report items using cost attribution logic
  let reportItems: Array<{ budgetCost: string; productCost: string; label: string }>
  let sessionWasFree = false
  let attributionResult: AttributionResult | undefined

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
    const hasCostOverride = (executionData?.costOverride.actionCallIds.size ?? 0) > 0
    const hasInfrastructure = (executionData?.infrastructureCallIds.size ?? 0) > 0
    const needsPerCallAttribution = executionData?.hadFailures || hasCostOverride || hasInfrastructure
    if (
      executionData &&
      needsPerCallAttribution &&
      sessionItems.length > 0 &&
      !(executionData.noValueDelivered && wasUserAborted && !hasCostOverride && !hasInfrastructure)
    ) {
      // Per-call attribution: analyze failures and attribute costs
      const result = attributeSessionItems(sessionItems, executionData, attributionContext)
      reportItems = generateReportItems(result)
      sessionWasFree = result.customerCost === 0 // GoDaddy covers 100% if no customer cost
      attributionResult = result

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
    } else if (executionData?.noValueDelivered && !wasUserAborted) {
      // No value delivered: agent ran but produced nothing useful -> 100% GoDaddy
      // Skip if user aborted - that's the user's choice, not an agent failure
      reportItems = [{
        budgetCost: '0',
        productCost: totalCost.toString(),
        label: ReportLabel.NoOutput,
      }]
      sessionWasFree = true // GoDaddy covers 100%

      logger.info('budget.attribution.no_value', {
        budgetId,
        sessionId,
        totalCost,
        label: ReportLabel.NoOutput,
        reason: 'Agent ran but no output or successful tool calls',
        sessionWasFree,
      })
    } else if (executionData?.noValueDelivered && wasUserAborted) {
      // User aborted before any output - charge to customer (their choice)
      reportItems = [{
        budgetCost: totalCost.toString(),
        productCost: '0',
        label: ReportLabel.General,
      }]
      sessionWasFree = false // Customer pays

      logger.info('budget.attribution.user_aborted', {
        budgetId,
        sessionId,
        totalCost,
        label: ReportLabel.General,
        reason: 'User aborted session before output',
        sessionWasFree,
      })
    } else {
      // Default: 100% Customer
      reportItems = [{
        budgetCost: totalCost.toString(),
        productCost: '0',
        label: ReportLabel.General,
      }]
      sessionWasFree = false // Customer pays 100%

      // Log warning for unexpected state: failures detected but couldn't attribute
      if (executionData?.hadFailures && sessionItems.length === 0) {
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
        hasExecutionData: !!executionData,
        hadFailures: executionData?.hadFailures,
        sessionItemCount: sessionItems.length,
        totalCost,
        label: ReportLabel.General,
        sessionWasFree,
      })
    }
  }

  return { reportItems, executionData, sessionWasFree, attributionResult }
}
