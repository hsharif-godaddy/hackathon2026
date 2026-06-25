import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Guards the design-kit flow's single-handoff invariant at the prompt level: the
 * agent must hand off to `develop` ONLY in the "Create website" phase ("Create my
 * website"), and do every other phase's work itself. These assertions read the real
 * prompt fragments from disk (the agent test mocks the prompt builder, so the composed
 * prompt is otherwise untested) and would have caught the historical premature-handoff
 * regression.
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

  it('wizard-flow.md mentions handoff/develop ONLY within the Create website section', () => {
    const wf = read('wizard-flow.md')
    const handoffIdx = wf.indexOf('## Create website')
    expect(handoffIdx).toBeGreaterThan(0)
    expect(HANDOFF_RE.test(wf.slice(0, handoffIdx)), 'handoff/develop must not appear before the Create website section').toBe(false)
    expect(HANDOFF_RE.test(wf.slice(handoffIdx)), 'Create website section must contain the handoff').toBe(true)
  })

  it('Create website section drives the handoff itself (agent-driven) and is not co-located with a manual showcase trigger', () => {
    const wf = read('wizard-flow.md')
    const handoff = wf.slice(wf.indexOf('## Create website'))
    // AIROBUILD-2855: the flow is now agent-driven — there are no manual "Create my
    // website" / "Build my brand showcase" buttons. The agent proceeds on its own from
    // brand → showcase → website, emitting the website phase at the handoff.
    expect(handoff).toContain('setWizardStep({ phase: "website" })')
    expect(handoff).toContain('handoff')
    // The removed button messages must not reappear (they'd re-introduce the manual flow).
    expect(handoff).not.toContain('Create my website')
    expect(handoff).not.toContain('Build my brand showcase')
  })

  it('workflow-override.md revokes the base scaffold-then-handoff workflow and names the single Create-website handoff', () => {
    const override = read('workflow-override.md')
    expect(override.toLowerCase()).toContain('does not apply')
    expect(override).toContain('Create website')
    expect(HANDOFF_RE.test(override)).toBe(true)
  })
})
