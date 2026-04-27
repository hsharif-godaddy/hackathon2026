import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processBudgetReport, type BudgetReportContext } from '../budget-report-handler.js'
import type { AssessmentOutcome } from '../../agents/assessment-agent/index.js'
import { ReportLabel, type ExecutionStep } from '@airo/ai-lib/budget'

// Mock the logger to prevent console output during tests
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

// Helper to create minimal session items
function createSessionItems(count: number, costPerItem: number = 1.0) {
  return Array.from({ length: count }, (_, i) => ({
    callRequestId: `call-${i}`,
    cost: costPerItem,
  }))
}

// Helper to create mock execution steps that will be analyzed
function createMockSteps(options: {
  withToolError?: boolean
  withTextOutput?: boolean
  withToolResult?: boolean
  correlationId?: string
}): ExecutionStep[] {
  const content: Array<
    | { type: 'tool-error'; toolName: string; error: string }
    | { type: 'text'; text: string }
    | { type: 'tool-result'; toolName: string; result: string }
  > = []

  if (options.withToolError) {
    content.push({
      type: 'tool-error' as const,
      toolName: 'bash',
      error: 'Command failed',
    })
  }

  if (options.withTextOutput) {
    content.push({
      type: 'text' as const,
      text: 'Some output from the agent',
    })
  }

  if (options.withToolResult) {
    content.push({
      type: 'tool-result' as const,
      toolName: 'read',
      result: 'file contents',
    })
  }

  return [{
    stepType: 'tool-call',
    response: options.correlationId ? {
      headers: { 'x-correlation-id': options.correlationId },
    } : undefined,
    content,
  }] as unknown as ExecutionStep[]
}

describe('processBudgetReport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('full override intent (publish/domain)', () => {
    it('attributes 100% to GoDaddy for publish intent when override was applied', () => {
      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 10.0,
        sessionItems: createSessionItems(2, 5.0),
        assessmentOutcome: {
          result: { taskType: 'publish' },
          overrideApplied: true,
        } as AssessmentOutcome,
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(true)
      expect(result.reportItems).toHaveLength(1)
      expect(result.reportItems[0]).toEqual({
        budgetCost: '0',
        productCost: '10',
        label: ReportLabel.PublishTask,
      })
    })

    it('attributes 100% to GoDaddy for domain intent when override was applied', () => {
      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems: createSessionItems(1, 5.0),
        assessmentOutcome: {
          result: { taskType: 'domain' },
          overrideApplied: true,
        } as AssessmentOutcome,
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(true)
      expect(result.reportItems[0]?.label).toBe(ReportLabel.DomainTask)
    })

    it('does NOT apply full override when overrideApplied is false (low confidence)', () => {
      // This tests the case where embedding matched "domain" but confidence was too low
      // (e.g., "Search by ingredients" matching "search for domains" at 0.41 similarity)
      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems: createSessionItems(1, 5.0),
        assessmentOutcome: {
          result: { taskType: 'domain' },
          overrideApplied: false, // Low confidence - override was NOT applied
        } as AssessmentOutcome,
      }

      const result = processBudgetReport(context)

      // Should charge customer since override was not applied
      expect(result.sessionWasFree).toBe(false)
      expect(result.reportItems[0]?.label).toBe(ReportLabel.General)
    })
  })

  describe('no value delivered', () => {
    it('attributes 100% to GoDaddy when agent produced nothing and not user aborted', () => {
      // Steps with no text output and no tool results = no value delivered
      const emptySteps: ExecutionStep[] = [{
        stepType: 'tool-call',
        content: [],
      }] as unknown as ExecutionStep[]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 3.0,
        sessionItems: createSessionItems(1, 3.0),
        steps: emptySteps,
        wasUserAborted: false,
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(true)
      expect(result.reportItems[0]).toEqual({
        budgetCost: '0',
        productCost: '3',
        label: ReportLabel.NoOutput,
      })
    })

    it('attributes 100% to Customer when user aborted before any output', () => {
      // Same empty steps but user aborted
      const emptySteps: ExecutionStep[] = [{
        stepType: 'tool-call',
        content: [],
      }] as unknown as ExecutionStep[]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 3.0,
        sessionItems: createSessionItems(1, 3.0),
        steps: emptySteps,
        wasUserAborted: true,
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(false)
      expect(result.reportItems[0]).toEqual({
        budgetCost: '3',
        productCost: '0',
        label: ReportLabel.General,
      })
    })

    it('does per-call attribution when user aborted after delivering value with failures', () => {
      // Scenario: agent delivered real output AND had failures, then user aborted
      // This is the most common real-world abort - agent was working, user decided to stop
      // Should enter per-call attribution path (not noValueDelivered override)
      const stepsWithValueAndFailure = [{
        stepType: 'tool-call',
        response: { headers: { 'x-correlation-id': 'call-0' } },
        content: [
          { type: 'tool-result' as const, toolName: 'read', result: 'file contents' },
          { type: 'tool-error' as const, toolName: 'bash', error: 'Command failed' },
        ],
      }] as unknown as ExecutionStep[]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems: createSessionItems(1, 5.0),
        steps: stepsWithValueAndFailure,
        wasUserAborted: true,
      }

      const result = processBudgetReport(context)

      // Per-call attribution should have run (attributionResult defined)
      expect(result.attributionResult).toBeDefined()
      // The failed call should be attributed to GoDaddy
      expect(result.attributionResult?.godaddyCost).toBeGreaterThan(0)
      // sessionWasFree reflects actual attribution, not a blanket override
      expect(result.sessionWasFree).toBe(true) // GoDaddy pays for the failure
    })
  })

  describe('default path (no failures)', () => {
    it('attributes 100% to Customer when no execution data', () => {
      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems: createSessionItems(2, 2.5),
        // No steps provided
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(false)
      expect(result.reportItems[0]).toEqual({
        budgetCost: '5',
        productCost: '0',
        label: ReportLabel.General,
      })
    })

    it('attributes 100% to Customer when steps have no failures', () => {
      // Steps with successful tool results and text output
      const successfulSteps = createMockSteps({
        withTextOutput: true,
        withToolResult: true,
      })

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 8.0,
        sessionItems: createSessionItems(2, 4.0),
        steps: successfulSteps,
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(false)
      expect(result.reportItems[0]?.label).toBe(ReportLabel.General)
      // Customer pays full amount
      expect(result.reportItems[0]?.budgetCost).toBe('8')
      expect(result.reportItems[0]?.productCost).toBe('0')
    })
  })

  describe('no steps fallback', () => {
    it('attributes 100% to Customer with empty steps array', () => {
      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 2.0,
        sessionItems: createSessionItems(1, 2.0),
        steps: [], // Empty array, not undefined
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(false)
      expect(result.reportItems[0]).toEqual({
        budgetCost: '2',
        productCost: '0',
        label: ReportLabel.General,
      })
    })
  })

  describe('per-call attribution with failures', () => {
    it('includes executionData in result when steps are provided', () => {
      const steps = createMockSteps({
        withToolResult: true,
        withTextOutput: true,
      })

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems: createSessionItems(2, 2.5),
        steps,
      }

      const result = processBudgetReport(context)

      expect(result.executionData).toBeDefined()
      expect(result.executionData?.totalSteps).toBe(1)
    })

    it('preserves intent from assessment outcome in execution data', () => {
      const steps = createMockSteps({
        withToolResult: true,
        withTextOutput: true,
      })

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems: createSessionItems(2, 2.5),
        steps,
        assessmentOutcome: {
          result: { taskType: 'FixTask' },
        } as unknown as AssessmentOutcome,
      }

      const result = processBudgetReport(context)

      expect(result.executionData?.intent).toBe('FixTask')
    })

    it('exercises attributeSessionItems when steps have tool errors with matching correlation IDs', () => {
      // Create steps with a tool error and a known correlation ID
      // The correlation ID comes from step.response.headers['x-correlation-id']
      const correlationId = 'corr-failed-001'
      const stepsWithError: ExecutionStep[] = [{
        stepType: 'tool-call',
        response: {
          headers: {
            'x-correlation-id': correlationId,
          },
        },
        content: [
          {
            type: 'tool-error' as const,
            toolName: 'bash',
            error: 'Command failed: npm install',
          },
        ],
      }] as unknown as ExecutionStep[]

      // Session items must have a callRequestId matching the correlation ID
      const sessionItems = [
        { callRequestId: correlationId, cost: 5.0 },
      ]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems,
        steps: stepsWithError,
      }

      const result = processBudgetReport(context)

      // Verify the per-call attribution path was exercised
      expect(result.executionData).toBeDefined()
      expect(result.executionData?.hadFailures).toBe(true)
      expect(result.executionData?.failedCallIds.size).toBeGreaterThan(0)

      // attributionResult is only present for per-call attribution
      expect(result.attributionResult).toBeDefined()
      expect(result.attributionResult?.attributions).toBeDefined()
      expect(result.attributionResult?.attributions.length).toBeGreaterThan(0)

      // The failed call should be attributed to GoDaddy (productCost > 0)
      const totalProductCost = result.reportItems.reduce(
        (sum, item) => sum + parseFloat(item.productCost),
        0
      )
      expect(totalProductCost).toBeGreaterThan(0)

      // Verify the specific failed call was attributed to GoDaddy
      // Note: With only a tool-error and no successful output, noValueDelivered triggers
      const failedAttribution = result.attributionResult?.attributions.find(
        a => a.callRequestId === correlationId
      )
      expect(failedAttribution?.payer).toBe('godaddy')
      expect(failedAttribution?.reason).toBe('no_value_delivered')
    })

    it('exercises causal chain attribution when edit causes error then fix', () => {
      // Causal chain pattern: Edit → Error (mentioning edited file) → Fix → Verification
      // All calls in the chain should be attributed to GoDaddy
      const editCallId = 'corr-edit-001'
      const errorCallId = 'corr-error-002'
      const fixCallId = 'corr-fix-003'
      const verifyCallId = 'corr-verify-004'

      // Step 1: Edit file (trigger)
      // Step 2: Command fails with error mentioning the file
      // Step 3: Read/Edit to fix
      // Step 4: Command succeeds (verification)
      const causalChainSteps: ExecutionStep[] = [
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': editCallId } },
          content: [{
            type: 'tool-result' as const,
            toolName: 'edit',
            result: 'File edited successfully',
            input: { path: '/app/src/Button.tsx' },
          }],
        },
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': errorCallId } },
          content: [{
            type: 'tool-error' as const,
            toolName: 'bash',
            error: 'Error: Cannot find module Button.tsx - syntax error at line 15',
          }],
        },
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': fixCallId } },
          content: [{
            type: 'tool-result' as const,
            toolName: 'edit',
            result: 'Fixed syntax error',
            input: { path: '/app/src/Button.tsx' },
          }],
        },
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': verifyCallId } },
          content: [{
            type: 'tool-result' as const,
            toolName: 'bash',
            result: 'Build successful',
          }],
        },
      ] as unknown as ExecutionStep[]

      const sessionItems = [
        { callRequestId: editCallId, cost: 2.0 },
        { callRequestId: errorCallId, cost: 1.5 },
        { callRequestId: fixCallId, cost: 2.5 },
        { callRequestId: verifyCallId, cost: 1.0 },
      ]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 7.0,
        sessionItems,
        steps: causalChainSteps,
      }

      const result = processBudgetReport(context)

      // Verify causal chain was detected
      expect(result.executionData).toBeDefined()
      expect(result.executionData?.causalChains.length).toBeGreaterThan(0)

      // Verify attribution result exists
      expect(result.attributionResult).toBeDefined()
      const attributions = result.attributionResult!.attributions

      // Verify each call in the chain has the correct specific reason
      const triggerAttr = attributions.find(a => a.callRequestId === editCallId)
      expect(triggerAttr?.payer).toBe('godaddy')
      expect(triggerAttr?.reason).toBe('causal_chain_trigger')

      const errorAttr = attributions.find(a => a.callRequestId === errorCallId)
      expect(errorAttr?.payer).toBe('godaddy')
      expect(errorAttr?.reason).toBe('causal_chain_error')

      const fixAttr = attributions.find(a => a.callRequestId === fixCallId)
      expect(fixAttr?.payer).toBe('godaddy')
      expect(fixAttr?.reason).toBe('causal_chain_fix')

      const verifyAttr = attributions.find(a => a.callRequestId === verifyCallId)
      expect(verifyAttr?.payer).toBe('godaddy')
      expect(verifyAttr?.reason).toBe('causal_chain_verification')

      // Verify cost accounting invariant: budgetCost + productCost === sessionItem.cost
      for (const sessionItem of sessionItems) {
        const attr = attributions.find(a => a.callRequestId === sessionItem.callRequestId)
        expect(attr).toBeDefined()
        // All chain members go to GoDaddy (productCost), customer pays nothing (budgetCost=0)
        expect(attr!.cost).toBe(sessionItem.cost)
      }

      // Total GoDaddy cost should equal total session cost (entire chain attributed)
      const totalProductCost = result.reportItems.reduce(
        (sum, item) => sum + parseFloat(item.productCost),
        0
      )
      expect(totalProductCost).toBe(7.0)
    })
  })

  describe('split attribution', () => {
    it('correctly splits costs: 2 GoDaddy-attributed items + 1 customer-attributed item', () => {
      // This tests the core per-call attribution behavior: mixed attribution
      // where some calls are attributed to GoDaddy (failures) and some to customer (successes)
      const failedCallId1 = 'corr-fail-001'
      const failedCallId2 = 'corr-fail-002'
      const successCallId = 'corr-success-001'

      // Step 1 & 2: Two failed calls
      // Step 3: One successful call
      const mixedSteps: ExecutionStep[] = [
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': failedCallId1 } },
          content: [{
            type: 'tool-error' as const,
            toolName: 'bash',
            error: 'npm install failed',
          }],
        },
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': failedCallId2 } },
          content: [{
            type: 'tool-error' as const,
            toolName: 'bash',
            error: 'npm test failed',
          }],
        },
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': successCallId } },
          content: [
            {
              type: 'tool-result' as const,
              toolName: 'read',
              result: 'Successfully read file',
            },
            {
              type: 'text' as const,
              text: 'Here is the file content...',
            },
          ],
        },
      ] as unknown as ExecutionStep[]

      const sessionItems = [
        { callRequestId: failedCallId1, cost: 2.0 },
        { callRequestId: failedCallId2, cost: 3.0 },
        { callRequestId: successCallId, cost: 5.0 },
      ]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 10.0,
        sessionItems,
        steps: mixedSteps,
      }

      const result = processBudgetReport(context)

      // Verify per-call attribution was used
      expect(result.attributionResult).toBeDefined()
      const attributions = result.attributionResult!.attributions
      expect(attributions).toHaveLength(3)

      // Verify failed calls are attributed to GoDaddy
      const fail1Attr = attributions.find(a => a.callRequestId === failedCallId1)
      expect(fail1Attr?.payer).toBe('godaddy')
      expect(fail1Attr?.cost).toBe(2.0)

      const fail2Attr = attributions.find(a => a.callRequestId === failedCallId2)
      expect(fail2Attr?.payer).toBe('godaddy')
      expect(fail2Attr?.cost).toBe(3.0)

      // Verify successful call is attributed to customer
      const successAttr = attributions.find(a => a.callRequestId === successCallId)
      expect(successAttr?.payer).toBe('customer')
      expect(successAttr?.cost).toBe(5.0)

      // Verify cost split invariant: customerCost + godaddyCost === totalCost
      expect(result.attributionResult!.customerCost + result.attributionResult!.godaddyCost).toBe(10.0)
      expect(result.attributionResult!.customerCost).toBe(5.0)
      expect(result.attributionResult!.godaddyCost).toBe(5.0)

      // Verify sessionWasFree is false because customer has costs
      expect(result.sessionWasFree).toBe(false)
    })
  })

  describe('wasUserAborted interaction', () => {
    it('skips per-call attribution when hadFailures + noValueDelivered + wasUserAborted', () => {
      // This tests the guard: !(executionData.noValueDelivered && wasUserAborted)
      // When user aborts AND no value was delivered, charge customer (their choice to abort)
      // even if there were failures - we shouldn't attribute those failures to GoDaddy
      const failedCallId = 'corr-fail-001'

      // Steps with ONLY a tool error - no successful tool results or text output
      // This means noValueDelivered will be true
      const failureOnlySteps: ExecutionStep[] = [
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': failedCallId } },
          content: [{
            type: 'tool-error' as const,
            toolName: 'bash',
            error: 'Command failed',
          }],
        },
      ] as unknown as ExecutionStep[]

      const sessionItems = [
        { callRequestId: failedCallId, cost: 5.0 },
      ]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems,
        steps: failureOnlySteps,
        wasUserAborted: true, // User chose to abort
      }

      const result = processBudgetReport(context)

      // Per-call attribution should NOT have been used
      // (because noValueDelivered && wasUserAborted bypasses the hadFailures path)
      expect(result.attributionResult).toBeUndefined()

      // Customer should pay 100% (user aborted before output)
      expect(result.sessionWasFree).toBe(false)
      expect(result.reportItems).toHaveLength(1)
      expect(result.reportItems[0]).toEqual({
        budgetCost: '5',
        productCost: '0',
        label: ReportLabel.General,
      })
    })

    it('uses per-call attribution when hadFailures + noValueDelivered but NOT wasUserAborted', () => {
      // Contrast to above: without user abort, failures with no output should be GoDaddy's fault
      const failedCallId = 'corr-fail-001'

      const failureOnlySteps: ExecutionStep[] = [
        {
          stepType: 'tool-call',
          response: { headers: { 'x-correlation-id': failedCallId } },
          content: [{
            type: 'tool-error' as const,
            toolName: 'bash',
            error: 'Command failed',
          }],
        },
      ] as unknown as ExecutionStep[]

      const sessionItems = [
        { callRequestId: failedCallId, cost: 5.0 },
      ]

      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems,
        steps: failureOnlySteps,
        wasUserAborted: false, // Agent failed on its own
      }

      const result = processBudgetReport(context)

      // noValueDelivered path should apply (100% GoDaddy)
      expect(result.sessionWasFree).toBe(true)
      expect(result.reportItems[0]).toEqual({
        budgetCost: '0',
        productCost: '5',
        label: ReportLabel.NoOutput,
      })
    })
  })

  describe('edge cases', () => {
    it('handles zero total cost', () => {
      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 0,
        sessionItems: [],
      }

      const result = processBudgetReport(context)

      expect(result.sessionWasFree).toBe(false)
      expect(result.reportItems[0]?.budgetCost).toBe('0')
    })

    it('handles assessment outcome without taskType', () => {
      const context: BudgetReportContext = {
        budgetId: 'b-1',
        sessionId: 'sess-1',
        totalCost: 5.0,
        sessionItems: createSessionItems(1, 5.0),
        assessmentOutcome: {
          result: {},
        } as AssessmentOutcome,
      }

      // Should not throw and should use default path
      const result = processBudgetReport(context)

      expect(result.reportItems).toBeDefined()
      expect(result.reportItems[0]?.label).toBe(ReportLabel.General)
    })
  })
})
