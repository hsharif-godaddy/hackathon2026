import { describe, it, expect, vi } from 'vitest'

import { resolveTurnAgent } from '../MessageExecutionService.js'

// Stand-in agent instances keyed by id; getAgent returns undefined for unknown ids.
function makeRegistry(ids: string[]): (id: string) => { id: string } | undefined {
  const map = new Map(ids.map((id) => [id, { id }]))
  return (id: string) => map.get(id)
}

const RESOLVED = 'initial-design-system-homepage-build'
const ATTACHED = `${RESOLVED}-attached`

describe('resolveTurnAgent', () => {
  it('returns the -attached sibling on the initial turn when useAttachedVariant is set', () => {
    const getAgent = makeRegistry([RESOLVED, ATTACHED])
    const agent = resolveTurnAgent({ name: RESOLVED, resolvedAgentId: RESOLVED, useAttachedVariant: true, getAgent })
    expect(agent).toEqual({ id: ATTACHED })
  })

  it('does not swap after handoff (name !== resolvedAgentId), even with useAttachedVariant', () => {
    const getAgent = vi.fn(makeRegistry([RESOLVED, ATTACHED, 'develop']))
    const agent = resolveTurnAgent({ name: 'develop', resolvedAgentId: RESOLVED, useAttachedVariant: true, getAgent })
    expect(agent).toEqual({ id: 'develop' })
    // Must not probe for an -attached sibling once we've handed off.
    expect(getAgent).not.toHaveBeenCalledWith(ATTACHED)
  })

  it('returns the normal instance when useAttachedVariant is false', () => {
    const getAgent = vi.fn(makeRegistry([RESOLVED, ATTACHED]))
    const agent = resolveTurnAgent({ name: RESOLVED, resolvedAgentId: RESOLVED, useAttachedVariant: false, getAgent })
    expect(agent).toEqual({ id: RESOLVED })
    expect(getAgent).not.toHaveBeenCalledWith(ATTACHED)
  })

  it('runs an already-attached legacy persisted agent directly without double-suffixing', () => {
    // AIROBUILD-2696 AC5: legacy rows may already store `...-attached`; they must
    // not try to resolve `...-attached-attached` when the per-turn gate is true.
    const getAgent = vi.fn(makeRegistry([ATTACHED]))
    const agent = resolveTurnAgent({ name: ATTACHED, resolvedAgentId: ATTACHED, useAttachedVariant: true, getAgent })
    expect(agent).toEqual({ id: ATTACHED })
    expect(getAgent).not.toHaveBeenCalledWith(`${ATTACHED}-attached`)
  })

  it('falls back to the resolved agent when useAttachedVariant leaks true but no sibling exists', () => {
    // AIROBUILD-2696 AC5: missing-sibling guard should prevent this call shape;
    // resolveTurnAgent also stays defensive so wizard/plain design-system turns do not crash.
    const getAgent = vi.fn(makeRegistry(['initial-design-system']))
    const agent = resolveTurnAgent({
      name: 'initial-design-system',
      resolvedAgentId: 'initial-design-system',
      useAttachedVariant: true,
      getAgent,
    })
    expect(agent).toEqual({ id: 'initial-design-system' })
  })
})
