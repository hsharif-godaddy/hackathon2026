import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Guards the design-kit wizard's single-handoff invariant at the prompt level: the
 * agent must hand off to `develop` ONLY at Step 5 ("Create my website"), and do every
 * other step's work itself. These assertions read the real prompt fragments from disk
 * (the agent test mocks the prompt builder, so the composed prompt is otherwise
 * untested) and would have caught the historical premature-handoff regression.
 */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8')

// "handoff" / "hand off" / "hand-off" or the develop agent named as a handoff target.
// \bdevelop\b does not match "developer"/"development".
const HANDOFF_RE = /hand[\s-]?off|\bdevelop\b/i

describe('design-kit prompt handoff invariants', () => {
  it('manifest composes workflow-override.md immediately after the base identity.md', () => {
    const manifest = JSON.parse(read('manifest.json')) as { files: Array<{ src: string; file: string }> }
    const names = manifest.files.map((f) => f.file)
    const identityIdx = names.indexOf('identity.md')
    const overrideIdx = names.indexOf('workflow-override.md')
    expect(identityIdx).toBeGreaterThanOrEqual(0)
    expect(overrideIdx).toBe(identityIdx + 1)
  })

  it('never mentions handoff/develop in role, showcase, or questioning fragments', () => {
    for (const file of ['role.md', 'brand-showcase.md', 'questioning-phase1.md']) {
      expect(HANDOFF_RE.test(read(file)), `${file} must not reference handoff/develop`).toBe(false)
    }
  })

  it('wizard-flow.md mentions handoff/develop ONLY within the Step 5 section', () => {
    const wf = read('wizard-flow.md')
    const step5Idx = wf.indexOf('## Step 5')
    expect(step5Idx).toBeGreaterThan(0)
    expect(HANDOFF_RE.test(wf.slice(0, step5Idx)), 'handoff/develop must not appear before Step 5').toBe(false)
    expect(HANDOFF_RE.test(wf.slice(step5Idx)), 'Step 5 must contain the handoff').toBe(true)
  })

  it('Step 5 gates the handoff on the real UI trigger, not co-located with the showcase trigger', () => {
    const wf = read('wizard-flow.md')
    const step5 = wf.slice(wf.indexOf('## Step 5'))
    // The literal message the UI sends from the "Create my website" / "Skip to my
    // website" buttons (DesignKitWizard handleCreateWebsite). Gating on anything else
    // (e.g. "Create website") would never fire and convert the bug into a never-handoff.
    expect(step5).toContain('Create my website')
    // The showcase trigger must not sit beside the handoff (priming + the guard would
    // otherwise risk matching/blocking the wrong message).
    expect(step5).not.toContain('Build my brand showcase')
  })

  it('workflow-override.md revokes the base scaffold-then-handoff workflow and names the single Step-5 handoff', () => {
    const override = read('workflow-override.md')
    expect(override.toLowerCase()).toContain('does not apply')
    expect(override).toContain('Step 5')
    expect(HANDOFF_RE.test(override)).toBe(true)
  })
})
