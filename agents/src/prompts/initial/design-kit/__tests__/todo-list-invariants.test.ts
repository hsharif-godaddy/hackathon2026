import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Guards the design-kit wizard's todo-list invariant at the prompt level: during the
 * wizard the agent shows the brand-building journey, and the website page roadmap
 * (Homepage + pages) is a HANDOFF-time artifact created only at Step 5 — never at the
 * start. This would have caught the historical regression where the base
 * `feature-list.md` ("call todoList with setProjectName; always start with Homepage")
 * made the agent build the website roadmap at Step 2. These assertions read the real
 * prompt fragments from disk (the agent test mocks the prompt builder, so the composed
 * prompt is otherwise untested).
 */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8')

describe('design-kit prompt todo-list invariants', () => {
  it('manifest does NOT compose the base feature-list.md (no premature website roadmap)', () => {
    const manifest = JSON.parse(read('manifest.json')) as { files: Array<{ src: string; file: string }> }
    expect(manifest.files.some((f) => f.file === 'feature-list.md')).toBe(false)
  })

  it('wizard-flow Step 2 creates the brand-journey list with the three phase items', () => {
    const wf = read('wizard-flow.md')
    const step2Idx = wf.indexOf('## Step 2')
    const step3Idx = wf.indexOf('## Step 3')
    expect(step2Idx).toBeGreaterThan(0)
    expect(step3Idx).toBeGreaterThan(step2Idx)
    const step2 = wf.slice(step2Idx, step3Idx)
    expect(step2).toContain('create_list')
    expect(step2).toContain('Building your brand')
    expect(step2).toContain('Build your brand kit')
    expect(step2).toContain('Create your brand showcase')
    expect(step2).toContain('Build your website')
  })

  it('the website roadmap (Homepage) is created ONLY at the Step 5 handoff, never before', () => {
    const wf = read('wizard-flow.md')
    const step5Idx = wf.indexOf('## Step 5')
    expect(step5Idx).toBeGreaterThan(0)
    // Title-case "Homepage" is the first item of the handoff-time website roadmap; it must
    // not appear in any earlier step (where it would mean the roadmap was built too early).
    expect(wf.slice(0, step5Idx)).not.toContain('Homepage')
    const step5 = wf.slice(step5Idx)
    expect(step5).toContain('create_list')
    expect(step5).toContain('Homepage')
  })
})
