import { describe, it, expect } from 'vitest'
import { referenceAITool } from '../reference.js'

// createTool exposes the handler as `.execute`; call it directly with input.
async function run(input: Record<string, unknown>): Promise<any> {
  return (referenceAITool as any).execute(input, {})
}

describe('referenceAITool', () => {
  it('list returns docs for the default corpus', async () => {
    const out = await run({ operation: 'list' })
    expect(out.ok).toBe(true)
    expect(out.corpus).toBe('template-v8')
    expect(out.docs.some((d: { path: string }) => d.path === 'routing.md')).toBe(true)
  })

  it('read returns content for a valid path', async () => {
    const out = await run({ operation: 'read', path: 'routing.md' })
    expect(out.ok).toBe(true)
    expect(out.content.length).toBeGreaterThan(0)
  })

  it('read without path returns a structured error (does not throw)', async () => {
    const out = await run({ operation: 'read' })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/path is required/)
  })

  it('search returns hits for a known keyword', async () => {
    const out = await run({ operation: 'search', query: 'sitemap' })
    expect(out.ok).toBe(true)
    expect(out.hits.length).toBeGreaterThan(0)
  })

  it('unknown corpus returns a structured error', async () => {
    const out = await run({ operation: 'list', corpus: 'nope' })
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/Unknown reference corpus/)
  })
})
