import { describe, it, expect } from 'vitest'
import { resolveTemplateContext } from '../template-context.js'

describe('resolveTemplateContext (corpus-backed)', () => {
  it('none mode returns empty string', async () => {
    expect(await resolveTemplateContext({ mode: 'none' })).toBe('')
  })

  it('summary mode returns summary.md content', async () => {
    const out: string = await resolveTemplateContext({ mode: 'summary' })
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('Stack Overview')
  })

  it('listing mode lists corpus filenames', async () => {
    const out: string = await resolveTemplateContext({ mode: 'listing' })
    expect(out).toContain('- routing.md')
    expect(out).toContain('- api.md')
  })

  it('files mode returns requested doc content', async () => {
    const out: string = await resolveTemplateContext({ mode: 'files', paths: ['media-slots.md'] })
    expect(out.length).toBeGreaterThan(0)
  })

  it('files mode skips missing docs without throwing', async () => {
    const out: string = await resolveTemplateContext({ mode: 'files', paths: ['nope.md'] })
    expect(out).toBe('')
  })
})
