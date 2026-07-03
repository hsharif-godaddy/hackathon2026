import {
  type AgentConfig,
  createPromptBuilder,
  type SessionStateManager,
} from '@airo/ai-lib'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import type { PipelineContextMessage } from '@airo/ai-lib'
import { getAgentModelWithName } from '../utils/model-selection.js'
import { getModularPromptPaths } from '../utils/prompt-utils.js'
import { allAILibTools } from '../tools/ai-lib-tools/index.js'
import { createAgentTelemetryLogger } from '../utils/agent-logger.js'
import { errorFields, logger } from '../logging/index.js'
import { getMode } from './mode-registry.js'
import { skillToolManager } from '../tools/skill-tool-manager.js'
import { SkillLoaderTool } from '../tools/skill-loader-tool.js'
import { createAgentHandoffTool } from '../tools/create-agent-handoff-tool.js'
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
 * - 3.0: Modular — each concern is a separate swappable file for A/B testing
 *
 * Shared files (communication.md, security.md) are appended from the shared/ directory.
 *
 * When a templateId is provided, prompt files are loaded from
 * agents/src/prompts/initial/modes/<templateId>/ instead.
 *
 * Endgame / profile experiments: set profile property `initial.modularPromptFiles` to a
 * comma-separated list of module filenames (under initial/<version>/) to override the
 * default modular load order for that profile. Requires prompt version 3.0 (or a dedicated
 * factory-built `initial-v3-<profileName>` agent).
 */

const DEFAULT_PROMPT_VERSION = '1.0'

/**
 * Directory names under `agents/src/prompts/initial/` that are NOT named manifest
 * variants — numbered versions, modes sub-tree, anything else is scanned.
 */
const NON_VARIANT_INITIAL_SUBDIRS = new Set(['1.0', '3.0', 'modes'])

/**
 * Discover named manifest-based initial agent variants. A named variant is any
 * subdirectory of `agents/src/prompts/initial/` (other than numbered versions
 * and `modes/`) that contains a `manifest.json`. The directory name is the
 * variant's promptVersion string (e.g. `'prompt-enhancer'`).
 */
export function discoverNamedInitialVariants(): string[] {
  const paths = getModularPromptPaths(import.meta.url)
  const initialDir = paths.getAgentDir('initial')
  if (!existsSync(initialDir)) return []

  // Use withFileTypes so we don't have to `statSync` each entry — that would
  // throw on broken symlinks, EACCES, or a TOCTOU race after `readdirSync`,
  // and discovery runs during agent factory startup where any throw crashes
  // the service. Each per-entry check is also wrapped in try/catch so a
  // single unreadable directory is skipped with a log rather than fatal.
  const variants: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(initialDir, { withFileTypes: true })
  } catch (error) {
    logger.warn('initial_agent.variant_discovery_readdir_failed', {
      initialDir,
      ...errorFields(error),
    })
    return []
  }

  for (const entry of entries) {
    if (NON_VARIANT_INITIAL_SUBDIRS.has(entry.name)) continue
    if (!entry.isDirectory()) continue
    // Explicit statSync so EACCES or a broken symlink on `manifest.json`
    // gets surfaced at startup as a warn, not silently hidden by
    // `existsSync` (which swallows every fs error as `false`) and then
    // rediscovered at request time as `initial_named_variant_unregistered`.
    // ENOENT is the normal "no manifest, not a variant" skip.
    const manifestPath = path.join(initialDir, entry.name, 'manifest.json')
    try {
      statSync(manifestPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      logger.warn('initial_agent.variant_manifest_unreadable', {
        variantName: entry.name,
        manifestPath,
        code,
        ...errorFields(error),
      })
      continue
    }
    variants.push(entry.name)
  }
  return variants.sort()
}

function modularPromptFilesFromActiveProfile(): string[] {
  return parseModularPromptFilesCsv(profileValue(MODULAR_PROMPT_FILES_KEY, '' as string))
}

// Legacy optional files (1.0, 2.0)
const LEGACY_OPTIONAL_FILES = ['attributes.md', 'guidelines.md', 'examples.md']

type ManifestEntry = { src: 'base' | 'template' | 'variant'; file: string }
type ManifestFile = { base: string; files: ManifestEntry[]; preflightTools?: string[] }

function loadFromManifest(
  promptBuilder: ReturnType<typeof createPromptBuilder>,
  paths: ReturnType<typeof getModularPromptPaths>,
  manifestPath: string,
  localDir: string,
  label: string,
): string[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestFile
  const baseDir = `initial/${manifest.base}`

  for (const entry of manifest.files) {
    const filePath = entry.src === 'base'
      ? paths.getAgentFile(baseDir, entry.file)
      : paths.getAgentFile(localDir, entry.file)

    if (!existsSync(filePath)) {
      throw new Error(`Missing manifest file: ${entry.src}/${entry.file} for ${label}`)
    }
    promptBuilder.file(filePath)
  }
  return manifest.preflightTools ?? []
}

/**
 * Build the system prompt for the Initial Agent
 */
async function buildInitialSystemPrompt(
  templateId?: string,
  promptVersion?: string,
): Promise<{ systemPrompt: string; preflightTools: string[] }> {
  const promptBuilder = createPromptBuilder()
  const paths = getModularPromptPaths(import.meta.url)

  if (templateId) {
    const templateDir = `initial/modes/${templateId}`
    const manifestPath = paths.getAgentFile(templateDir, 'manifest.json')

    if (existsSync(manifestPath)) {
      const preflightTools = loadFromManifest(promptBuilder, paths, manifestPath, templateDir, `template ${templateId}`)
      promptBuilder.file(paths.getSharedFile('communication.md'))
      promptBuilder.file(paths.getSharedFile('security.md'))
      promptBuilder.file(paths.getSharedFile('consent-requirements.md'))
      return { systemPrompt: await promptBuilder.build(), preflightTools }
    }

    // Legacy template mode: core.md + optional files
    promptBuilder.file(paths.getAgentFile(templateDir, 'core.md'))

    for (const file of LEGACY_OPTIONAL_FILES) {
      const filePath = paths.getAgentFile(templateDir, file)
      if (existsSync(filePath)) {
        promptBuilder.file(filePath)
      }
    }

    promptBuilder.file(paths.getSharedFile('communication.md'))
    promptBuilder.file(paths.getSharedFile('security.md'))
    promptBuilder.file(paths.getSharedFile('consent-requirements.md'))

    return { systemPrompt: await promptBuilder.build(), preflightTools: [] }
  }

  // Versioned mode: load from initial/<version>/
  const version = promptVersion || DEFAULT_PROMPT_VERSION
  const versionDir = `initial/${version}`

  // Manifest mode: a named version directory that composes files from a base version
  // plus its own overrides (e.g. initial/prompt-enhancer/manifest.json).
  const versionManifestPath = paths.getAgentFile(versionDir, 'manifest.json')
  if (existsSync(versionManifestPath)) {
    const preflightTools = loadFromManifest(promptBuilder, paths, versionManifestPath, versionDir, `version ${version}`)
    promptBuilder.file(paths.getSharedFile('communication.md'))
    promptBuilder.file(paths.getSharedFile('security.md'))
    promptBuilder.file(paths.getSharedFile('consent-requirements.md'))
    return { systemPrompt: await promptBuilder.build(), preflightTools }
  }

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
    promptBuilder.file(paths.getSharedFile('consent-requirements.md'))
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
    promptBuilder.file(paths.getSharedFile('consent-requirements.md'))
  }
  return { systemPrompt: await promptBuilder.build(), preflightTools: [] }
}

/**
 * Create the Initial Agent configuration
 * @param stateManager - Optional session state manager for handoff support
 * @param templateId - Optional template ID to use a custom system prompt
 * @param promptVersion - Optional prompt version (e.g., '1.0', '3.0'). Defaults to DEFAULT_PROMPT_VERSION.
 */
export async function createInitialAgent(
  stateManager?: SessionStateManager,
  templateId?: string,
  promptVersion?: string
): Promise<AgentConfig> {
  if (templateId && !getMode(templateId)) {
    throw new Error(`Unknown template: ${templateId}`)
  }

  // Base modular initial-v3 reads `initial.modularPromptFiles` from the active
  // profile per turn — keep `system` as a resolver. Templates and named
  // variants are static.
  const trimmedVersionForResolver = promptVersion?.trim() ?? ''
  const useSystemResolver = !templateId && trimmedVersionForResolver === '3.0'
  const built = useSystemResolver
    ? { systemPrompt: undefined as string | undefined, preflightTools: [] as string[] }
    : await buildInitialSystemPrompt(templateId, promptVersion)
  const staticSystemPrompt = built.systemPrompt
  const preflightTools = built.preflightTools
  const { model, modelName } = await getAgentModelWithName('fast')

  // Named manifest variants (e.g. prompt-enhancer) live at
  // `initial/<promptVersion>/` and are registered as `initial-<promptVersion>`.
  // Their agentId must match the registered id so the handoff tool and
  // telemetry logger constructed below reference the right agent — otherwise
  // logs would attribute actions to the generic `initial` agent.
  //
  // Require a non-empty *trimmed* string so a default `''` read from a
  // profile doesn't derive `initial-` / `Initial ()`.
  const trimmedPromptVersion = promptVersion?.trim() ?? ''
  const isNamedVariant =
    !templateId && trimmedPromptVersion.length > 0 && !/^\d+(\.\d+)*$/.test(trimmedPromptVersion)
  const agentId = templateId
    ? `initial-${templateId}`
    : isNamedVariant
      ? `initial-${trimmedPromptVersion}`
      : 'initial'
  const agentName = templateId
    ? `Initial (${templateId})`
    : isNamedVariant
      ? `Initial (${trimmedPromptVersion})`
      : 'Initial'

  const handoffTargetsByTemplate: Record<string, string[]> = {
    'logo-designer': ['develop', 'initial'],
    'deep-build': ['deep-build'],
  }
  const validTargets = handoffTargetsByTemplate[templateId ?? ''] ?? ['develop']

  const handoffTool = stateManager
    ? createAgentHandoffTool({
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
    tools.logoCompletionSuggestions = allAILibTools.logoCompletionSuggestions
    // No websiteRebuild — logo-designer hands off out-of-scope requests to initial
    delete tools.websiteRebuild
  }

  // ZIP import template: write uploaded files to disk
  if (templateId === 'zip-import') {
    tools.str_replace_based_edit_tool = allAILibTools.str_replace_based_edit_tool
  }

  // UI kit import: apply design tokens, write files, load kit reference
  if (templateId === 'ui-kit-import') {
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
    tools.str_replace_based_edit_tool = allAILibTools.str_replace_based_edit_tool
    tools.loadUiKit = allAILibTools.loadUiKit
  }

  // File upload: may need to apply extracted colors/fonts from classification
  if (templateId === 'file-upload') {
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
  }

  // Design-system named variant: list/install design systems and load UI kit reference
  // Covers 'design-system' and any future 'design-system-*' variants (e.g. design-system-homepage-build)
  if (isNamedVariant && trimmedPromptVersion.startsWith('design-system')) {
    // The '-attached' fork is entered when the user pre-selected a kit from the
    // gallery: the kit is force-installed, so the variant must NOT be able to
    // list or install a different one — those tools are omitted on purpose.
    // colorScheme/fontTheme stay wired on every variant.
    // NOTE (AIROBUILD-2665): these tools are now execution-locked when the kit's
    // tokens were applied in code by the forced-install path. The set/apply handlers
    // in color-scheme.ts / font-theme.ts guard on kitTokensLocked(appId) (the
    // designKitTokensLocked app-metadata marker set by forced-install.ts) and no-op
    // with a "locked" message, so the model can NOT override the deterministically-
    // applied kit palette/fonts on any turn — the interview turn here OR after handoff
    // to develop. (suggest stays unlocked: it only previews. The design-kit wizard
    // applies the kit via these tools and never sets the marker, so it stays usable.)
    // The lock lives in the
    // shared tool code, not the variant toolset, because develop runs base turns
    // too — removing the tools from one variant wouldn't cover those. This makes
    // the use-attached-kit.md "do not call colorScheme/fontTheme" directive a real
    // guarantee rather than a prompt-only hope.
    if (!trimmedPromptVersion.endsWith('-attached')) {
      tools.listDesignSystems = allAILibTools.listDesignSystems
      tools.installDesignSystem = allAILibTools.installDesignSystem
    }
    tools.loadUiKit = allAILibTools.loadUiKit
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
  }

  // Design Kit Wizard variant: design tools + brand tools + logo skill + wizard stepper
  const isDesignKitVariant = isNamedVariant && trimmedPromptVersion.startsWith('design-kit')
  if (isDesignKitVariant) {
    tools.listDesignSystems = allAILibTools.listDesignSystems
    tools.installDesignSystem = allAILibTools.installDesignSystem
    // Vibe picker: present the top-3 kit matches as preview cards for the user to
    // choose, instead of silently auto-installing (AIROBUILD-2854).
    tools.suggestDesignKits = allAILibTools.suggestDesignKits
    tools.loadUiKit = allAILibTools.loadUiKit
    tools.colorScheme = allAILibTools.colorScheme
    tools.fontTheme = allAILibTools.fontTheme
    // Design-kit-owned consolidated brand tool (identity + imagery keyword +
    // summary, plus a one-shot `get`) — replaces the shared brandBook +
    // memorySet/memoryRead so the wizard stays isolated from production tooling.
    tools.brand = allAILibTools.brand
    tools.skill = allAILibTools.skill
    tools.media = allAILibTools.media
    tools.setWizardStep = allAILibTools.setWizardStep
    // The website (site chrome + homepage) is built by `design-kit-build` sub-agents
    // and the brand showcase by a `brand-showcase` sub-agent, and the kit at
    // docs/ui-kit/ is the build spec — the wizard authors no plan file. The file editor
    // stays wired for ad-hoc refinements (e.g. the user asks to tweak a specific file
    // mid-wizard) so the agent edits directly rather than improvising (it was once
    // observed loading a nonexistent "file-edit" skill).
    tools.str_replace_based_edit_tool = allAILibTools.str_replace_based_edit_tool
    // AIROBUILD-2871/3234: parallel showcase + website generation. Instead of the old
    // sequential handoff to `develop`, the wizard fans out background sub-agents with
    // runAgent — two `design-kit-build` agents (site chrome + homepage) and a
    // `brand-showcase` agent — then blocks on awaitAgents, so the showcase and the
    // website are produced concurrently. `develop` is not dispatchable as a sub-agent
    // (not in VALID_AGENTS), which is why the website is built by `design-kit-build`.
    tools.runAgent = allAILibTools.runAgent
    tools.awaitAgents = allAILibTools.awaitAgents
    // The wizard never rebuilds an existing site. websiteRebuild performs an
    // unconditional switchAgent(...,'develop') with no step gating, which would
    // hard-hand-off mid-wizard — the exact bug we're preventing. Remove it so the
    // wizard's only route to the website build is the parallel fan-out above.
    delete tools.websiteRebuild
  }

  // AIROBUILD-2871: the design-kit wizard no longer hands off to `develop` — it
  // fans out the website build to background `design-kit-build` sub-agents (see the
  // design-kit tool block above). Withholding the handoff tool keeps the model from
  // taking the legacy sequential route. To restore the handoff fallback (spike
  // off-ramp), drop the `!isDesignKitVariant` guard here and revert the "Create
  // website" section of wizard-flow.md.
  if (handoffTool && !isDesignKitVariant) {
    tools.handoff = handoffTool
  }

  return {
    id: agentId,
    name: agentName,
    system: useSystemResolver
      ? async (): Promise<string> => (await buildInitialSystemPrompt(undefined, '3.0')).systemPrompt
      : staticSystemPrompt,
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
      ...(templateId !== 'logo-designer' && !isDesignKitVariant ? ['websiteRebuild'] : []),
      // Vibe picker (AIROBUILD-2854): suggestDesignKits presents kit cards and must
      // yield to the user to pick/skip/type. Without this the assembly turn (which is
      // designed to fire many tools in sequence) would barrel past the cards and
      // auto-install, defeating the picker.
      ...(isDesignKitVariant ? ['suggestDesignKits'] : []),
      'askQuestion',
    ],

    // The Design Kit Wizard runs the brand and website phases as one continuous turn
    // and orchestrates several sub-agents along the way. AIROBUILD-2871/3234: the brand
    // phase fans out mood-imagery + logo `task-worker` sub-agents (then awaitAgents),
    // and the website phase fans out site-chrome + homepage `design-kit-build`
    // sub-agents plus a `brand-showcase` sub-agent (then awaitAgents) — on top of the
    // foreground token writes (install/colors/fonts/brand/setProjectName/todoList/
    // setWizardStep). No plan is authored; the kit at docs/ui-kit/ is the build spec.
    // That's a lot of steps in one turn, so the budget is raised well above the
    // standard initial agent (awaitAgents blocks within a single step, not many).
    maxSteps: isDesignKitVariant ? 40 : 10,
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
        includeTemplateDescription: templateId !== 'deep-build',
      },
      preflightTools,
    }
  }
}
