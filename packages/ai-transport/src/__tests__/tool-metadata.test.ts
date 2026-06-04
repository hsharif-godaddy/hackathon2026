import { describe, it, expect, vi } from 'vitest'
import { toolMetadataFields } from '../tool-metadata.js'

describe('toolMetadataFields', () => {
  it('returns {} when no resolver is provided', () => {
    expect(toolMetadataFields('blog__createPost')).toEqual({})
  })

  it('returns {} when the resolver returns undefined', () => {
    expect(toolMetadataFields('readfile', () => undefined)).toEqual({})
  })

  it('returns {} when the resolver returns an object without skillName', () => {
    expect(toolMetadataFields('readfile', () => ({}))).toEqual({})
  })

  it('returns { skillName } when the resolver provides one', () => {
    const resolve = vi.fn((name: string) =>
      name.startsWith('commerce__') ? { skillName: 'commerce' } : undefined,
    )
    expect(toolMetadataFields('commerce__store_list', resolve)).toEqual({ skillName: 'commerce' })
    expect(resolve).toHaveBeenCalledWith('commerce__store_list')
  })

  it('is safe to spread for a non-skill tool', () => {
    const tool = { id: 't1', name: 'readfile', ...toolMetadataFields('readfile', () => undefined) }
    expect(tool).toEqual({ id: 't1', name: 'readfile' })
    expect('skillName' in tool).toBe(false)
  })

  it('swallows a throwing resolver and returns {} (additive contract)', () => {
    const resolve = () => {
      throw new Error('resolver boom')
    }
    expect(() => toolMetadataFields('blog__createPost', resolve)).not.toThrow()
    expect(toolMetadataFields('blog__createPost', resolve)).toEqual({})
  })

  it('logs a warning when the resolver throws', () => {
    const logger = { warn: vi.fn() }
    const resolve = () => {
      throw new Error('resolver boom')
    }
    toolMetadataFields('blog__createPost', resolve, logger)
    expect(logger.warn).toHaveBeenCalledWith(
      'tool_metadata.resolve_failed',
      expect.objectContaining({ toolName: 'blog__createPost', error: 'resolver boom' }),
    )
  })
})
