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
import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSkillToolName } from './constants.js'

export interface SkillToolDefinition {
  name: string
  description: string
  parameters: z.ZodSchema<any>
  execute: (input: any, context?: any) => Promise<any> | any
  /**
   * Projects the (full) execute output down to what is sent to the language
   * model. The full output still reaches the UI/stream; only the model-facing
   * tool-result message uses this projection. Use it to strip context the model
   * cannot use (e.g. asset URLs the text-only agent can't see) while keeping the
   * UI's structuredContent intact.
   */
  toModelOutput?: Tool<any, any>['toModelOutput']
  config?: {
    timeout?: number
    requiresApp?: boolean
    validate?: (input: any, context?: any) => Promise<void> | void
    /** When true, agent factory should stop the turn after this tool completes */
    stopAfter?: boolean
  }
  /**
   * Optional: derive skill state to persist after a successful execution.
   *
   * Called by the framework after execute() returns (whether it returned an
   * error object or a success object — the implementation decides what counts
   * as success by inspecting `output`). Return null/undefined to write nothing.
   *
   * The returned object is shallow-merged into any existing state for this
   * skill, so each tool only needs to return the fields it owns. This lets
   * multiple tools within the same skill each contribute their own keys
   * without clobbering each other (e.g. generate_privacy_policy and
   * generate_terms_of_use both write to the compliance-docs state).
   *
   * The framework calls the injected onStateComputed callback (provided to
   * registerSkillTools/buildAllSkillTools at startup) which handles the actual
   * file write via writeSkillState. computeState itself is pure: no I/O.
   *
   * Example:
   *   computeState(input, output) {
   *     if (!output?.success) return null;
   *     return { provider: input.provider, configuredAt: new Date().toISOString() };
   *   }
   */
  computeState?: (input: any, output: any) => Record<string, unknown> | null | undefined
}

/**
 * Callback injected by the agents layer to handle state persistence.
 * Receives the computed state patch and is responsible for merging it
 * with any existing state and writing it to disk.
 *
 * @param skillName  - The skill that owns the state
 * @param appId      - App ID from context.metadata.appId (may be undefined)
 * @param statePatch - Partial state returned by computeState
 */
export type SkillStateCallback = (
  skillName: string,
  appId: string | undefined,
  statePatch: Record<string, unknown>
) => Promise<void>

/**
 * Callback injected by the agents layer to handle state-write errors.
 * Invoked when computeState or onStateComputed throws; the error is
 * non-fatal (tool output is still returned to the caller), but the
 * consumer must log it so silent skill-state loss is observable.
 *
 * @param skillName - The skill whose state failed to persist
 * @param toolName  - Prefixed tool name that triggered the state write
 * @param error     - The thrown value
 */
export type SkillStateErrorCallback = (
  skillName: string,
  toolName: string,
  error: unknown
) => void

export interface SkillRegistrationOptions {
  /**
   * Called after each tool execution where computeState returns a non-null patch.
   * If not provided, computeState is ignored even if defined on the tool.
   */
  onStateComputed?: SkillStateCallback
  /**
   * Called when computeState or onStateComputed throws.
   * If not provided, errors are silently swallowed (not recommended for production).
   */
  onStateError?: SkillStateErrorCallback
}

export interface SkillHookContext {
  skillName: string
  appPath?: string
  appId?: string
}

/** A single capability a skill wants to advertise to a returning customer. */
export interface SkillAnnouncement {
  /** Stable id of the capability. */
  id: string
  /** Plain-English suggestion label suitable for a clickable button. */
  label: string
  /** One-line description of the capability. */
  summary: string
  /** Catalog version in which this capability shipped. */
  version: number
}

/** What a skill reports at session start (see `onSessionStart`). */
export interface SkillSessionAnnouncements {
  /** The skill's current catalog version; used to advance the customer's last-seen marker. */
  currentVersion: number
  /** Capabilities that are relevant to this app and not yet adopted. */
  announcements: SkillAnnouncement[]
}

export interface SkillHooks {
  onLoad?: (context: SkillHookContext) => Promise<void> | void
  onInstall?: (context: SkillHookContext) => Promise<unknown> | unknown
  onUnload?: (context: SkillHookContext) => Promise<void> | void
  /**
   * Fired during app-scoped context bootstrapping to let a skill self-detect its
   * footprint in the app and report capabilities the customer hasn't adopted yet.
   * Consumers (e.g. session-start announcements, "Continue building") version-gate
   * these by per-skill state, so a skill should return the full relevant pending set
   * and let the caller decide what is "new". Return `null` when the skill has no
   * footprint in this app — the common case for most skills.
   */
  onSessionStart?: (
    context: SkillHookContext
  ) => Promise<SkillSessionAnnouncements | null> | SkillSessionAnnouncements | null
}

export interface SkillToolRegistry {
  /** All pre-registered tools (prefixed names -> Tool instance) */
  tools: Record<string, Tool>
  /** Mapping of skill name to its tool names (unprefixed) */
  skillToTools: Map<string, string[]>
  /** Mapping of skill name to its lifecycle hooks */
  skillHooks: Map<string, SkillHooks>
  /** Prefixed tool names that should trigger stopAfterTools when executed */
  stopAfterToolNames: string[]
}

/**
 * Validate skill name to prevent path traversal attacks.
 * Allows alphanumeric, hyphens, and underscores, with an optional single '/'
 * for one level of namespacing (e.g. "payment/stripe"). Each segment must be
 * non-empty and contain only safe characters.
 */
function isValidSkillName(skillName: string): boolean {
  if (!skillName || skillName.length === 0 || skillName.length > 100) {
    return false
  }
  if (skillName.includes('..') || skillName.includes('\\')) {
    return false
  }
  const segments = skillName.split('/')
  if (segments.length > 2) return false
  return segments.every(seg => /^[a-zA-Z0-9_-]+$/.test(seg))
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

  // Split into validated segments and join individually — avoids passing a
  // slash-containing string directly into join(), which trips path-traversal
  // scanners even though isValidSkillName already rejects unsafe inputs.
  const segments = skillName.split('/')
  const toolsIndexPath = join(skillsDir, ...segments, 'tools', 'index.ts')

  try {
    // Check if tools directory exists
    await access(toolsIndexPath)

    // Dynamic import of the tools module
    const toolsModule = await import(toolsIndexPath)

    const tools = collectToolDefinitionsFromModule(toolsModule)
    const hooks = isValidHooks(toolsModule.hooks) ? toolsModule.hooks : undefined

    return { tools, hooks }
  } catch {
    // Skill has no tools directory - this is normal for instruction-only skills
    return { tools: [] }
  }
}

/**
 * Collect tool definitions exported by a skill's `tools/index.ts` module.
 *
 * Accepts either individual named exports of `SkillToolDefinition`, or named
 * exports whose value is an *array* of `SkillToolDefinition` (used by skills
 * that generate their tool list dynamically at module load — e.g. one tool
 * per data file). The `default` and `hooks` keys are always skipped, and
 * invalid items inside arrays are dropped silently.
 *
 * Exported for unit-testing the collection logic without filesystem fixtures.
 */
export function collectToolDefinitionsFromModule(
  toolsModule: Record<string, unknown>
): SkillToolDefinition[] {
  const tools: SkillToolDefinition[] = []
  for (const [key, value] of Object.entries(toolsModule)) {
    if (key === 'default') continue
    if (key === 'hooks') continue
    if (isValidToolDefinition(value)) {
      tools.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isValidToolDefinition(item)) {
          tools.push(item)
        }
      }
    }
  }
  return tools
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
  // Keep in sync with the SkillHooks interface. onSessionStart MUST be here:
  // an "announce-only" skill (the one-line, no-core-edits extension this system
  // advertises) that exports ONLY onSessionStart would otherwise fail this gate,
  // have its entire hooks object dropped at registration, and never surface via
  // listSkillsWithSessionStart().
  const validKeys = ['onLoad', 'onInstall', 'onUnload', 'onSessionStart']
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
  registry?: SkillToolRegistry,
  options?: SkillRegistrationOptions
): SkillToolRegistry {
  const result: SkillToolRegistry = registry || {
    tools: {},
    skillToTools: new Map(),
    skillHooks: new Map(),
    stopAfterToolNames: [],
  }

  if (toolDefs.length === 0) return result

  const toolNames: string[] = []

  for (const toolDef of toolDefs) {
    const prefixedName = buildSkillToolName(skillName, toolDef.name)
    toolNames.push(toolDef.name)

    if (toolDef.config?.stopAfter) {
      result.stopAfterToolNames.push(prefixedName)
    }

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
        const output = await Promise.race([
          toolDef.execute(input, context),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Tool ${prefixedName} execution timeout`)),
              timeout
            )
          )
        ])

        // Derive and persist skill state if this tool declares computeState.
        // State write is best-effort: failures are logged but never propagate
        // to the caller — tool results are always returned regardless.
        if (toolDef.computeState && options?.onStateComputed) {
          try {
            const statePatch = toolDef.computeState(input, output)
            if (statePatch) {
              const appId = (context as any)?.metadata?.appId as string | undefined
              await options.onStateComputed(skillName, appId, statePatch)
            }
          } catch (err) {
            // Non-fatal: state write errors must not break tool execution
            options?.onStateError?.(skillName, prefixedName, err)
          }
        }

        return output
      },
      ...(toolDef.toModelOutput ? { toModelOutput: toolDef.toModelOutput } : {})
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
export async function buildAllSkillTools(
  skillsDir: string,
  options?: SkillRegistrationOptions
): Promise<SkillToolRegistry> {
  let registry: SkillToolRegistry = {
    tools: {},
    skillToTools: new Map(),
    skillHooks: new Map(),
    stopAfterToolNames: [],
  }

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    const topDirs = entries.filter(e => e.isDirectory()).map(e => e.name)

    for (const skillName of topDirs) {
      const { tools: toolDefs, hooks } = await loadSkillToolDefinitions(skillsDir, skillName)

      if (toolDefs.length > 0) {
        registry = registerSkillTools(skillName, toolDefs, registry, options)
      }
      if (hooks) {
        registry.skillHooks.set(skillName, hooks)
      }

      // Scan one level deeper for namespaced skills (e.g. payment/stripe).
      // These are skill directories nested inside a top-level grouping directory.
      let subEntries: import('node:fs').Dirent[] = []
      try {
        subEntries = await readdir(join(skillsDir, skillName), { withFileTypes: true })
      } catch {
        // Not a directory or unreadable — skip
      }
      for (const sub of subEntries.filter(e => e.isDirectory())) {
        const nestedName = `${skillName}/${sub.name}`
        const { tools: nestedToolDefs, hooks: nestedHooks } = await loadSkillToolDefinitions(skillsDir, nestedName)
        if (nestedToolDefs.length > 0) {
          registry = registerSkillTools(nestedName, nestedToolDefs, registry, options)
        }
        if (nestedHooks) {
          registry.skillHooks.set(nestedName, nestedHooks)
        }
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
