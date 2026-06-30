import { describe, it, expect } from 'vitest'
import { listDocs, readDoc, searchDocs } from '../reference-service.js'

describe('reference-service (template-v8 corpus)', () => {
  it('listDocs returns all 7 docs with titles', async () => {
    const docs = await listDocs()
    const paths: string[] = docs.map((d) => d.path).sort()
    expect(paths).toEqual(
      ['api.md', 'components.md', 'layouts.md', 'media-slots.md', 'routing.md', 'summary.md', 'tech-stack.md']
    )
    expect(docs.every((d) => d.title.length > 0)).toBe(true)
  })

  it('readDoc returns markdown content for a valid path', async () => {
    const content: string = await readDoc('routing.md')
    expect(content).toContain('#')
    expect(content.length).toBeGreaterThan(0)
  })

  it('readDoc rejects traversal, absolute, and non-md paths', async () => {
    await expect(readDoc('../secret.md')).rejects.toThrow(/\.\./)
    await expect(readDoc('/etc/passwd')).rejects.toThrow(/absolute/)
    await expect(readDoc('routing.txt')).rejects.toThrow(/\.md/)
  })

  it('readDoc throws on unknown corpus', async () => {
    await expect(readDoc('routing.md', 'does-not-exist')).rejects.toThrow(/Unknown reference corpus/)
  })

  it('searchDocs finds a known keyword and returns snippets', async () => {
    const hits = await searchDocs('sitemap')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.path === 'routing.md')).toBe(true)
    expect(hits[0]!.snippets.length).toBeGreaterThan(0)
  })

  it('searchDocs rejects empty query', async () => {
    await expect(searchDocs('   ')).rejects.toThrow(/query/)
  })
})

describe('reference-service (deep-build corpus)', () => {
  it('listDocs returns nested docs with relative paths', async () => {
    const docs = await listDocs('deep-build')
    const paths: string[] = docs.map((d) => d.path).sort()
    expect(paths).toContain('summary.md')
    expect(paths).toContain('archetypes/site.md')
    expect(paths).toContain('archetypes/app.md')
    expect(paths).toContain('archetypes/game.md')
    expect(paths).toContain('archetypes/custom.md')
    expect(paths).toContain('step-planning.md')
    expect(docs.every((d) => d.title.length > 0)).toBe(true)
  })

  it('readDoc reads nested archetype doc', async () => {
    const content: string = await readDoc('archetypes/site.md', 'deep-build')
    expect(content).toContain('# ')
    expect(content.length).toBeGreaterThan(0)
  })

  it('searchDocs searches nested files', async () => {
    const hits = await searchDocs('parallelism', 'deep-build')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.path.startsWith('archetypes/'))).toBe(true)
  })
})
