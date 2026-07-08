import { describe, it, expect } from 'vitest'
import { validateStepDag, validateOwnedFilesDisjoint, type StepDagNode } from '../step-validation.js'

function step(overrides: Partial<StepDagNode> & { id: string }): StepDagNode {
  return { dependsOn: [], ownedFiles: [], ...overrides }
}

describe('validateStepDag', () => {
  it('accepts a well-formed DAG', () => {
    const steps: StepDagNode[] = [
      step({ id: 'a', ownedFiles: ['src/a.ts'] }),
      step({ id: 'b', dependsOn: ['a'], ownedFiles: ['src/b.ts'] }),
    ]
    expect(validateStepDag(steps)).toEqual([])
  })

  it('flags duplicate step ids', () => {
    const errors = validateStepDag([step({ id: 'a' }), step({ id: 'a' })])
    expect(errors.some(e => e.includes('Duplicate step ids: a'))).toBe(true)
  })

  it('flags a dependsOn reference to an unknown step', () => {
    const errors = validateStepDag([step({ id: 'a', dependsOn: ['ghost'] })])
    expect(errors.some(e => e.includes('dependsOn unknown step "ghost"'))).toBe(true)
  })

  it('flags a dependency cycle', () => {
    const errors = validateStepDag([
      step({ id: 'a', dependsOn: ['b'] }),
      step({ id: 'b', dependsOn: ['a'] }),
    ])
    expect(errors.some(e => e.startsWith('Dependency cycle:'))).toBe(true)
  })

  it('flags a self-dependency as a cycle', () => {
    const errors = validateStepDag([step({ id: 'a', dependsOn: ['a'] })])
    expect(errors.some(e => e.startsWith('Dependency cycle:'))).toBe(true)
  })

  it('flags an ownedFiles conflict between concurrent steps', () => {
    const errors = validateStepDag([
      step({ id: 'a', ownedFiles: ['src/shared.ts'] }),
      step({ id: 'b', ownedFiles: ['src/shared.ts'] }),
    ])
    expect(errors.some(e => e.includes('share ownedFiles: src/shared.ts'))).toBe(true)
  })

  it('allows shared ownedFiles when one step depends on the other', () => {
    const errors = validateStepDag([
      step({ id: 'a', ownedFiles: ['src/shared.ts'] }),
      step({ id: 'b', dependsOn: ['a'], ownedFiles: ['src/shared.ts'] }),
    ])
    expect(errors).toEqual([])
  })
})

describe('validateOwnedFilesDisjoint (moved, message format preserved)', () => {
  it('preserves the exact conflict message', () => {
    const errors = validateOwnedFilesDisjoint([
      { id: 'a', dependsOn: [], ownedFiles: ['x'] },
      { id: 'b', dependsOn: [], ownedFiles: ['x'] },
    ])
    expect(errors).toEqual(['Steps "a" and "b" share ownedFiles: x'])
  })
})
