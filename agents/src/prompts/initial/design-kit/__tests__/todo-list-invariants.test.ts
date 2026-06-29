import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Guards the design-kit flow's todo-list invariant at the prompt level: during the
 * flow the agent shows the brand-building journey, and the website page roadmap
 * (Homepage + pages) is a Create-website-phase artifact created only in that phase —
 * never at the start. This would have caught the historical regression where
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

  it('wizard-flow gathering creates the brand-journey list once (after the name), not again in the brand phase', () => {
    const wf = read('wizard-flow.md')
    // AIROBUILD-2871: the project name + brand-journey list are set ONCE during
    // gathering, right after the name is known — not re-created in the brand phase
    // (which caused a duplicate setProjectName + a late todo list).
    const gatheringIdx = wf.indexOf('## Gathering')
    const brandIdx = wf.indexOf('## Brand')
    const websiteIdx = wf.indexOf('## Create website')
    expect(gatheringIdx).toBeGreaterThanOrEqual(0)
    expect(brandIdx).toBeGreaterThan(gatheringIdx)
    const gathering = wf.slice(gatheringIdx, brandIdx)
    expect(gathering).toContain('setProjectName')
    expect(gathering).toContain('create_list')
    expect(gathering).toContain('Building your brand')
    expect(gathering).toContain('Build your brand kit')
    expect(gathering).toContain('Create your brand showcase')
    expect(gathering).toContain('Build your website')
    // The brand phase must NOT re-create the list or re-set the name (dedup guard).
    // It may reference "the id from create_list", so match the actual creation CALL.
    const brand = wf.slice(brandIdx, websiteIdx)
    expect(brand).not.toContain('operation: "create_list"')
    expect(brand).not.toContain('setProjectName')
  })

  it('the website roadmap (Homepage) is created ONLY in the Create website phase, never before', () => {
    const wf = read('wizard-flow.md')
    const websiteIdx = wf.indexOf('## Create website')
    expect(websiteIdx).toBeGreaterThan(0)
    // Title-case "Homepage" is the first item of the website roadmap; it must
    // not appear in any earlier phase (where it would mean the roadmap was built too early).
    expect(wf.slice(0, websiteIdx)).not.toContain('Homepage')
    const website = wf.slice(websiteIdx)
    expect(website).toContain('create_list')
    expect(website).toContain('Homepage')
  })
})
