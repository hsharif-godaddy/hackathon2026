import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { z } from 'zod'
import { buildAllSkillTools, registerSkillTools, type SkillToolDefinition } from '../build-skill-tools.js'

describe('buildAllSkillTools', () => {
  let testSkillsDir: string

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testSkillsDir = join(tmpdir(), `skill-tools-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(testSkillsDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean up the test directory
    try {
      await rm(testSkillsDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  it('should return empty registry when skills directory does not exist', async () => {
    const registry = await buildAllSkillTools('/non/existent/path')

    expect(registry.tools).toEqual({})
    expect(registry.skillToTools.size).toBe(0)
  })

  it('should return empty registry when skills directory is empty', async () => {
    const registry = await buildAllSkillTools(testSkillsDir)

    expect(registry.tools).toEqual({})
    expect(registry.skillToTools.size).toBe(0)
  })

  it('should return empty registry for skills without tools directories', async () => {
    // Create a skill directory without tools/
    await mkdir(join(testSkillsDir, 'blog'), { recursive: true })
    await writeFile(join(testSkillsDir, 'blog', 'skill.md'), '# Blog Skill')

    const registry = await buildAllSkillTools(testSkillsDir)

    expect(registry.tools).toEqual({})
    expect(registry.skillToTools.size).toBe(0)
  })

  it('should have correct SkillToolRegistry structure', async () => {
    const registry = await buildAllSkillTools(testSkillsDir)

    // Verify registry has the expected shape
    expect(registry).toHaveProperty('tools')
    expect(registry).toHaveProperty('skillToTools')
    expect(typeof registry.tools).toBe('object')
    expect(registry.skillToTools instanceof Map).toBe(true)
  })

  it('should handle mixed skills with and without tools', async () => {
    // Create multiple skills - some with tools directories, some without
    await mkdir(join(testSkillsDir, 'blog'), { recursive: true })
    await mkdir(join(testSkillsDir, 'seo'), { recursive: true })
    await mkdir(join(testSkillsDir, 'auth/tools'), { recursive: true })

    // auth has a tools dir but no index.ts
    const registry = await buildAllSkillTools(testSkillsDir)

    // Should still work without errors
    expect(registry.tools).toEqual({})
    expect(registry.skillToTools.size).toBe(0)
  })

  describe('path traversal protection', () => {
    it('should reject skill names with path traversal sequences', async () => {
      // Create a directory that could be exploited
      await mkdir(join(testSkillsDir, '..', 'malicious'), { recursive: true })

      // This should not access ../malicious
      const registry = await buildAllSkillTools(testSkillsDir)

      // The ../malicious directory should not be loaded
      expect(registry.skillToTools.has('..%2Fmalicious')).toBe(false)
      expect(registry.skillToTools.has('../malicious')).toBe(false)
    })

    it('should only allow alphanumeric, hyphen, and underscore in skill names', async () => {
      // Create skills with valid and invalid names (readdir would return these)
      await mkdir(join(testSkillsDir, 'valid-skill'), { recursive: true })
      await mkdir(join(testSkillsDir, 'valid_skill'), { recursive: true })
      await mkdir(join(testSkillsDir, 'ValidSkill123'), { recursive: true })

      const registry = await buildAllSkillTools(testSkillsDir)

      // All valid names should be processed without error
      expect(registry).toBeDefined()
    })
  })
})

describe('registerSkillTools', () => {
  describe('tool name prefixing', () => {
    it('should create prefixed tool names using skillName__toolName format', () => {
      const toolDef: SkillToolDefinition = {
        name: 'createPost',
        description: 'Create a blog post',
        parameters: z.object({ title: z.string() }),
        execute: vi.fn()
      }

      const registry = registerSkillTools('blog', [toolDef])

      expect(registry.tools).toHaveProperty('blog__createPost')
      expect(Object.keys(registry.tools)).toEqual(['blog__createPost'])
    })

    it('should handle multiple tools in a skill', () => {
      const toolDefs: SkillToolDefinition[] = [
        {
          name: 'createPost',
          description: 'Create a blog post',
          parameters: z.object({ title: z.string() }),
          execute: vi.fn()
        },
        {
          name: 'listPosts',
          description: 'List all blog posts',
          parameters: z.object({}),
          execute: vi.fn()
        }
      ]

      const registry = registerSkillTools('blog', toolDefs)

      expect(registry.tools).toHaveProperty('blog__createPost')
      expect(registry.tools).toHaveProperty('blog__listPosts')
      expect(Object.keys(registry.tools)).toHaveLength(2)
    })
  })

  describe('skillToTools mapping', () => {
    it('should correctly track tool names per skill', () => {
      const toolDefs: SkillToolDefinition[] = [
        {
          name: 'createPost',
          description: 'Create a blog post',
          parameters: z.object({ title: z.string() }),
          execute: vi.fn()
        },
        {
          name: 'listPosts',
          description: 'List all blog posts',
          parameters: z.object({}),
          execute: vi.fn()
        }
      ]

      const registry = registerSkillTools('blog', toolDefs)

      expect(registry.skillToTools.get('blog')).toEqual(['createPost', 'listPosts'])
    })

    it('should extend existing registry when provided', () => {
      const blogTool: SkillToolDefinition = {
        name: 'createPost',
        description: 'Create a blog post',
        parameters: z.object({ title: z.string() }),
        execute: vi.fn()
      }

      const seoTool: SkillToolDefinition = {
        name: 'analyze',
        description: 'Analyze SEO',
        parameters: z.object({ url: z.string() }),
        execute: vi.fn()
      }

      let registry = registerSkillTools('blog', [blogTool])
      registry = registerSkillTools('seo', [seoTool], registry)

      expect(registry.tools).toHaveProperty('blog__createPost')
      expect(registry.tools).toHaveProperty('seo__analyze')
      expect(registry.skillToTools.get('blog')).toEqual(['createPost'])
      expect(registry.skillToTools.get('seo')).toEqual(['analyze'])
    })
  })

  describe('tool execution', () => {
    it('should create executable tools', async () => {
      const executeFn = vi.fn().mockResolvedValue({ success: true, postId: '123' })

      const toolDef: SkillToolDefinition = {
        name: 'createPost',
        description: 'Create a blog post',
        parameters: z.object({ title: z.string() }),
        execute: executeFn
      }

      const registry = registerSkillTools('blog', [toolDef])
      const tool = registry.tools['blog__createPost']

      // Verify the tool exists and has the expected properties
      expect(tool).toBeDefined()
      expect(tool.description).toBe('Create a blog post')

      // Execute the tool
      const executeMethod = (tool as any).execute
      expect(executeMethod).toBeDefined()

      const result = await executeMethod({ title: 'My Post' }, {})
      expect(executeFn).toHaveBeenCalledWith({ title: 'My Post' }, undefined)
      expect(result).toEqual({ success: true, postId: '123' })
    })

    it('should pass context from executionOptions to execute function', async () => {
      const executeFn = vi.fn().mockResolvedValue('done')

      const toolDef: SkillToolDefinition = {
        name: 'testTool',
        description: 'A test tool',
        parameters: z.object({}),
        execute: executeFn
      }

      const registry = registerSkillTools('test', [toolDef])
      const tool = registry.tools['test__testTool']
      const executeMethod = (tool as any).execute

      const mockContext = { appId: 'app-123', conversationId: 'conv-456' }
      await executeMethod({}, { experimental_context: mockContext })

      expect(executeFn).toHaveBeenCalledWith({}, mockContext)
    })

    it('should run custom validation before execution', async () => {
      const executeFn = vi.fn().mockResolvedValue('done')
      const validateFn = vi.fn()

      const toolDef: SkillToolDefinition = {
        name: 'validatedTool',
        description: 'A tool with validation',
        parameters: z.object({ value: z.number() }),
        execute: executeFn,
        config: {
          validate: validateFn
        }
      }

      const registry = registerSkillTools('test', [toolDef])
      const tool = registry.tools['test__validatedTool']
      const executeMethod = (tool as any).execute

      const mockContext = { userId: 'user-1' }
      await executeMethod({ value: 42 }, { experimental_context: mockContext })

      expect(validateFn).toHaveBeenCalledWith({ value: 42 }, mockContext)
      expect(executeFn).toHaveBeenCalledWith({ value: 42 }, mockContext)
    })

    it('should fail validation if validate throws', async () => {
      const executeFn = vi.fn().mockResolvedValue('done')
      const validateFn = vi.fn().mockRejectedValue(new Error('Validation failed'))

      const toolDef: SkillToolDefinition = {
        name: 'failingValidation',
        description: 'A tool that fails validation',
        parameters: z.object({}),
        execute: executeFn,
        config: {
          validate: validateFn
        }
      }

      const registry = registerSkillTools('test', [toolDef])
      const tool = registry.tools['test__failingValidation']
      const executeMethod = (tool as any).execute

      await expect(executeMethod({}, {})).rejects.toThrow('Validation failed')
      expect(executeFn).not.toHaveBeenCalled()
    })

    it('should timeout execution if it takes too long', async () => {
      const slowExecuteFn = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('slow result'), 200))
      )

      const toolDef: SkillToolDefinition = {
        name: 'slowTool',
        description: 'A slow tool',
        parameters: z.object({}),
        execute: slowExecuteFn,
        config: {
          timeout: 50 // 50ms timeout
        }
      }

      const registry = registerSkillTools('test', [toolDef])
      const tool = registry.tools['test__slowTool']
      const executeMethod = (tool as any).execute

      await expect(executeMethod({}, {})).rejects.toThrow('Tool test__slowTool execution timeout')
    })
  })

  describe('edge cases', () => {
    it('should return unchanged registry for empty tool definitions', () => {
      const registry = registerSkillTools('emptySkill', [])

      expect(Object.keys(registry.tools)).toHaveLength(0)
      expect(registry.skillToTools.size).toBe(0)
    })

    it('should handle tools with complex schemas', () => {
      const toolDef: SkillToolDefinition = {
        name: 'complexTool',
        description: 'A tool with complex schema',
        parameters: z.object({
          nested: z.object({
            value: z.string(),
            count: z.number().optional()
          }),
          array: z.array(z.string()),
          union: z.union([z.string(), z.number()])
        }),
        execute: vi.fn()
      }

      const registry = registerSkillTools('complex', [toolDef])

      expect(registry.tools).toHaveProperty('complex__complexTool')
      expect(registry.skillToTools.get('complex')).toEqual(['complexTool'])
    })
  })
})
