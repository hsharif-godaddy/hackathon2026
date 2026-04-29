import { describe, it, expect, vi } from 'vitest'
import {
  executeAgentLoop,
  AgentNotFoundError,
  MAX_HANDOFFS,
  type AgentExecutionLoopCallbacks,
} from '../agent-execution-loop.js'

function baseCallbacks(overrides: Partial<AgentExecutionLoopCallbacks> = {}): AgentExecutionLoopCallbacks {
  return {
    getAgent: vi.fn((_name: string) => ({ dummy: true })),
    streamAgentTurn: vi.fn(async () => {}),
    getAutoContinuation: vi.fn(() => null),
    getHandoffDetails: vi.fn(() => null),
    onHandoff: vi.fn(async () => {}),
    isAborted: vi.fn(() => false),
    ...overrides,
  }
}

describe('executeAgentLoop', () => {
  it('throws AgentNotFoundError when initial agent cannot be resolved', async () => {
    const cb = baseCallbacks({ getAgent: vi.fn(() => undefined) })
    await expect(executeAgentLoop('missing', 'hello', cb)).rejects.toBeInstanceOf(AgentNotFoundError)
  })

  it('hides agent name in error message but preserves it on the instance', async () => {
    const cb = baseCallbacks({ getAgent: vi.fn(() => undefined) })
    try {
      await executeAgentLoop('secret-agent', 'hello', cb)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentNotFoundError)
      expect((err as AgentNotFoundError).message).toBe('Agent unavailable')
      expect((err as AgentNotFoundError).agentName).toBe('secret-agent')
    }
  })

  it('returns completed when no handoff and no auto-continuation', async () => {
    const cb = baseCallbacks()
    const result = await executeAgentLoop('a1', 'msg', cb)
    expect(result).toEqual({ finalAgentName: 'a1', iterations: 1, termination: 'completed' })
    expect(cb.streamAgentTurn).toHaveBeenCalledTimes(1)
  })

  it('returns aborted when isAborted returns true at loop top (before first stream)', async () => {
    const cb = baseCallbacks({ isAborted: vi.fn(() => true) })
    const result = await executeAgentLoop('a1', 'msg', cb)
    expect(result).toEqual({ finalAgentName: 'a1', iterations: 0, termination: 'aborted' })
    expect(cb.streamAgentTurn).not.toHaveBeenCalled()
  })

  it('returns aborted when isAborted flips true after streamAgentTurn', async () => {
    let streamed = false
    const cb = baseCallbacks({
      streamAgentTurn: vi.fn(async () => { streamed = true }),
      isAborted: vi.fn(() => streamed),
    })
    const result = await executeAgentLoop('a1', 'msg', cb)
    expect(result.termination).toBe('aborted')
    expect(cb.streamAgentTurn).toHaveBeenCalledTimes(1)
    expect(cb.getAutoContinuation).not.toHaveBeenCalled()
    expect(cb.getHandoffDetails).not.toHaveBeenCalled()
  })

  it('returns aborted when isAborted flips true during postStreamValidate', async () => {
    let aborted = false
    const cb = baseCallbacks({
      postStreamValidate: vi.fn(async () => { aborted = true }),
      isAborted: vi.fn(() => aborted),
    })
    const result = await executeAgentLoop('a1', 'msg', cb)
    expect(result.termination).toBe('aborted')
    expect(cb.getAutoContinuation).not.toHaveBeenCalled()
  })

  it('returns aborted at the loop top of an auto-continuation iteration without running an extra turn', async () => {
    // Iter 0: streamAgentTurn runs; getAutoContinuation fires once and
    // primes the next iteration. Before iter 1 starts, abort flips true —
    // the loop-top isAborted check must short-circuit without a second
    // streamAgentTurn. Symmetric to the post-handoff abort test but via
    // the auto-continuation path.
    let continued = false
    const cb = baseCallbacks({
      getAutoContinuation: vi.fn(() => {
        if (continued) return null
        continued = true
        return { prompt: 'auto' }
      }),
      isAborted: vi.fn(() => continued),
    })
    const result = await executeAgentLoop('a1', 'msg', cb)
    expect(result.termination).toBe('aborted')
    expect(result.finalAgentName).toBe('a1')
    expect(cb.streamAgentTurn).toHaveBeenCalledTimes(1)
  })

  it('auto-continuation takes precedence over handoff and skips getHandoffDetails', async () => {
    // Return auto-continuation ONLY on iteration 0, and a handoff on every
    // iteration. If the `continue` guard in the loop is ever removed,
    // handoff fires on iteration 0 and the second streamAgentTurn runs the
    // handoff target ('other') instead of the auto-continuation prompt.
    let calls = 0
    // Handoff returns non-null on iterations 0 and 1, null afterwards. If the
    // `continue` guard is ever removed, iteration 0 would fall through and run
    // handoff too — pushing agentName to 'other' and overwriting the auto-
    // continuation prompt. The `secondStream` assertions pin that behavior;
    // bounded `calls <= 2` keeps the loop at 3 iterations so we can also
    // assert the terminal state without running to MAX_HANDOFFS.
    const getAutoContinuation = vi.fn(() => calls === 1 ? { prompt: 'continue please' } : null)
    const getHandoffDetails = vi.fn(() => calls <= 2 ? ({ newAgentName: 'other', handoffPrompt: 'hand off' }) : null)
    const cb = baseCallbacks({
      streamAgentTurn: vi.fn(async () => { calls++ }),
      getAutoContinuation,
      getHandoffDetails,
    })
    const result = await executeAgentLoop('a1', 'msg', cb)
    // Iteration 0 (calls 0->1): auto-continue wins, handoff SKIPPED.
    // Iteration 1 (calls 1->2): auto-continue null, handoff fires to 'other'.
    // Iteration 2 (calls 2->3): handoff null, terminates completed.
    const firstStream = (cb.streamAgentTurn as any).mock.calls[0]
    const secondStream = (cb.streamAgentTurn as any).mock.calls[1]
    expect(firstStream[1]).toBe('a1')
    expect(firstStream[2]).toBe('msg')
    // The guard is what makes the SECOND call still on 'a1' with the auto prompt,
    // not on 'other' with the handoff prompt.
    expect(secondStream[1]).toBe('a1')
    expect(secondStream[2]).toBe('continue please')
    // After iter1 consumes the continuation and the handoff to 'other' fires,
    // iter2 must receive the handoff prompt. If `currentMessage` accidentally
    // reverted to the original 'msg' after the auto-continuation branch, the
    // third call's message would be 'msg' — catch that regression here.
    const thirdStream = (cb.streamAgentTurn as any).mock.calls[2]
    expect(thirdStream[1]).toBe('other')
    expect(thirdStream[2]).toBe('hand off')
    expect(result.termination).toBe('completed')
    expect(result.iterations).toBe(3)
  })

  it('invokes onHandoff and swaps agent + message', async () => {
    let handoffFired = false
    const cb = baseCallbacks({
      getAgent: vi.fn((name) => ({ name })),
      getHandoffDetails: vi.fn(() => handoffFired ? null : (handoffFired = true, { newAgentName: 'b', handoffPrompt: 'go' })),
    })
    const result = await executeAgentLoop('a', 'hi', cb)
    expect(result.finalAgentName).toBe('b')
    expect(cb.onHandoff).toHaveBeenCalledWith('a', 'b')
    const secondCall = (cb.streamAgentTurn as any).mock.calls[1]
    // First arg is the agent object returned by getAgent for the NEW name,
    // not the stale pre-handoff object. Pins that the loop re-resolves the
    // agent after each handoff rather than reusing a captured reference.
    expect(secondCall[0]).toEqual({ name: 'b' })
    expect(secondCall[1]).toBe('b')
    expect(secondCall[2]).toBe('go')
  })

  it('passes the post-handoff agent name to postStreamValidate on the next iteration', async () => {
    // After iter 0 hands off from 'a' → 'b', iter 1's postStreamValidate
    // must receive 'b' (the new agent name), not 'a' captured by closure.
    let handoffFired = false
    const cb = baseCallbacks({
      getHandoffDetails: vi.fn(() => {
        if (handoffFired) return null
        handoffFired = true
        return { newAgentName: 'b', handoffPrompt: 'go' }
      }),
      postStreamValidate: vi.fn(async () => {}),
    })
    await executeAgentLoop('a', 'hi', cb)
    const validatorCalls = (cb.postStreamValidate as any).mock.calls
    expect(validatorCalls).toHaveLength(2)
    expect(validatorCalls[0][0]).toBe('a')
    expect(validatorCalls[1][0]).toBe('b')
  })

  it('returns finalAgentName as the handoff target when aborted at the top of a post-handoff iteration', async () => {
    // After iteration 0 commits a handoff to 'b', the loop should reflect
    // 'b' in `finalAgentName` even when the abort check at the next loop
    // top fires before streamAgentTurn runs. If a future refactor moves the
    // agentName assignment past the loop-top guard, this test would catch
    // the silent revert to 'a'.
    let handoffFired = false
    const cb = baseCallbacks({
      getHandoffDetails: vi.fn(() => {
        if (handoffFired) return null
        handoffFired = true
        return { newAgentName: 'b', handoffPrompt: 'go' }
      }),
      isAborted: vi.fn(() => handoffFired),
    })
    const result = await executeAgentLoop('a', 'hi', cb)
    expect(result.termination).toBe('aborted')
    expect(result.finalAgentName).toBe('b')
    expect(cb.streamAgentTurn).toHaveBeenCalledTimes(1)
  })

  it('throws AgentNotFoundError when a handoff target cannot be resolved mid-loop', async () => {
    const agents: Record<string, unknown> = { a: { id: 'a' } }
    let handoffFired = false
    const cb = baseCallbacks({
      getAgent: vi.fn((name) => agents[name]),
      getHandoffDetails: vi.fn(() => {
        if (handoffFired) return null
        handoffFired = true
        return { newAgentName: 'b', handoffPrompt: 'go' }
      }),
    })
    try {
      await executeAgentLoop('a', 'start', cb)
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AgentNotFoundError)
      expect((err as AgentNotFoundError).agentName).toBe('b')
    }
    expect(cb.onHandoff).toHaveBeenCalledWith('a', 'b')
  })

  it('propagates rejection from streamAgentTurn and skips subsequent callbacks', async () => {
    const err = new Error('stream crashed')
    const cb = baseCallbacks({
      streamAgentTurn: vi.fn(async () => { throw err }),
    })
    await expect(executeAgentLoop('a', 'msg', cb)).rejects.toBe(err)
    expect(cb.getAutoContinuation).not.toHaveBeenCalled()
    expect(cb.getHandoffDetails).not.toHaveBeenCalled()
  })

  it('passes iteration index 0 initially and increments on handoff / auto-continue', async () => {
    let fired = 0
    const cb = baseCallbacks({
      getAutoContinuation: vi.fn(() => fired === 1 ? (fired++, { prompt: 'auto' }) : null),
      getHandoffDetails: vi.fn(() => fired === 0 ? (fired++, { newAgentName: 'b', handoffPrompt: 'go' }) : null),
    })
    const result = await executeAgentLoop('a', 'm', cb)
    expect(result.iterations).toBe(3)
    const iterations = (cb.streamAgentTurn as any).mock.calls.map((c: any[]) => c[3])
    expect(iterations).toEqual([0, 1, 2])
  })

  it('exports MAX_HANDOFFS matching the internal cap', async () => {
    expect(MAX_HANDOFFS).toBe(10)
    const cb = baseCallbacks({
      getHandoffDetails: vi.fn(() => ({ newAgentName: 'next', handoffPrompt: 'continue' })),
    })
    const result = await executeAgentLoop('a', 'm', cb)
    expect(result.iterations).toBe(MAX_HANDOFFS)
    expect(result.termination).toBe('max_handoffs')
    // finalAgentName is the last handoff target (not the initial agent) —
    // callers use it to update routing state after the cap is hit.
    expect(result.finalAgentName).toBe('next')
  })

  it('propagates rejection from onHandoff', async () => {
    const handoffError = new Error('DB write failed')
    let fired = false
    const cb = baseCallbacks({
      getHandoffDetails: vi.fn(() => fired ? null : ((fired = true), { newAgentName: 'b', handoffPrompt: 'go' })),
      onHandoff: vi.fn(async () => { throw handoffError }),
    })
    await expect(executeAgentLoop('a', 'hi', cb)).rejects.toBe(handoffError)
  })

  it('propagates rejection from postStreamValidate', async () => {
    const err = new Error('validator crashed')
    const cb = baseCallbacks({ postStreamValidate: vi.fn(async () => { throw err }) })
    await expect(executeAgentLoop('a', 'msg', cb)).rejects.toBe(err)
  })

  it('returns max_handoffs after 10 iterations without running an 11th turn', async () => {
    const cb = baseCallbacks({
      getHandoffDetails: vi.fn(() => ({ newAgentName: 'next', handoffPrompt: 'continue' })),
    })
    const result = await executeAgentLoop('a', 'm', cb)
    expect(result.termination).toBe('max_handoffs')
    expect(result.iterations).toBe(10)
    expect(cb.streamAgentTurn).toHaveBeenCalledTimes(10)
  })
})
