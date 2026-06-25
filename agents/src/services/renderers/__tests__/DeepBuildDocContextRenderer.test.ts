import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeepBuildDocContextRenderer } from '../DeepBuildDocContextRenderer.js'

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}))

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn().mockReturnValue({ path: '/app' }),
  }; }),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { createForWorkspace } from '../../../workspace/index.js'

describe('DeepBuildDocContextRenderer', () => {
  let renderer: DeepBuildDocContextRenderer
  const mockView = vi.fn()
  const mockWrite = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    renderer = new DeepBuildDocContextRenderer()
    mockView.mockResolvedValue({ content: '# Brief\nbody', path: 'docs/x.md', lines: 2, size: 12 })
    mockWrite.mockResolvedValue({ bytesWritten: 0 })
    ;(createForWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      files: { view: mockView, write: mockWrite },
    })
  })

  const render = (names: string[]) =>
    renderer.render(
      { type: 'deep_build_doc', data: { files: names.map(name => ({ name })) } },
      '',
      { appId: 'abc123', appPath: '/app' },
    )

  it('canHandle only matches deep_build_doc', () => {
    expect(renderer.canHandle('deep_build_doc')).toBe(true)
    expect(renderer.canHandle('file_upload')).toBe(false)
  })

  it('routes a canonically-named brief to docs/brief.md', async () => {
    const result = await render(['brief.md'])
    expect(mockView).toHaveBeenCalledWith({ path: 'docs/brief.md', limit: 100000 })
    expect(mockWrite).toHaveBeenCalledWith({ path: 'docs/brief.md', content: '# Brief\nbody' })
    expect(result?.content).toContain('docs/brief.md')
    expect(result?.content).toContain('**interview** stage is already complete')
    expect(result?.role).toBe('user')
    expect(result?.insertionOrder).toBe('after_history')
  })

  it('routes a suffixed brief (brief-yoga.md) to docs/brief.md', async () => {
    await render(['brief-yoga.md'])
    expect(mockView).toHaveBeenCalledWith({ path: 'docs/brief-yoga.md', limit: 100000 })
    expect(mockWrite).toHaveBeenCalledWith({ path: 'docs/brief.md', content: '# Brief\nbody' })
  })

  it('matches case-insensitively', async () => {
    await render(['Brief-Project.MD'])
    expect(mockWrite).toHaveBeenCalledWith({ path: 'docs/brief.md', content: '# Brief\nbody' })
  })

  it('routes business-details and bare business to docs/business-details.md', async () => {
    await render(['business-details-yoga.md'])
    expect(mockWrite).toHaveBeenCalledWith({ path: 'docs/business-details.md', content: '# Brief\nbody' })
    mockWrite.mockClear()
    await render(['business.md'])
    expect(mockWrite).toHaveBeenCalledWith({ path: 'docs/business-details.md', content: '# Brief\nbody' })
  })

  it('does not match a stem that merely starts with a slot word (briefing.md)', async () => {
    const result = await render(['briefing.md'])
    expect(mockWrite).not.toHaveBeenCalled()
    expect(result?.content).toContain('Unmatched')
    expect(result?.content).toContain('briefing.md')
  })

  it('seeds multiple slots and lists both stages in the note', async () => {
    const result = await render(['brief-x.md', 'business-details-x.md'])
    expect(mockWrite).toHaveBeenCalledWith({ path: 'docs/brief.md', content: '# Brief\nbody' })
    expect(mockWrite).toHaveBeenCalledWith({ path: 'docs/business-details.md', content: '# Brief\nbody' })
    expect(result?.content).toContain('**interview** stage is already complete')
    expect(result?.content).toContain('**business-details** stage is already complete')
  })

  it('reports seed failures separately from unmatched files', async () => {
    mockView.mockRejectedValueOnce(new Error('not found'))
    const result = await render(['brief.md'])
    expect(mockWrite).not.toHaveBeenCalled()
    expect(result?.content).toContain('Failed to seed')
    expect(result?.content).toContain('brief.md')
    expect(result?.content).not.toContain('Unmatched')
  })

  it('returns null when no files are provided', async () => {
    const result = await render([])
    expect(result).toBeNull()
  })

  it('returns a note (not null) when appPath is missing', async () => {
    const { AppRepository } = await import('../../../database/repositories/AppRepository.js')
    ;(AppRepository as unknown as ReturnType<typeof vi.fn>).mockImplementation(function () { return {
      findById: vi.fn().mockReturnValue(null),
    }; })
    const fresh = new DeepBuildDocContextRenderer()
    const result = await fresh.render(
      { type: 'deep_build_doc', data: { files: [{ name: 'brief.md' }] } },
      '',
      { appId: undefined, appPath: undefined },
    )
    expect(result).not.toBeNull()
    expect(result?.content).toContain('could not be resolved')
  })
})
