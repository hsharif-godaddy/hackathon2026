import { describe, expect, it } from 'vitest'

import { analyzeExecution, attributeSessionItems, generateReportItems } from '../index.js'
import {
  AttributionReason,
  emptyExecutionData,
  InfrastructureToolType,
  Payer,
  PatternType,
  ReportLabel,
} from '../types.js'
import type { SessionItem } from '@airo/shared/budget'
import type { ExecutionStep, StepContentItem } from '../types.js'

function createStep(content: StepContentItem[], correlationId?: string): ExecutionStep {
  return {
    content,
    response: correlationId ? { headers: { 'x-correlation-id': correlationId } } : undefined,
  }
}

function toolError(toolName: string, args?: unknown): StepContentItem {
  return { type: 'tool-error', toolName, args }
}

describe('attributeSessionItems', () => {
  it('labels todoList and suggestedResponse infrastructure costs separately', () => {
    const executionData = emptyExecutionData()
    executionData.infrastructureCalls = new Map([
      ['call-todo', InfrastructureToolType.TodoList],
      ['call-suggested', InfrastructureToolType.SuggestedResponse],
    ])

    const result = attributeSessionItems(
      [
        { callRequestId: 'call-todo', cost: 0.2 },
        { callRequestId: 'call-suggested', cost: 0.3 },
      ] satisfies SessionItem[],
      executionData,
      {
        budgetId: 'budget-1',
        sessionId: 'session-1',
      },
    )

    expect(result.customerCost).toBe(0)
    expect(result.godaddyCost).toBe(0.5)
    expect(result.labels).toEqual([
      ReportLabel.TodoListOverhead,
      ReportLabel.SuggestedResponseOverhead,
    ])
    expect(result.costsByLabel).toEqual(new Map([
      [ReportLabel.TodoListOverhead, 0.2],
      [ReportLabel.SuggestedResponseOverhead, 0.3],
    ]))
    expect(result.attributions).toMatchObject([
      {
        callRequestId: 'call-todo',
        payer: Payer.GoDaddy,
        reason: AttributionReason.InfrastructureOverhead,
        label: ReportLabel.TodoListOverhead,
      },
      {
        callRequestId: 'call-suggested',
        payer: Payer.GoDaddy,
        reason: AttributionReason.InfrastructureOverhead,
        label: ReportLabel.SuggestedResponseOverhead,
      },
    ])

    expect(generateReportItems(result)).toEqual([
      {
        budgetCost: '0',
        productCost: '0.2',
        label: ReportLabel.TodoListOverhead,
      },
      {
        budgetCost: '0',
        productCost: '0.3',
        label: ReportLabel.SuggestedResponseOverhead,
      },
    ])
  })

  it('labels failed todoList and suggestedResponse calls as infrastructure overhead', () => {
    const executionData = analyzeExecution([
      createStep([{ type: 'text', text: 'Updating the plan.' }, toolError('initial__todoList')], 'call-todo'),
      createStep([toolError('develop__suggestedResponse')], 'call-suggested'),
    ])

    const result = attributeSessionItems(
      [
        { callRequestId: 'call-todo', cost: 0.2 },
        { callRequestId: 'call-suggested', cost: 0.3 },
      ] satisfies SessionItem[],
      executionData,
      {
        budgetId: 'budget-1',
        sessionId: 'session-1',
      },
    )

    expect(result.costsByLabel).toEqual(new Map([
      [ReportLabel.TodoListOverhead, 0.2],
      [ReportLabel.SuggestedResponseOverhead, 0.3],
    ]))
    expect(result.attributions).toMatchObject([
      {
        callRequestId: 'call-todo',
        payer: Payer.GoDaddy,
        reason: AttributionReason.InfrastructureOverhead,
        label: ReportLabel.TodoListOverhead,
      },
      {
        callRequestId: 'call-suggested',
        payer: Payer.GoDaddy,
        reason: AttributionReason.InfrastructureOverhead,
        label: ReportLabel.SuggestedResponseOverhead,
      },
    ])
  })

  it('prioritizes infrastructure labels over retry pattern labels', () => {
    const executionData = emptyExecutionData()
    executionData.infrastructureCalls = new Map([
      ['call-todo-1', InfrastructureToolType.TodoList],
      ['call-todo-2', InfrastructureToolType.TodoList],
      ['call-todo-3', InfrastructureToolType.TodoList],
    ])
    executionData.patterns = [{
      type: PatternType.ToolRetry,
      severity: 0.1,
      callIds: ['call-todo-1', 'call-todo-2', 'call-todo-3'],
      details: 'todoList retry regression fixture',
    }]

    const result = attributeSessionItems(
      [
        { callRequestId: 'call-todo-1', cost: 1 },
        { callRequestId: 'call-todo-2', cost: 2 },
        { callRequestId: 'call-todo-3', cost: 3 },
      ] satisfies SessionItem[],
      executionData,
      {
        budgetId: 'budget-1',
        sessionId: 'session-1',
      },
    )

    expect(result.labels).toEqual([ReportLabel.ToolRetry, ReportLabel.TodoListOverhead])
    expect(result.costsByLabel).toEqual(new Map([[ReportLabel.TodoListOverhead, 6]]))
    expect(result.attributions).toMatchObject([
      { reason: AttributionReason.InfrastructureOverhead, label: ReportLabel.TodoListOverhead },
      { reason: AttributionReason.InfrastructureOverhead, label: ReportLabel.TodoListOverhead },
      { reason: AttributionReason.InfrastructureOverhead, label: ReportLabel.TodoListOverhead },
    ])
  })
})
