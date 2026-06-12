import { describe, it, expect } from 'vitest'
import { buildContinuationMessage } from '../sub-agent-runner.js'

describe('buildContinuationMessage', () => {
  it('returns the bare task when no files are stale', () => {
    expect(buildContinuationMessage('fix contrast', [])).toBe('fix contrast')
  })

  it('prepends a re-read warning listing stale files', () => {
    const msg = buildContinuationMessage('fix contrast', ['src/a.css', 'src/b.tsx'])
    expect(msg).toContain('src/a.css')
    expect(msg).toContain('src/b.tsx')
    expect(msg.toLowerCase()).toContain('re-read')
    expect(msg).toContain('fix contrast')
  })
})
