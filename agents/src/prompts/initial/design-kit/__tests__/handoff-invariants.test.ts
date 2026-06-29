import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Guards the design-kit flow's parallel-build invariants at the prompt level.
 * AIROBUILD-2871 replaced the single sequential handoff to `develop` with sub-agent
 * fan-out in BOTH phases: the brand phase fans out mood-imagery + logo `media`
 * sub-agents (logo with background:false so it's awaited before the website), and the
 * website phase fans out homepage + showcase `builder` sub-agents — each phase
 * awaitAgents before proceeding. These assertions read the real prompt fragments from
 * disk (the agent test mocks the prompt builder, so the composed prompt is otherwise
 * untested) and would catch a regression back to a `develop` handoff, a missing
 * fan-out, or the logo silently running in background mode.
 */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8')

// "handoff" / "hand off" / "hand-off" or the develop agent named as a handoff target.
// \bdevelop\b does not match "developer"/"development".
const HANDOFF_RE = /hand[\s-]?off|\bdevelop\b/i
// The develop AGENT specifically (\bdevelop\b), independent of the word "handoff" — the
// flow legitimately says "no handoff" in prose, so we ban the agent reference, not the word.
const DEVELOP_AGENT_RE = /\bdevelop\b/i

describe('design-kit prompt fan-out invariants (AIROBUILD-2871)', () => {
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

  it('never references the develop agent in the flow or workflow fragments', () => {
    for (const file of ['wizard-flow.md', 'workflow-override.md']) {
      expect(DEVELOP_AGENT_RE.test(read(file)), `${file} must not reference the develop agent`).toBe(false)
    }
  })

  it('wizard-flow.md brand phase fans out mood-imagery + logo media sub-agents, logo with background:false', () => {
    const wf = read('wizard-flow.md')
    const brandIdx = wf.indexOf('## Brand')
    const websiteIdx = wf.indexOf('## Create website')
    expect(brandIdx).toBeGreaterThan(0)
    expect(websiteIdx).toBeGreaterThan(brandIdx)
    const brand = wf.slice(brandIdx, websiteIdx)
    // The two slow pieces fan out to background `media` sub-agents, then awaitAgents.
    expect(brand).toContain('runAgent')
    expect(brand).toContain('agent: "media"')
    expect(brand).toContain('awaitAgents')
    // The logo MUST be generated with background:false (the whole point — wait for the
    // real logo before the website builds) and as the horizontal layout.
    expect(brand).toContain('background: false')
    expect(brand).toContain('horizontal')
  })

  it('wizard-flow.md website phase fans out a design-kit-build homepage + showcase builder, kit-driven (no plan, no handoff)', () => {
    const wf = read('wizard-flow.md')
    const sectionIdx = wf.indexOf('## Create website')
    expect(sectionIdx).toBeGreaterThan(0)
    const section = wf.slice(sectionIdx)
    // Fan-out: dispatch the kit-faithful homepage builder + the showcase builder, await both.
    expect(section).toContain('runAgent')
    expect(section).toContain('awaitAgents')
    // AIROBUILD-2871: the homepage is built by the dedicated design-kit-build sub-agent, which
    // self-loads the kit (docs/ui-kit/ + anchor.json) — the kit IS the spec, so NO plan file.
    expect(section).toContain('agent: "design-kit-build"')
    expect(section).not.toContain('docs/plans/homepage.md')
    // The showcase is a parallel `builder` sub-agent (writes public/brand-showcase.html).
    expect(section).toContain('agent: "builder"')
    expect(section).toContain('public/brand-showcase.html')
    // AIROBUILD-2855: agent-driven — the phase is emitted by the agent, no manual buttons.
    expect(section).toContain('setWizardStep({ phase: "website" })')
    // AIROBUILD-2871: the agent emits `ready` once the builds complete — that is the
    // reveal signal (not the early initialBuildComplete commit flip).
    expect(section).toContain('setWizardStep({ phase: "ready" })')
    expect(section).not.toContain('Create my website')
    expect(section).not.toContain('Build my brand showcase')
  })

  it('workflow-override.md revokes the base scaffold-then-handoff workflow and names the builder fan-out', () => {
    const override = read('workflow-override.md')
    expect(override.toLowerCase()).toContain('does not apply')
    expect(override).toContain('Create website')
    expect(override).toContain('runAgent')
    expect(override).toContain('awaitAgents')
  })
})
