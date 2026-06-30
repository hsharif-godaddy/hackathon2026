import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildWorkflowContextMessage, extractInjectBlock } from '../workflow-context.js'
import type { WorkflowState } from '../../workflow/types.js'

vi.mock('../../workflow/workflow-store.js', () => ({
  readWorkflowState: vi.fn(),
  computeNextActions: vi.fn().mockReturnValue([]),
  withWorkflowLock: vi.fn().mockImplementation((_appId: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock('../../workflow/workflow-gate-resolver.js', () => ({
  resolveBlockedGates: vi.fn().mockResolvedValue(undefined),
  resolveInteractiveSteps: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../logging/index.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  Logger: { create: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))

vi.mock('../../reference/reference-service.js', () => ({
  readDoc: vi.fn(),
}))

const { readWorkflowState } = await import('../../workflow/workflow-store.js')
const { readDoc } = await import('../../reference/reference-service.js')
const mockReadState = vi.mocked(readWorkflowState)
const mockReadDoc = vi.mocked(readDoc)

function makeState(): WorkflowState {
  return {
    schemaVersion: 1,
    appId: 'test-app',
    archetype: 'site',
    northStar: { goals: ['test'], audience: 'testers', voice: 'neutral' },
    steps: [
      { id: 's1', title: 'Step 1', type: 'auto', status: 'done', dependsOn: [], ownedFiles: [], verify: [] },
    ],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

describe('buildWorkflowContextMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('injects archetype guidance when inject markers exist', async () => {
    mockReadState.mockResolvedValue(makeState())
    mockReadDoc.mockResolvedValue(
      '# Site\n\nSome content\n\n<!-- inject-start -->\nBuild unit: pages.\nParallelism: high.\n<!-- inject-end -->\n\nMore content'
    )

    const result = await buildWorkflowContextMessage('test-app')
    expect(result).not.toBeNull()
    expect(result!.content).toContain('<archetype_guidance type="site">')
    expect(result!.content).toContain('Build unit: pages.')
    expect(result!.content).toContain('Parallelism: high.')
    expect(result!.content).toContain('</archetype_guidance>')
    expect(mockReadDoc).toHaveBeenCalledWith('archetypes/site.md', 'deep-build')
  })

  it('omits archetype guidance when no inject markers', async () => {
    mockReadState.mockResolvedValue({ ...makeState(), archetype: 'custom' })
    mockReadDoc.mockResolvedValue('# Custom\n\nNo markers here.')

    const result = await buildWorkflowContextMessage('test-app')
    expect(result).not.toBeNull()
    expect(result!.content).not.toContain('<archetype_guidance')
  })

  it('omits archetype guidance on readDoc failure (graceful)', async () => {
    mockReadState.mockResolvedValue(makeState())
    mockReadDoc.mockRejectedValue(new Error('file not found'))

    const result = await buildWorkflowContextMessage('test-app')
    expect(result).not.toBeNull()
    expect(result!.content).not.toContain('<archetype_guidance')
    expect(result!.content).toContain('workflow_steps')
  })

  it('returns null when no workflow state', async () => {
    mockReadState.mockResolvedValue(null)
    const result = await buildWorkflowContextMessage('test-app')
    expect(result).toBeNull()
  })

  it('constructs correct path for app archetype', async () => {
    mockReadState.mockResolvedValue({ ...makeState(), archetype: 'app' })
    mockReadDoc.mockResolvedValue('# App\n<!-- inject-start -->\nBuild unit: features.\n<!-- inject-end -->')

    const result = await buildWorkflowContextMessage('test-app')
    expect(mockReadDoc).toHaveBeenCalledWith('archetypes/app.md', 'deep-build')
    expect(result!.content).toContain('<archetype_guidance type="app">')
    expect(result!.content).toContain('Build unit: features.')
  })
})

describe('extractInjectBlock', () => {
  it('extracts content between markers', () => {
    const content: string = '# Title\n\n<!-- inject-start -->\nLine 1.\nLine 2.\n<!-- inject-end -->\n\nMore.'
    const result: string | null = extractInjectBlock(content)
    expect(result).toBe('Line 1.\nLine 2.')
  })

  it('returns null when no markers present', () => {
    const result: string | null = extractInjectBlock('# No markers here')
    expect(result).toBeNull()
  })

  it('returns null when only start marker present', () => {
    const result: string | null = extractInjectBlock('<!-- inject-start -->\nContent but no end')
    expect(result).toBeNull()
  })

  it('returns null when only end marker present', () => {
    const result: string | null = extractInjectBlock('Content\n<!-- inject-end -->')
    expect(result).toBeNull()
  })

  it('returns null when end marker comes before start marker', () => {
    const result: string | null = extractInjectBlock('<!-- inject-end -->\nContent\n<!-- inject-start -->')
    expect(result).toBeNull()
  })

  it('returns null (empty string trimmed to empty) when markers are adjacent', () => {
    const content: string = '<!-- inject-start --><!-- inject-end -->'
    const result: string | null = extractInjectBlock(content)
    expect(result).toBe('')
  })

  it('trims whitespace from extracted content', () => {
    const content: string = '<!-- inject-start -->\n\n  Indented content.  \n\n<!-- inject-end -->'
    const result: string | null = extractInjectBlock(content)
    expect(result).toBe('Indented content.')
  })

  it('extracts only from first occurrence of markers', () => {
    const content: string = '<!-- inject-start -->\nFirst block.\n<!-- inject-end -->\n<!-- inject-start -->\nSecond block.\n<!-- inject-end -->'
    const result: string | null = extractInjectBlock(content)
    expect(result).toBe('First block.')
  })
})
