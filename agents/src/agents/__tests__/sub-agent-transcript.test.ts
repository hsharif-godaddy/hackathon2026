import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  extractTranscript,
  extractFileAccess,
  truncateTranscript,
} from '../sub-agent-transcript.js'

function userMsg(text: string): ModelMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as ModelMessage
}
function asstMsg(text: string): ModelMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] } as ModelMessage
}

describe('extractTranscript', () => {
  it('returns [] for empty steps', () => {
    expect(extractTranscript([], 'task')).toEqual([])
  })

  it('prepends the original task as a user message before the last step response', () => {
    const steps = [{ response: { messages: [asstMsg('done')] } }]
    const out = extractTranscript(steps, 'build home page')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(userMsg('build home page'))
    expect(out[1]).toEqual(asstMsg('done'))
  })
})

describe('extractFileAccess', () => {
  it('collects unique read paths from AI SDK v6 `input`-shaped tool results', () => {
    const steps = [
      { response: { messages: [] }, toolResults: [
        { toolName: 'readFile', input: { path: 'a.tsx' }, output: {} },
        { toolName: 'readFile', input: { path: 'a.tsx' }, output: {} },
        { toolName: 'str_replace_based_edit_tool', input: { path: 'b.css' }, output: {} },
      ] },
    ]
    const reads = extractFileAccess(steps, 'read')
    expect(reads.map(r => r.path)).toEqual(['a.tsx'])
  })

  it('collects write paths and supports the file_path alias on `input`', () => {
    const steps = [
      { response: { messages: [] }, toolResults: [
        { toolName: 'str_replace_based_edit_tool', input: { file_path: 'c.tsx' }, output: {} },
      ] },
    ]
    const writes = extractFileAccess(steps, 'write')
    expect(writes.map(w => w.path)).toEqual(['c.tsx'])
  })

  it('falls back to the legacy `args` shape when `input` is absent', () => {
    const steps = [
      { response: { messages: [] }, toolResults: [
        { toolName: 'readFile', args: { path: 'legacy.tsx' }, result: {} },
      ] },
    ]
    const reads = extractFileAccess(steps, 'read')
    expect(reads.map(r => r.path)).toEqual(['legacy.tsx'])
  })
})

describe('truncateTranscript', () => {
  it('returns input unchanged when under the token cap', () => {
    const msgs = [userMsg('hi'), asstMsg('there')]
    expect(truncateTranscript(msgs)).toBe(msgs)
  })

  it('truncates to first turn + last 2 turns with an omission marker when over the cap', () => {
    const big = 'x'.repeat(200_000) // ~50k estimated tokens each
    const msgs: ModelMessage[] = []
    for (let i = 0; i < 5; i++) {
      msgs.push(userMsg(`turn ${i}`))
      msgs.push(asstMsg(big))
    }
    const out = truncateTranscript(msgs)
    expect(out.length).toBeLessThan(msgs.length)
    const omission = out.find(m => JSON.stringify(m.content).includes('Earlier conversation turns omitted'))
    expect(omission).toBeDefined()
    expect(JSON.stringify(out[0].content)).toContain('turn 0') // first turn preserved
    expect(JSON.stringify(out[out.length - 1].content)).toContain(big) // most recent assistant preserved
  })
})
