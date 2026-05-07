import {
  type AgentConfig,
  createPromptBuilder,
  createHandoffTool,
  type SessionStateManager,
} from '@airo/ai-lib'
import { existsSync, readFileSync } from 'fs'
import type { PipelineContextMessage } from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { logger } from '../logging/index.js'
import { getTemplate } from './template-registry.js'
import { skillToolManager } from '../tools/skill-tool-manager.js'
import { SkillLoaderTool } from '../tools/skill-loader-tool.js'
import { profileValue } from '../profiles/index.js'
import {
  MODULAR_PROMPT_FILES_KEY,
  parseModularPromptFilesCsv,
} from './modular-prompt-files.js'

export {
  DEFAULT_MODULAR_PROMPT_FILES,
  parseModularPromptFilesCsv,
  profileDefinesCustomModularPromptFiles,
  parseModularPromptFilesFromProfileProperty,
} from './modular-prompt-files.js'

/**
 * Initial Agent - Creates single-page preview plans for new apps
 *
 * This agent is only used for brand new apps with no conversation history.
 * It creates a minimal todo list for a single-page preview and hands off to develop agent.
 *
 * Prompt versions (in agents/src/prompts/initial/<version>/):
 * - 1.0: Legacy monolithic (core.md + attributes.md + guidelines.md + examples.md)
 * - 2.0: Simplified askQuestion, no attributes.md (10% cheaper, 4s faster)
 * - 3.0: Modular — each concern is a separate swappable file for A/B testing
 *
 * Shared files (communication.md, security.md) are appended from the shared/ directory.
 *
 * When a templateId is provided, prompt files are loaded from
 * agents/src/prompts/initial/templates/<templateId>/ instead.
 *
 * Endgame / profile experiments: set profile property `initial.modularPromptFiles` to a
 * comma-separated list of module filenames (under initial/<version>/) to override the
 * default modular load order for that profile. Requires prompt version 3.0 (or a dedicated
 * factory-built `initial-v3-<profileName>` agent).
 */

const DEFAULT_PROMPT_VERSION = '1.0'

function modularPromptFilesFromActiveProfile(): string[] {
  return parseModularPromptFilesCsv(profileValue(MODULAR_PROMPT_FILES_KEY, '' as string))
}

// Legacy optional files (1.0, 2.0)
const LEGACY_OPTIONAL_FILES = ['attributes.md', 'guidelines.md', 'examples.md']

/**
 * Build the system prompt for the Initial Agent
 */
async function buildInitialSystemPrompt(templateId?: string, promptVersion?: string): Promise<string> {
  const promptBuilder = createPromptBuilder()
  const paths = getModularPromptPaths(import.meta.url)

  if (templateId) {
    const templateDir = `initial/templates/${templateId}`
    const manifestPath = paths.getAgentFile(templateDir, 'manifest.json')

    if (existsSync(manifestPath)) {
      // Manifest mode: ordered file list with source routing
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        base: string
        files: Array<{ src: 'base' | 'template'; file: string }>
      }
      const baseDir = `initial/${manifest.base}`

      for (const entry of manifest.files) {
        const filePath = entry.src === 'base'
          ? paths.getAgentFile(baseDir, entry.file)
          : paths.getAgentFile(templateDir, entry.file)

        if (!existsSync(filePath)) {
          throw new Error(`Missing manifest file: ${entry.src}/${entry.file} for template ${templateId}`)
        }
        promptBuilder.file(filePath)
      }
    } else {
      // Legacy template mode: core.md + optional files
      promptBuilder.file(paths.getAgentFile(templateDir, 'core.md'))

      for (const file of LEGACY_OPTIONAL_FILES) {
        const filePath = paths.getAgentFile(templateDir, file)
        if (existsSync(filePath)) {
          promptBuilder.file(filePath)
        }
      }
    }

    promptBuilder.file(paths.getSharedFile('communication.md'))
    promptBuilder.file(paths.getSharedFile('security.md'))

    return await promptBuilder.build()
  }

  // Versioned mode: load from initial/<version>/
  const version = promptVersion || DEFAULT_PROMPT_VERSION
  const versionDir = `initial/${version}`

  // Detect modular (3.0+) vs legacy (1.0, 2.0) structure
  const isModular = existsSync(paths.getAgentFile(versionDir, 'identity.md'))

  if (isModular) {
    for (const file of modularPromptFilesFromActiveProfile()) {
      const filePath = paths.getAgentFile(versionDir, file)
      if (!existsSync(filePath)) {
        throw new Error(`Missing required module: ${file} in ${versionDir}`)
      }
      promptBuilder.file(filePath)
    }
    promptBuilder.file(paths.getSharedFile('communication.md'))
    promptBuilder.file(paths.getSharedFile('security.md'))
  } else {
    // Legacy order: core → communication → [optional] → security
    promptBuilder.file(paths.getAgentFile(versionDir, 'core.md'))
    promptBuilder.file(paths.getSharedFile('communication.md'))
    for (const file of LEGACY_OPTIONAL_FILES) {
      const filePath = paths.getAgentFile(versionDir, file)
      if (existsSync(filePath)) {
        promptBuilder.file(filePath)
      }
    }
    promptBuilder.file(paths.getSharedFile('security.md'))
  }
  return await promptBuilder.build()
}

/**
 * Create the Initial Agent configuration
 * @param stateManager - Optional session state manager for handoff support
 * @param templateId - Optional template ID to use a custom system prompt
 * @param promptVersion - Optional prompt version (e.g., '1.0', '2.0'). Defaults to DEFAULT_PROMPT_VERSION.
 */
export async function createInitialAgent(
  stateManager?: SessionStateManager,
  templateId?: string,
  promptVersion?: string
): Promise<AgentConfig> {
  if (templateId && !getTemplate(templateId)) {
    throw new Error(`Unknown template: ${templateId}`)
  }

  const systemPrompt = await buildInitialSystemPrompt(templateId, promptVersion)
  const { model, modelName } = await getAgentModelWithName('fast')

  const agentId = templateId ? `initial-${templateId}` : 'initial'
  const agentName = templateId ? `Initial (${templateId})` : 'Initial'

  const validTargets = templateId === 'logo-designer'
    ? ['develop', 'initial']
    : ['develop']

  const handoffTool = stateManager
    ? createHandoffTool({
        sourceAgentId: agentId,
        validTargets,
        stateManager
      })
    : undefined

  const tools: Record<string, unknown> = {
    todoList: allAILibTools.todoList,
    setProjectName: allAILibTools.setProjectName,
    askQuestion: allAILibTools.askQuestion,
    websiteRebuild: allAILibTools.websiteRebuild,
  }

  // Logo-designer template needs brand tools + skill system for media-logo
  if (templateId === 'logo-designer') {
    tools.brandBook = allAILibTools.brandBook
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
    tools.skill = allAILibTools.skill
    // No websiteRebuild — logo-designer hands off out-of-scope requests to initial
    delete tools.websiteRebuild
  }

  // Design-spec template: apply design tokens directly, write files to disk
  if (templateId === 'design-spec') {
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
    tools.fileEdit = allAILibTools.fileEdit
  }

  // ZIP import template: write uploaded files to disk
  if (templateId === 'zip-import') {
    tools.fileEdit = allAILibTools.fileEdit
  }

  // UI kit import: apply design tokens, write files, load kit reference
  if (templateId === 'ui-kit-import') {
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
    tools.fileEdit = allAILibTools.fileEdit
    tools.loadUiKit = allAILibTools.loadUiKit
  }

  // File upload: may need to apply extracted colors/fonts from classification
  if (templateId === 'file-upload') {
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
  }

  if (handoffTool) {
    tools.handoff = handoffTool
  }

  return {
    id: agentId,
    name: agentName,
    system: systemPrompt,
    model,
    modelName,
    tools,
    onSkillsLoad: templateId === 'logo-designer'
      ? async (conversationId: string): Promise<PipelineContextMessage[]> => {
          // Register skill tools (makes them visible via activeTools)
          const activation = skillToolManager.registerSkill('media-logo', conversationId)
          if (!activation.success) {
            logger.warn('initial_agent.on_skills_load.activation_failed', {
              skill: 'media-logo', conversationId, error: activation.error
            })
            return []
          }
          // Run onLoad hook (appPath/appId unavailable here — only passed via skill tool at runtime)
          await skillToolManager.runHook('media-logo', 'onLoad', { skillName: 'media-logo' })
          // Load instructions via SkillLoaderTool (single source for reading skill.md)
          const skillLoader = new SkillLoaderTool()
          const result = await skillLoader.loadSkill({ skill: 'media-logo' })
          if (!result.success || !result.instructions?.trim()) {
            // Unload tools to avoid split state (tools active without instructions)
            skillToolManager.unloadSkill('media-logo', conversationId)
            logger.warn('initial_agent.on_skills_load.instructions_failed', {
              skill: 'media-logo', conversationId, success: result.success
            })
            return []
          }
          return [{ role: 'user', content: result.instructions, insertionOrder: 'after_history' }]
        }
      : undefined,

    handoffs: templateId === 'logo-designer'
      ? [
          {
            agentName: 'develop',
            description: 'Hand off to development agent for website building and code tasks',
          },
          {
            agentName: 'initial',
            description: 'Hand off to initial agent for requests outside brand/logo scope (websites, domains, general app creation)',
          },
        ]
      : [
          {
            agentName: 'develop',
            description: 'Hand off to development agent for all site types - single-page, multi-page, dashboards, games, or apps',
          },
        ],

    // Stop after tools that need user confirmation before continuing
    stopAfterTools: [
      ...(handoffTool ? ['handoff'] : []),
      ...(templateId !== 'logo-designer' ? ['websiteRebuild'] : []),
      'askQuestion',
    ],

    maxSteps: 10,
    temperature: 0.5,
    maxOutputTokens: 8000,
    timeout: { stepMs: 600_000 },
    logger: createAgentTelemetryLogger(agentId),

    // Enable prompt caching for cost savings
    enablePromptCaching: true,

    metadata: {
      contextPreferences: {
        includeAppContext: true,
        includeVisualContext: false,
        includeAiEditContext: false,
        includeSelectedImages: false,
        includeConversationHistory: true,
        includeTemplateDescription: true
      }
    }
  }
}
