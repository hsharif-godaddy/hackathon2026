import { describe, it, expect } from 'vitest'

import { computeNextActions, validateOwnedFilesDisjoint } from '../workflow-store.js'
import type { WorkflowStep, WorkflowState } from '../types.js'

function makeStep(overrides: Partial<WorkflowStep> & { id: string }): WorkflowStep {
  return {
    title: overrides.id,
    type: 'auto',
    status: 'pending',
    dependsOn: [],
    ownedFiles: [],
    verify: [],
    ...overrides,
  }
}

function makeState(steps: WorkflowStep[]): WorkflowState {
  return {
    schemaVersion: 1,
    appId: 'test-app',
    archetype: 'marketing-site',
    northStar: { goals: ['test'], audience: 'testers', voice: 'neutral' },
    steps,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

describe('computeNextActions', function computeNextActionsTests() {
  it('returns empty array when steps is empty', function emptySteps() {
    const state: WorkflowState = makeState([])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result).toEqual([])
  })

  it('returns a single pending step with no deps', function singlePendingNoDeps() {
    const step: WorkflowStep = makeStep({ id: 'a' })
    const state: WorkflowState = makeState([step])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a')
  })

  it('does not return a step whose dep is still pending', function unmetDep() {
    const a: WorkflowStep = makeStep({ id: 'a' })
    const b: WorkflowStep = makeStep({ id: 'b', dependsOn: ['a'] })
    const state: WorkflowState = makeState([a, b])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result.map((s: WorkflowStep) => s.id)).toEqual(['a'])
  })

  it('returns a step whose dep is done', function metDepDone() {
    const a: WorkflowStep = makeStep({ id: 'a', status: 'done' })
    const b: WorkflowStep = makeStep({ id: 'b', dependsOn: ['a'] })
    const state: WorkflowState = makeState([a, b])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result.map((s: WorkflowStep) => s.id)).toEqual(['b'])
  })

  it('returns a step whose dep is skipped', function metDepSkipped() {
    const a: WorkflowStep = makeStep({ id: 'a', status: 'skipped' })
    const b: WorkflowStep = makeStep({ id: 'b', dependsOn: ['a'] })
    const state: WorkflowState = makeState([a, b])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result.map((s: WorkflowStep) => s.id)).toEqual(['b'])
  })

  it('does not return a step that is already done', function alreadyDone() {
    const a: WorkflowStep = makeStep({ id: 'a', status: 'done' })
    const state: WorkflowState = makeState([a])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result).toEqual([])
  })

  it('does not return a step that is in_progress', function alreadyInProgress() {
    const a: WorkflowStep = makeStep({ id: 'a', status: 'in_progress' })
    const state: WorkflowState = makeState([a])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result).toEqual([])
  })

  it('returns all eligible steps when multiple are ready', function multipleEligible() {
    const a: WorkflowStep = makeStep({ id: 'a' })
    const b: WorkflowStep = makeStep({ id: 'b' })
    const c: WorkflowStep = makeStep({ id: 'c' })
    const state: WorkflowState = makeState([a, b, c])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result.map((s: WorkflowStep) => s.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns only B when chain A→B→C and A is done', function chainABC() {
    const a: WorkflowStep = makeStep({ id: 'a', status: 'done' })
    const b: WorkflowStep = makeStep({ id: 'b', dependsOn: ['a'] })
    const c: WorkflowStep = makeStep({ id: 'c', dependsOn: ['b'] })
    const state: WorkflowState = makeState([a, b, c])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result.map((s: WorkflowStep) => s.id)).toEqual(['b'])
  })

  it('returns B and C but not D in a diamond when A is done', function diamondDep() {
    const a: WorkflowStep = makeStep({ id: 'a', status: 'done' })
    const b: WorkflowStep = makeStep({ id: 'b', dependsOn: ['a'] })
    const c: WorkflowStep = makeStep({ id: 'c', dependsOn: ['a'] })
    const d: WorkflowStep = makeStep({ id: 'd', dependsOn: ['b', 'c'] })
    const state: WorkflowState = makeState([a, b, c, d])
    const result: WorkflowStep[] = computeNextActions(state)
    expect(result.map((s: WorkflowStep) => s.id).sort()).toEqual(['b', 'c'])
  })
})

describe('validateOwnedFilesDisjoint', function validateOwnedFilesDisjointTests() {
  it('returns no errors when steps have no overlapping files', function noOverlap() {
    const a: WorkflowStep = makeStep({ id: 'a', ownedFiles: ['src/a.ts'] })
    const b: WorkflowStep = makeStep({ id: 'b', ownedFiles: ['src/b.ts'] })
    const errors: string[] = validateOwnedFilesDisjoint([a, b])
    expect(errors).toEqual([])
  })

  it('reports an error for overlapping files between independent steps', function overlapIndependent() {
    const a: WorkflowStep = makeStep({ id: 'a', ownedFiles: ['src/shared.ts'] })
    const b: WorkflowStep = makeStep({ id: 'b', ownedFiles: ['src/shared.ts'] })
    const errors: string[] = validateOwnedFilesDisjoint([a, b])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('"a"')
    expect(errors[0]).toContain('"b"')
    expect(errors[0]).toContain('src/shared.ts')
  })

  it('does not report an error when overlapping steps are dependent on each other', function overlapDependent() {
    const a: WorkflowStep = makeStep({ id: 'a', ownedFiles: ['src/shared.ts'] })
    const b: WorkflowStep = makeStep({ id: 'b', dependsOn: ['a'], ownedFiles: ['src/shared.ts'] })
    const errors: string[] = validateOwnedFilesDisjoint([a, b])
    expect(errors).toEqual([])
  })

  it('reports all overlaps when multiple pairs share files', function multipleOverlaps() {
    const a: WorkflowStep = makeStep({ id: 'a', ownedFiles: ['src/x.ts', 'src/y.ts'] })
    const b: WorkflowStep = makeStep({ id: 'b', ownedFiles: ['src/x.ts'] })
    const c: WorkflowStep = makeStep({ id: 'c', ownedFiles: ['src/y.ts'] })
    const errors: string[] = validateOwnedFilesDisjoint([a, b, c])
    expect(errors).toHaveLength(2)
    const errorText: string = errors.join('\n')
    expect(errorText).toContain('"a"')
    expect(errorText).toContain('"b"')
    expect(errorText).toContain('"c"')
  })

  it('returns no errors when ownedFiles arrays are empty', function emptyOwnedFiles() {
    const a: WorkflowStep = makeStep({ id: 'a', ownedFiles: [] })
    const b: WorkflowStep = makeStep({ id: 'b', ownedFiles: [] })
    const errors: string[] = validateOwnedFilesDisjoint([a, b])
    expect(errors).toEqual([])
  })
})
