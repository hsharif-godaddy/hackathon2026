/**
 * Build All Skill Tools - Pre-registers all skill tools at startup
 *
 * Scans skill directories and builds a complete registry of all tools
 * with namespaced prefixes. These tools are registered once at startup
 * but only made "active" when their skill is loaded.
 */

import { tool } from 'ai'
import type { Tool, ToolExecutionOptions } from 'ai'
import type { z } from 'zod'
import { readdir, access } from 'fs/promises'
import { join } from 'path'
import { buildSkillToolName } from './constants.js'

export interface SkillToolDefinition {
  name: string
  description: string
  parameters: z.ZodSchema<any>
  execute: (input: any, context?: any) => Promise<any> | any
  config?: {
    timeout?: number
    requiresApp?: boolean
    validate?: (input: any, context?: any) => Promise<void> | void
  }
}

export interface SkillHookContext {
  skillName: string
  appPath?: string
  appId?: string
}

export interface SkillHooks {
  onLoad?: (context: SkillHookContext) => Promise<void> | void
  onInstall?: (context: SkillHookContext) => Promise<void> | void
  onUnload?: (context: SkillHookContext) => Promise<void> | void
}

export interface SkillToolRegistry {
  /** All pre-registered tools (prefixed names -> Tool instance) */
  tools: Record<string, Tool>
  /** Mapping of skill name to its tool names (unprefixed) */
  skillToTools: Map<string, string[]>
  /** Mapping of skill name to its lifecycle hooks */
  skillHooks: Map<string, SkillHooks>
}

/**
 * Validate skill name to prevent path traversal attacks
 * Only allows alphanumeric characters, hyphens, and underscores
 */
function isValidSkillName(skillName: string): boolean {
  if (!skillName || skillName.length === 0 || skillName.length > 100) {
    return false
  }
  // Reject path traversal attempts
  if (skillName.includes('..') || skillName.includes('/') || skillName.includes('\\')) {
    return false
  }
  // Only allow safe characters
  return /^[a-zA-Z0-9_-]+$/.test(skillName)
}

interface SkillModuleExports {
  tools: SkillToolDefinition[]
  hooks?: SkillHooks
}

/**
 * Load tool definitions and hooks from a skill's tools/index.ts file
 */
async function loadSkillToolDefinitions(
  skillsDir: string,
  skillName: string
): Promise<SkillModuleExports> {
  // Validate skill name to prevent path traversal
  if (!isValidSkillName(skillName)) {
    return { tools: [] }
  }

  const toolsIndexPath = join(skillsDir, skillName, 'tools', 'index.ts')

  try {
    // Check if tools directory exists
    await access(toolsIndexPath)

    // Dynamic import of the tools module
    const toolsModule = await import(toolsIndexPath)

    const tools: SkillToolDefinition[] = []
    for (const [key, value] of Object.entries(toolsModule)) {
      if (key === 'default') continue
      if (key === 'hooks') continue
      if (isValidToolDefinition(value)) {
        tools.push(value as SkillToolDefinition)
      }
    }

    const hooks = isValidHooks(toolsModule.hooks) ? toolsModule.hooks : undefined

    return { tools, hooks }
  } catch {
    // Skill has no tools directory - this is normal for instruction-only skills
    return { tools: [] }
  }
}

function isValidToolDefinition(def: unknown): def is SkillToolDefinition {
  return (
    typeof def === 'object' &&
    def !== null &&
    typeof (def as any).name === 'string' &&
    typeof (def as any).description === 'string' &&
    typeof (def as any).parameters === 'object' &&
    typeof (def as any).execute === 'function'
  )
}

function isValidHooks(hooks: unknown): hooks is SkillHooks {
  if (typeof hooks !== 'object' || hooks === null) return false
  const h = hooks as Record<string, unknown>
  const validKeys = ['onLoad', 'onInstall', 'onUnload']
  return Object.keys(h).some(
    key => validKeys.includes(key) && typeof h[key] === 'function'
  )
}

/**
 * Register skill tools programmatically (for testing and direct registration)
 *
 * @param skillName - Name of the skill
 * @param toolDefs - Array of tool definitions
 * @param registry - Optional existing registry to extend
 * @returns Registry with the skill's tools added
 */
export function registerSkillTools(
  skillName: string,
  toolDefs: SkillToolDefinition[],
  registry?: SkillToolRegistry
): SkillToolRegistry {
  const result: SkillToolRegistry = registry || {
    tools: {},
    skillToTools: new Map(),
    skillHooks: new Map()
  }

  if (toolDefs.length === 0) return result

  const toolNames: string[] = []

  for (const toolDef of toolDefs) {
    const prefixedName = buildSkillToolName(skillName, toolDef.name)
    toolNames.push(toolDef.name)

    // Create AI SDK tool instance
    result.tools[prefixedName] = tool({
      description: toolDef.description,
      inputSchema: toolDef.parameters as any,
      execute: async (input: any, executionOptions: ToolExecutionOptions) => {
        const context = executionOptions?.experimental_context

        // Custom validation if provided
        if (toolDef.config?.validate) {
          await toolDef.config.validate(input, context)
        }

        // Execute with timeout
        const timeout = toolDef.config?.timeout || 30000
        const result = await Promise.race([
          toolDef.execute(input, context),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Tool ${prefixedName} execution timeout`)),
              timeout
            )
          )
        ])

        return result
      }
    })
  }

  result.skillToTools.set(skillName, toolNames)
  return result
}

/**
 * Build all skill tools at startup
 *
 * @param skillsDir - Path to the skills directory
 * @returns Registry of all pre-registered tools
 */
export async function buildAllSkillTools(skillsDir: string): Promise<SkillToolRegistry> {
  let registry: SkillToolRegistry = {
    tools: {},
    skillToTools: new Map(),
    skillHooks: new Map()
  }

  try {
    // Get all skill directories
    const entries = await readdir(skillsDir, { withFileTypes: true })
    const skillDirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)

    for (const skillName of skillDirs) {
      const { tools: toolDefs, hooks } = await loadSkillToolDefinitions(skillsDir, skillName)

      if (toolDefs.length > 0) {
        // Use shared registration logic
        registry = registerSkillTools(skillName, toolDefs, registry)
      }

      if (hooks) {
        registry.skillHooks.set(skillName, hooks)
      }
    }
  } catch (error) {
    // If skills directory doesn't exist, return empty registry
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return registry
    }
    throw error
  }

  return registry
}
