import { describe, expect, it } from 'vitest'
import { decideChunkTimeoutFinalization } from '../chunk-timeout-finalization.js'

describe('decideChunkTimeoutFinalization', () => {
  it('finish frame seen → genuine success (stop)', () => {
    expect(decideChunkTimeoutFinalization({ isFinished: true, hasContent: true }))
      .toEqual({ kind: 'finalize', finishReason: 'stop' })
    // finished but no accumulated text (e.g. tool-only step) still finalizes
    expect(decideChunkTimeoutFinalization({ isFinished: true, hasContent: false }))
      .toEqual({ kind: 'finalize', finishReason: 'stop' })
  })

  it('no finish frame but content present → soft-commit (incomplete)', () => {
    expect(decideChunkTimeoutFinalization({ isFinished: false, hasContent: true }))
      .toEqual({ kind: 'finalize', finishReason: 'incomplete' })
  })

  it('no finish frame and no content → fail fast', () => {
    expect(decideChunkTimeoutFinalization({ isFinished: false, hasContent: false }))
      .toEqual({ kind: 'fail' })
  })
})
