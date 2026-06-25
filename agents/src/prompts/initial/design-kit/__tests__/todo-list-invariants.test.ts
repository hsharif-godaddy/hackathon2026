import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Guards the design-kit flow's todo-list invariant at the prompt level: during the
 * flow the agent shows the brand-building journey, and the website page roadmap
 * (Homepage + pages) is a HANDOFF-time artifact created only in the Create website
 * phase — never at the start. This would have caught the historical regression where
 * the base `feature-list.md` ("call todoList with setProjectName; always start with
 * Homepage") made the agent build the website roadmap during gathering. These
 * assertions read the real prompt fragments from disk (the agent test mocks the prompt
 * builder, so the composed prompt is otherwise untested).
 */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8')

describe('design-kit prompt todo-list invariants', () => {
  it('manifest does NOT compose the base feature-list.md (no premature website roadmap)', () => {
    const manifest = JSON.parse(read('manifest.json')) as { files: Array<{ src: string; file: string }> }
    expect(manifest.files.some((f) => f.file === 'feature-list.md')).toBe(false)
  })

  it('wizard-flow brand phase creates the brand-journey list with the three phase items (before the handoff)', () => {
    const wf = read('wizard-flow.md')
    // The brand-journey list is created during kit assembly, which now runs in the
    // brand phase (the panel fills live as the agent works). It must still be created
    // before the Create-website handoff (where the separate website roadmap is built).
    const brandIdx = wf.indexOf('## Brand')
    const handoffIdx = wf.indexOf('## Create website')
    expect(brandIdx).toBeGreaterThan(0)
    expect(handoffIdx).toBeGreaterThan(brandIdx)
    const brand = wf.slice(brandIdx, handoffIdx)
    expect(brand).toContain('create_list')
    expect(brand).toContain('Building your brand')
    expect(brand).toContain('Build your brand kit')
    expect(brand).toContain('Create your brand showcase')
    expect(brand).toContain('Build your website')
  })

  it('the website roadmap (Homepage) is created ONLY at the Create website handoff, never before', () => {
    const wf = read('wizard-flow.md')
    const handoffIdx = wf.indexOf('## Create website')
    expect(handoffIdx).toBeGreaterThan(0)
    // Title-case "Homepage" is the first item of the handoff-time website roadmap; it must
    // not appear in any earlier phase (where it would mean the roadmap was built too early).
    expect(wf.slice(0, handoffIdx)).not.toContain('Homepage')
    const handoff = wf.slice(handoffIdx)
    expect(handoff).toContain('create_list')
    expect(handoff).toContain('Homepage')
  })
})
