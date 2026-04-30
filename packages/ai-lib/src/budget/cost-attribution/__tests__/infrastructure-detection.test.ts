/**
 * Infrastructure Tool Detection Tests
 */

import { describe, it, expect } from 'vitest'
import { extractInfrastructureCallIds } from '../infrastructure-detection.js'
import type { ExecutionStep, StepContentItem } from '../types.js'

// HELPERS

function createStep(content: StepContentItem[], correlationId?: string): ExecutionStep {
  return {
    content,
    response: correlationId ? { headers: { 'x-correlation-id': correlationId } } : undefined,
  }
}

function toolCall(toolName: string): StepContentItem {
  return { type: 'tool-call', toolName }
}

function toolResult(toolName: string): StepContentItem {
  return { type: 'tool-result', toolName }
}

describe('extractInfrastructureCallIds', () => {
  it('returns empty set for empty steps', () => {
    const result = extractInfrastructureCallIds([])
    expect(result.size).toBe(0)
  })

  it('returns empty set when no infrastructure tools', () => {
    const steps = [
      createStep([toolResult('edit')], 'call-1'),
      createStep([toolResult('read_file')], 'call-2'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.size).toBe(0)
  })

  it('detects suggestedResponse tool', () => {
    const steps = [
      createStep([toolResult('suggestedResponse')], 'call-1'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.has('call-1')).toBe(true)
  })

  it('detects suggested_response (snake_case variant)', () => {
    const steps = [
      createStep([toolResult('suggested_response')], 'call-1'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.has('call-1')).toBe(true)
  })

  it('detects todoList tool', () => {
    const steps = [
      createStep([toolResult('todoList')], 'call-1'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.has('call-1')).toBe(true)
  })

  it('detects todo_list (snake_case variant)', () => {
    const steps = [
      createStep([toolResult('todo_list')], 'call-1'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.has('call-1')).toBe(true)
  })

  it('handles case-insensitive matching', () => {
    const steps = [
      createStep([toolResult('SUGGESTEDRESPONSE')], 'call-1'),
      createStep([toolResult('TodoList')], 'call-2'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.has('call-1')).toBe(true)
    expect(result.has('call-2')).toBe(true)
  })

  it('detects skill-namespaced infrastructure tools', () => {
    const steps = [
      createStep([toolResult('develop__suggestedResponse')], 'call-1'),
      createStep([toolResult('initial__todoList')], 'call-2'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.has('call-1')).toBe(true)
    expect(result.has('call-2')).toBe(true)
  })

  it('detects tool-call type (not just tool-result)', () => {
    const steps = [
      createStep([toolCall('suggestedResponse')], 'call-1'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.has('call-1')).toBe(true)
  })

  it('ignores steps without correlation ID', () => {
    const steps = [
      createStep([toolResult('suggestedResponse')]), // no correlationId
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.size).toBe(0)
  })

  it('returns multiple infrastructure calls from mixed session', () => {
    const steps = [
      createStep([toolResult('edit')], 'call-1'),
      createStep([toolResult('suggestedResponse')], 'call-2'),
      createStep([toolResult('read_file')], 'call-3'),
      createStep([toolResult('todoList')], 'call-4'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.size).toBe(2)
    expect(result.has('call-2')).toBe(true)
    expect(result.has('call-4')).toBe(true)
    expect(result.has('call-1')).toBe(false)
    expect(result.has('call-3')).toBe(false)
  })

  it('does NOT detect handoff as infrastructure (it is execution flow)', () => {
    const steps = [
      createStep([toolResult('handoff')], 'call-1'),
    ]
    const result = extractInfrastructureCallIds(steps)
    expect(result.size).toBe(0)
  })
})
