import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import { buildSessionTranscript } from '../sub-agent-runner.js'

function asst(text: string): ModelMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] } as ModelMessage
}

const steps = [
  {
    response: { messages: [asst('built the page')] },
    toolResults: [
      { toolName: 'readFile', args: { path: 'src/a.tsx' }, result: {} },
      { toolName: 'str_replace_based_edit_tool', args: { path: 'src/b.css' }, result: {} },
    ],
  },
]

describe('buildSessionTranscript', () => {
  it('prepends the original task and captures read/write file access', () => {
    const s = buildSessionTranscript(steps, 'build home page')
    expect(s.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'build home page' }] })
    expect(s.messages[1]).toEqual(asst('built the page'))
    expect(s.filesRead.map(f => f.path)).toEqual(['src/a.tsx'])
    expect(s.filesWritten.map(f => f.path)).toEqual(['src/b.css'])
  })

  it('keeps prior messages, then the continuation user turn, then the new response', () => {
    const prior: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'original task' }] }, asst('did stuff')]
    const s = buildSessionTranscript(steps, 'follow up', prior)
    expect(s.messages.slice(0, 2)).toEqual(prior)
    // The continuation prompt must appear as its own user turn (it is passed to
    // streamGenerate separately and is NOT in response.messages).
    expect(s.messages[2]).toEqual({ role: 'user', content: [{ type: 'text', text: 'follow up' }] })
    expect(s.messages[3]).toEqual(asst('built the page'))
  })

  it('preserves every user turn across two continuations (no dropped instructions)', () => {
    // continue #1: prior = fresh-run transcript
    const firstRun = buildSessionTranscript(steps, 'build home page')
    // continue #2: feed continue #1's cached messages back in as priorMessages
    const second = buildSessionTranscript(
      [{ response: { messages: [asst('applied the fix')] } }],
      'now fix the contrast',
      firstRun.messages,
    )
    const userTexts = second.messages
      .filter(m => m.role === 'user')
      .map(m => (Array.isArray(m.content) ? (m.content[0] as { text: string }).text : m.content))
    expect(userTexts).toEqual(['build home page', 'now fix the contrast'])
  })
})
