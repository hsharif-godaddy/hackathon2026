import { describe, expect, it } from 'vitest'

import { buildScript, parseEnvelope, parseEnvelopeJson } from '../runner.js'

/** Encode a JSON string the way the shim does: base64 across `__TURNSCRIPT_CHUNK <i>/<n> <data>` lines. */
function chunked(json: string, chunkLen = 3900): string {
  const b64 = Buffer.from(json, 'utf8').toString('base64')
  const total = Math.max(1, Math.ceil(b64.length / chunkLen))
  let out = ''
  for (let i = 0; i < total; i++) out += `__TURNSCRIPT_CHUNK ${i}/${total} ${b64.slice(i * chunkLen, (i + 1) * chunkLen)}\n`
  return out
}

describe('turnscript runner envelope parsing', () => {
  it('parses a valid single-chunk envelope from stdout', () => {
    const stdout = chunked(JSON.stringify({ ok: true, result: 'done', dispatches: [], logs: [] }))
    const parsed = parseEnvelope(stdout, '', false)
    expect(parsed.ok).toBe(true)
    expect(parsed.result).toBe('done')
  })

  it('surfaces editedPaths from the envelope and filters non-string entries', () => {
    const stdout = chunked(JSON.stringify({
      ok: true, result: 'done', dispatches: [], logs: [],
      editedPaths: ['src/pages/index.tsx', 42, 'src/components/Hero.tsx', null],
    }))
    const parsed = parseEnvelope(stdout, '', false)
    expect(parsed.editedPaths).toEqual(['src/pages/index.tsx', 'src/components/Hero.tsx'])
  })

  it('defaults editedPaths to [] when the envelope omits it', () => {
    const stdout = chunked(JSON.stringify({ ok: true, result: 'done', dispatches: [], logs: [] }))
    expect(parseEnvelope(stdout, '', false).editedPaths).toEqual([])
  })

  it('reassembles a multi-chunk (large) envelope intact', () => {
    const big = 'Q'.repeat(20000)
    const stdout = chunked(JSON.stringify({ ok: true, result: big, dispatches: [], logs: [] }))
    expect(stdout.split('\n').filter(Boolean).length).toBeGreaterThan(1) // genuinely multi-chunk
    const parsed = parseEnvelope(stdout, '', false)
    expect(parsed.ok).toBe(true)
    expect(parsed.result).toBe(big)
  })

  it('preserves a script-level failure envelope transported over stdout', () => {
    const stdout = chunked(JSON.stringify({ ok: false, result: null, error: 'boom', failureKind: 'runtime_throw', dispatches: [], logs: [] }))
    const parsed = parseEnvelope(stdout, '', false)
    expect(parsed.ok).toBe(false)
    expect(parsed.failureKind).toBe('runtime_throw')
    expect(parsed.error).toBe('boom')
  })

  it('classifies a truncated chunk set as result_unreadable, not a recoverable failure', () => {
    const lines = chunked(JSON.stringify({ ok: true, result: 'X'.repeat(20000), dispatches: [], logs: [] }))
      .split('\n').filter(Boolean)
    const truncated = lines.slice(0, -1).join('\n') + '\n' // drop the last chunk
    const parsed = parseEnvelope(truncated, '', false)
    expect(parsed.ok).toBe(false)
    expect(parsed.failureKind).toBe('result_unreadable')
  })

  it('classifies a timeout with no envelope as timeout', () => {
    expect(parseEnvelope('', '', true).failureKind).toBe('timeout')
  })

  it('classifies a SyntaxError on stderr (no envelope) as compile', () => {
    expect(parseEnvelope('', 'SyntaxError: Unexpected token }', false).failureKind).toBe('compile')
  })

  it('classifies arbitrary stderr (no envelope) as runtime_throw', () => {
    expect(parseEnvelope('', 'Error: something blew up', false).failureKind).toBe('runtime_throw')
  })

  it('parseEnvelopeJson returns null on malformed JSON', () => {
    expect(parseEnvelopeJson('{not valid json')).toBeNull()
  })

  it('parseEnvelopeJson normalizes a valid envelope', () => {
    const parsed = parseEnvelopeJson(JSON.stringify({ ok: true, result: 'r' }))
    expect(parsed).toMatchObject({ ok: true, result: 'r', logs: [], dispatches: [] })
  })

  // --- untrusted-envelope validation (the envelope is emitted by a model-authored script) ---

  it('coerces an unknown/spoofed failureKind on failure to runtime_throw', () => {
    const parsed = parseEnvelopeJson(JSON.stringify({ ok: false, error: 'x', failureKind: 'totally-bogus' }))
    expect(parsed?.failureKind).toBe('runtime_throw')
  })

  it('keeps a valid failureKind on failure', () => {
    expect(parseEnvelopeJson(JSON.stringify({ ok: false, failureKind: 'compile' }))?.failureKind).toBe('compile')
  })

  it('drops failureKind when ok is true even if one is present', () => {
    expect(parseEnvelopeJson(JSON.stringify({ ok: true, failureKind: 'compile' }))?.failureKind).toBeUndefined()
  })

  it('filters malformed dispatch elements, keeping only well-shaped records', () => {
    const valid = { tool: 'readFile', ms: 5, ok: true, status: 'ok', resultBytes: 10 }
    const parsed = parseEnvelopeJson(JSON.stringify({ ok: true, dispatches: [valid, 5, null, { tool: 'x' }, 'str'] }))
    expect(parsed?.dispatches).toEqual([valid])
  })

  it('coerces non-array logs/dispatches and a non-string error to safe defaults', () => {
    const parsed = parseEnvelopeJson(JSON.stringify({ ok: false, error: 123, logs: 'nope', dispatches: 7 }))
    expect(parsed?.logs).toEqual([])
    expect(parsed?.dispatches).toEqual([])
    expect(parsed?.error).toBeUndefined()
  })
})

describe('turnscript buildScript (TS→JS transpile)', () => {
  it('strips TypeScript type annotations from the user script', async () => {
    const script = await buildScript('async () => { const n: number = 1; return n }')
    expect(script).toContain('globalThis.__turnscriptUserFn')
    expect(script).toContain('const n = 1')
    expect(script).not.toContain('n: number')
  })

  it('passes plain JS through and wraps it as the user fn', async () => {
    const script = await buildScript('async () => 42')
    expect(script).toContain('globalThis.__turnscriptUserFn')
    expect(script).toContain('42')
  })

  it('falls back gracefully (never throws, still wraps) on a TS syntax error', async () => {
    // transpile must return the source unchanged on a genuine syntax error so the in-container
    // node surfaces the real error rather than turning a runnable script into an un-runnable one.
    const script = await buildScript('async () => { return ((( }')
    expect(typeof script).toBe('string')
    expect(script).toContain('globalThis.__turnscriptUserFn')
  })
})
