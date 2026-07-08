import { describe, it, expect } from 'vitest'
import { createTool } from '@airo/ai-lib'
import { WorkflowInitResultSchema } from '../workflow-schemas.js'

const baseStep = {
  title: 'Foundation',
  type: 'auto' as const,
  dependsOn: [] as string[],
  ownedFiles: ['src/app.tsx'],
  verify: [{ kind: 'files_exist' as const, spec: 'src/app.tsx' }],
}

const validDag = {
  archetype: 'site' as const,
  northStar: { goals: ['launch'], audience: 'smbs', voice: 'friendly' },
  steps: [{ ...baseStep, id: 'foundation' }],
}

function issueMessages(result: ReturnType<typeof WorkflowInitResultSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((issue): string => issue.message)
}

describe('WorkflowInitResultSchema', () => {
  it('accepts a shape- and DAG-valid payload', () => {
    expect(WorkflowInitResultSchema.safeParse(validDag).success).toBe(true)
  })

  it('rejects a shape-invalid payload', () => {
    expect(WorkflowInitResultSchema.safeParse({ archetype: 'nope' }).success).toBe(false)
  })

  it('rejects a shape-valid DAG with conflicting ownedFiles (semantic gate)', () => {
    const result = WorkflowInitResultSchema.safeParse({
      ...validDag,
      steps: [
        { ...baseStep, id: 'a', ownedFiles: ['src/shared.ts'] },
        { ...baseStep, id: 'b', ownedFiles: ['src/shared.ts'] },
      ],
    })
    expect(result.success).toBe(false)
    expect(issueMessages(result).some((m): boolean => m.includes('share ownedFiles'))).toBe(true)
  })

  it('rejects a shape-valid DAG with a dependency cycle', () => {
    const result = WorkflowInitResultSchema.safeParse({
      ...validDag,
      steps: [
        { ...baseStep, id: 'a', dependsOn: ['b'] },
        { ...baseStep, id: 'b', dependsOn: ['a'] },
      ],
    })
    expect(result.success).toBe(false)
    expect(issueMessages(result).some((m): boolean => m.includes('Dependency cycle'))).toBe(true)
  })

  it('rejects a shape-valid DAG with a dangling dependsOn', () => {
    const result = WorkflowInitResultSchema.safeParse({
      ...validDag,
      steps: [{ ...baseStep, id: 'a', dependsOn: ['ghost'] }],
    })
    expect(result.success).toBe(false)
    expect(issueMessages(result).some((m): boolean => m.includes('unknown step'))).toBe(true)
  })

  it('rejects a shape-valid DAG with duplicate step ids', () => {
    const result = WorkflowInitResultSchema.safeParse({
      ...validDag,
      steps: [
        { ...baseStep, id: 'dup' },
        { ...baseStep, id: 'dup', ownedFiles: ['src/other.tsx'] },
      ],
    })
    expect(result.success).toBe(false)
    expect(issueMessages(result).some((m): boolean => m.includes('Duplicate step ids'))).toBe(true)
  })
})

// Proves the semantic refinement is enforced through ai-lib's tool-input wrapper
// (the returnResult path in SubAgentRunner), not only via a direct safeParse — so a
// future ai-lib/SDK/Zod change that stopped running it would fail here.
describe('WorkflowInitResultSchema enforced through createTool (AI SDK tool-input path)', () => {
  const returnTool = createTool(
    'Return the workflow-init DAG.',
    WorkflowInitResultSchema,
    async (input: unknown): Promise<unknown> => input,
  )
  const schema = returnTool.inputSchema as unknown as {
    jsonSchema: { type?: string; properties?: Record<string, unknown> }
    validate: (value: unknown) => Promise<{ success: boolean }> | { success: boolean }
  }

  it('generates an object JSON schema for the model (the custom refinement does not break tool registration)', () => {
    expect(schema.jsonSchema.type).toBe('object')
    expect(schema.jsonSchema.properties).toHaveProperty('steps')
  })

  it('accepts a valid DAG through the tool-input validator', async () => {
    expect((await schema.validate(validDag)).success).toBe(true)
  })

  it('rejects a shape-invalid payload through the tool-input validator', async () => {
    expect((await schema.validate({ archetype: 'nope' })).success).toBe(false)
  })

  it('rejects a shape-valid but semantically-invalid DAG (refinement fires on the tool path)', async () => {
    // One semantic case is enough here — the full DAG-rule matrix is covered by the
    // schema-level safeParse tests above and step-validation.test.ts. This only needs
    // to prove the refinement runs through the tool-input validator at all.
    const conflicting = {
      ...validDag,
      steps: [
        { ...baseStep, id: 'a', ownedFiles: ['src/shared.ts'] },
        { ...baseStep, id: 'b', ownedFiles: ['src/shared.ts'] },
      ],
    }
    expect((await schema.validate(conflicting)).success).toBe(false)
  })
})
