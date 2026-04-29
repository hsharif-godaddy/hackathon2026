import { describe, it, expect } from 'vitest'
import { redactSkillOutput } from '../redact-skill-output.js'

describe('redactSkillOutput', () => {
  it('should redact instructions from skill tool output', () => {
    const output = {
      skill: 'blog',
      instructions: 'Full skill instructions content...',
      toolsAvailable: ['skill__blog_install'],
      message: 'Skill loaded'
    }

    const result = redactSkillOutput('skill', output) as Record<string, unknown>

    expect(result.instructions).toBe('[redacted]')
    expect(result.skill).toBe('blog')
    expect(result.toolsAvailable).toEqual(['skill__blog_install'])
    expect(result.message).toBe('Skill loaded')
  })

  it('should redact dependentInstructions from skill tool output', () => {
    const output = {
      skill: 'commerce',
      filesInstalled: 5,
      dependentInstructions: { blog: 'Blog instructions...', forms: 'Forms instructions...' }
    }

    const result = redactSkillOutput('skill', output) as Record<string, unknown>

    expect(result.dependentInstructions).toBe('[redacted]')
    expect(result.skill).toBe('commerce')
    expect(result.filesInstalled).toBe(5)
  })

  it('should redact both instructions and dependentInstructions when present', () => {
    const output = {
      skill: 'blog',
      instructions: 'Full instructions',
      dependentInstructions: { other: 'Other instructions' },
      message: 'Loaded'
    }

    const result = redactSkillOutput('skill', output) as Record<string, unknown>

    expect(result.instructions).toBe('[redacted]')
    expect(result.dependentInstructions).toBe('[redacted]')
    expect(result.message).toBe('Loaded')
  })

  it('should not modify non-skill tool output', () => {
    const output = {
      instructions: 'This is not a skill tool',
      result: 'some data'
    }

    const result = redactSkillOutput('writeFile', output)

    expect(result).toBe(output) // Same reference, untouched
  })

  it('should not modify skill output without redactable fields', () => {
    const output = {
      skills: [{ name: 'blog', description: 'Blog skill' }],
      count: 1,
      message: 'Found 1 skill'
    }

    const result = redactSkillOutput('skill', output) as Record<string, unknown>

    expect(result).toEqual(output)
  })

  it('should return non-object output unchanged', () => {
    expect(redactSkillOutput('skill', 'string output')).toBe('string output')
    expect(redactSkillOutput('skill', null)).toBe(null)
    expect(redactSkillOutput('skill', undefined)).toBe(undefined)
    expect(redactSkillOutput('skill', 42)).toBe(42)
  })

  it('should return array output unchanged without converting to object', () => {
    const output = ['a', 'b', 'c']
    const result = redactSkillOutput('skill', output)
    expect(result).toBe(output) // Same reference, untouched
    expect(Array.isArray(result)).toBe(true)
  })
})
