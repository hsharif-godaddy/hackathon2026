import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Guards the design-kit questioning gate: the opening pass asks only for the core missing
 * essentials (business name; business type when unclear) and defers everything else to the
 * brand phase — not the old "up to 4 questions (name, audience, location, scope)" pass.
 * Reads the real prompt fragments from disk (the agent test mocks the prompt builder, so the
 * composed prompt is otherwise untested).
 */
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8')

const questioning = read('questioning-phase1.md')
const wizardFlow = read('wizard-flow.md')

describe('design-kit questioning gate (core-only)', () => {
  it('names business name and business type as the core essentials', () => {
    expect(/\bname\b/i.test(questioning)).toBe(true)
    expect(/business type|what the business is/i.test(questioning)).toBe(true)
  })

  it('analyzes the first message and asks only for what is missing', () => {
    expect(/first message/i.test(questioning)).toBe(true)
    expect(/ask only what'?s missing/i.test(questioning)).toBe(true)
  })

  it('allows asking nothing when the essentials are already clear', () => {
    expect(/ask nothing/i.test(questioning)).toBe(true)
  })

  it('never invents a business name', () => {
    expect(/never assume one|only a name the user provides/i.test(questioning)).toBe(true)
  })

  it('drops the old up-to-4 (name, audience, location, scope) pass', () => {
    expect(/UP TO 4/i.test(questioning)).toBe(false)
    expect(wizardFlow).not.toContain('(name, audience, scope)')
  })

  it('wizard-flow gathering points at the core-only gate', () => {
    const gathering = wizardFlow.slice(wizardFlow.indexOf('## Gathering'), wizardFlow.indexOf('## Working'))
    expect(/first message|missing essentials|ask nothing/i.test(gathering)).toBe(true)
  })
})
