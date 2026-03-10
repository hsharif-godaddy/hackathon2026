import { describe, it, expect } from 'vitest'

import { hasSuccessfulToolCall } from '../agent-factory.js'

function makeStep(content: Array<{ type: string; toolName?: string; toolCallId?: string }>) {
  return { content }
}

describe('hasSuccessfulToolCall', function hasSuccessfulToolCallTests() {
  it('should return true when tool-call has a matching tool-result', function successfulCall() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({
      steps: [makeStep([
        { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-1' },
        { type: 'tool-result', toolCallId: 'call-1' }
      ])]
    })

    expect(result).toBe(true)
  })

  it('should return false when tool-call has a matching tool-error', function failedCall() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({
      steps: [makeStep([
        { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-1' },
        { type: 'tool-error', toolCallId: 'call-1' }
      ])]
    })

    expect(result).toBe(false)
  })

  it('should return false when no matching tool-call exists', function noMatchingCall() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({
      steps: [makeStep([
        { type: 'tool-call', toolName: 'otherTool', toolCallId: 'call-1' },
        { type: 'tool-result', toolCallId: 'call-1' }
      ])]
    })

    expect(result).toBe(false)
  })

  it('should return false when tool-call has neither result nor error', function pendingCall() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({
      steps: [makeStep([
        { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-1' }
      ])]
    })

    expect(result).toBe(false)
  })

  it('should return false with empty steps', function emptySteps() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({ steps: [] })

    expect(result).toBe(false)
  })

  it('should return true when earlier step succeeded even if later step errored', function multipleSteps() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({
      steps: [
        makeStep([
          { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-1' },
          { type: 'tool-result', toolCallId: 'call-1' }
        ]),
        makeStep([
          { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-2' },
          { type: 'tool-error', toolCallId: 'call-2' }
        ])
      ]
    })

    expect(result).toBe(true)
  })

  it('should return false when all steps have errors', function allStepsErrored() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({
      steps: [
        makeStep([
          { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-1' },
          { type: 'tool-error', toolCallId: 'call-1' }
        ]),
        makeStep([
          { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-2' },
          { type: 'tool-error', toolCallId: 'call-2' }
        ])
      ]
    })

    expect(result).toBe(false)
  })

  it('should not match tool-result from a different tool-call', function differentCallId() {
    const stopCondition = hasSuccessfulToolCall('askQuestion')
    const result = stopCondition({
      steps: [makeStep([
        { type: 'tool-call', toolName: 'askQuestion', toolCallId: 'call-1' },
        { type: 'tool-result', toolCallId: 'call-2' }
      ])]
    })

    expect(result).toBe(false)
  })
})
