import { isSecretsComposerSuccessUserContent } from '@airo/shared'
import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'
import type { SkillAnnouncement } from '@airo/ai-skills'

import { AppRepository } from '../database/repositories/AppRepository.js'
import { MemoryRepository } from '../database/repositories/MemoryRepository.js'
import { getConversationTokenStore, getSummaryStore } from '../memory/adapters/index.js'
import type { ConversationTokenStore, SummaryStore } from '../memory/interfaces/index.js'
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js'
import { getTodoListStore } from '../planning/adapters/index.js'
import type { TodoListStore } from '../planning/interfaces/index.js'
import { skillToolManager } from '../tools/skill-tool-manager.js'
import { getActiveAgentContext } from '../lib/agent-context-storage.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'next-actions' })
/** How many skill-provided "pending capability" items to prepend, at most. */
const MAX_SKILL_SUGGESTIONS = 2
/** Hard cap on the combined suggestion list returned to the client. */
const MAX_TOTAL_SUGGESTIONS = 4

/**
 * Reports the not-yet-built capabilities installed skills want to suggest for an
 * app. Injected so it can be stubbed in tests; the default fans out to every skill
 * that exposes the generic announcement hook, without naming any skill.
 */
export type SkillAnnouncementsCollector = (
  appId: string,
  appPath: string,
) => Promise<SkillAnnouncement[]>

const defaultSkillAnnouncementsCollector: SkillAnnouncementsCollector = async (appId, appPath) => {
  const reports = await skillToolManager.collectAppAnnouncements({ appId, appPath })
  return reports.flatMap(report => report.report.announcements)
}


interface NextActionSuggestion {
  text: string
}

interface NextActionsResult {
  suggestions: NextActionSuggestion[]
}

const SYSTEM_PROMPT = `You suggest 2-4 next actions for a web app builder user based on their conversation history.

Return ONLY a JSON array: [{"text": "action description"}, ...]
Return an empty array [] when suggestions are NOT appropriate.

Do NOT suggest actions when the assistant's last message:
- Asks a question or requests input (e.g. "Any of these resonate?", "What do you think?", "Which option do you prefer?")
- Presents options, names, or ideas for the user to review or choose from
- Requests clarification or confirmation
- Is waiting for the user to make a decision

In these cases the user needs to respond to the assistant, not start a new task. Return [].

Global actions (suggest when appropriate):
| Action | When to suggest |
|--------|----------------|
| Publish your site | App not yet published |
| Connect a custom domain | App is published but no custom domain |
| Optimize for search engines | App is published, no SEO work done |
| Set up social media sharing | App is published |

Rules:
- Prioritize work mentioned in the Pending section of the summary
- Suggest specific features/improvements based on what's been built
- Don't suggest what's already completed
- Keep suggestions concise and actionable (user clicks one to send as a message to the AI developer)
- 2-4 suggestions maximum`

export class NextActionsService {
  private appRepo = new AppRepository()
  private memoryRepository = new MemoryRepository()

  constructor(
    private summaryStore: SummaryStore = getSummaryStore(),
    private conversationTokenStore: ConversationTokenStore = getConversationTokenStore(),
    private todoListStore: TodoListStore = getTodoListStore(),
    private skillAnnouncementsCollector: SkillAnnouncementsCollector = defaultSkillAnnouncementsCollector,
  ) {}

  async generateNextActions(appId: string, customerId?: string): Promise<NextActionsResult> {
    const app = this.appRepo.findById(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
    }

    try {
      const agentModeResult = await this.memoryRepository.get(appId, 'app.agent_mode')
      if (agentModeResult.success && agentModeResult.exists && agentModeResult.value === 'deep-build') {
        return { suggestions: [] }
      }
    } catch (error: unknown) {
      logger.warn('next-actions.agent-mode.lookup-failed', { appId, error })
    }

    const scope = workspaceScopeFromAppId(appId, customerId)
    const contextParts: string[] = []

    // 1. Existing conversation summary
    const summary = await this.summaryStore.findLatestForApp(scope)
    if (summary?.summaryText) {
      contextParts.push(`=== CONVERSATION SUMMARY ===\n${summary.summaryText}`)
    }

    // 2. Recent messages since summary (or all recent messages if no summary exists)
    const recentMessages = summary?.messageRangeEnd
      ? await this.conversationTokenStore.getMessagesAfterMessageId(scope, summary.messageRangeEnd)
      : await this.conversationTokenStore.getRecentMessagesForApp(scope, 20)
    if (recentMessages.length > 0) {
      const formatted = recentMessages
        .slice(-20)
        .map(msg => {
          if (msg.sender === 'user' && msg.content) {
            return `User: ${msg.content.substring(0, 500)}`
          }
          if (msg.sender === 'agent' && msg.content) {
            return `Assistant: ${msg.content.substring(0, 500)}`
          }
          return null
        })
        .filter(Boolean)
        .join('\n\n')
      if (formatted) {
        contextParts.push(`=== RECENT MESSAGES (since last summary) ===\n${formatted}`)
      }

      const lastUserMessage = [...recentMessages].reverse().find(msg => msg.sender === 'user')
      const secretsJustSaved =
        lastUserMessage != null &&
        isSecretsComposerSuccessUserContent((lastUserMessage.content ?? '').trim())
      if (secretsJustSaved) {
        contextParts.push(
          '=== SECRETS JUST SAVED ===\n' +
            'The user just saved API credentials in the builder. Suggest 2-4 concrete build tasks ' +
            'for the developer to work on next. Do not return an empty array solely because the ' +
            "assistant's last message asked an open-ended question — chips should be actionable tasks.",
        )
      }
    }

    // 3. App state
    const isPublished = !!app.publishedUrl
    let hasCustomDomain: boolean | null = null // null = lookup not attempted or failed

    if (isPublished) {
      try {
        const domainsResult = await this.memoryRepository.get(appId, 'site.domains')
        if (domainsResult.success && domainsResult.exists) {
          hasCustomDomain = Array.isArray(domainsResult.value) && domainsResult.value.length > 0
        } else {
          hasCustomDomain = false
        }
      } catch (error) {
        logger.warn('next-actions.domains.lookup-failed', { appId, error })
      }
    }

    let appState = `Published: ${isPublished}${isPublished ? ` (${app.publishedUrl})` : ''}`
    if (isPublished) {
      if (hasCustomDomain === null) {
        appState += `\nCustom domain: unknown`
      } else {
        appState += `\nCustom domain: ${hasCustomDomain ? 'attached' : 'none'}`
      }
    }
    contextParts.push(`=== APP STATE ===\n${appState}`)

    // 4. Todo lists
    const todoLists = await this.todoListStore.getAllLists(scope)
    if (todoLists.length > 0) {
      const todoSummary = todoLists.map(list => {
        const items = list.items ?? []
        const pending = items.filter(i => !i.completed)
        const completed = items.filter(i => i.completed)
        const pendingText = pending.length > 0
          ? pending.map(i => `  - ${i.title}`).join('\n')
          : '  (all done)'
        return `${list.name} (${completed.length}/${items.length} done):\n${pendingText}`
      }).join('\n')
      contextParts.push(`=== TODO LISTS ===\n${todoSummary}`)
    }

    const userPrompt = contextParts.join('\n\n')

    logger.info('next-actions.generating', {
      appId,
      hasSummary: !!summary,
      isPublished,
      hasCustomDomain,
      todoListCount: todoLists.length,
      contextLength: userPrompt.length,
    })

    const model = await getModel('haiku')
    const result = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0.7,
      maxOutputTokens: 500,
      experimental_telemetry: { isEnabled: true, functionId: 'next-actions' },
    })
    const llmSuggestions = this.parseResponse(result.text)

    // Deterministically surface any skill-reported pending capabilities (e.g. the
    // online-appointments "next steps") in the same "Continue building" panel,
    // rather than relying on the agent to volunteer them mid-turn. Gated by the
    // `appbuilder-skill-suggestions` Switchboard flag (delivered on the agent JWT as
    // `skillSuggestionsEnabled`); when off, "Continue building" shows LLM suggestions
    // only and the skill announcement collector is never consulted.
    const skillSuggestionsEnabled = getActiveAgentContext()?.skillSuggestionsEnabled ?? false
    const pendingTodoTitles = todoLists.flatMap(list =>
      (list.items ?? []).filter(i => !i.completed).map(i => i.title),
    )
    const suggestions = skillSuggestionsEnabled
      ? await this.mergeSkillSuggestions(app.id, app.path, llmSuggestions, pendingTodoTitles)
      : llmSuggestions

    logger.info('next-actions.generated', {
      appId,
      llmSuggestionCount: llmSuggestions.length,
      suggestionCount: suggestions.length,
      totalTokens: result.usage?.totalTokens,
    })
    // Suggestion copy is customer-facing; keep it at debug so it stays out of
    // prod logs at LOG_LEVEL=info.
    logger.debug('next-actions.generated.detail', {
      appId,
      suggestions: suggestions.map(s => s.text).join(' | '),
    })

    return { suggestions }
  }

  /**
   * Prepend skill-reported pending capabilities to the LLM suggestions, deduped and
   * capped. Skill items take priority (up to MAX_SKILL_SUGGESTIONS) because they are
   * concrete, build-ready next steps; the LLM's broader suggestions fill the rest.
   * Never throws — a failing collector just yields the LLM suggestions unchanged.
   */
  private async mergeSkillSuggestions(
    appId: string,
    appPath: string,
    llmSuggestions: NextActionSuggestion[],
    pendingTodoTitles: string[],
  ): Promise<NextActionSuggestion[]> {
    let pending: SkillAnnouncement[]
    try {
      pending = await this.skillAnnouncementsCollector(appId, appPath)
    } catch (error) {
      logger.warn('next-actions.skill-suggestions-failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
      return llmSuggestions
    }
    if (pending.length === 0) return llmSuggestions

    const skillSuggestions: NextActionSuggestion[] = []
    const seen = new Set<string>()
    for (const feature of pending) {
      if (skillSuggestions.length >= MAX_SKILL_SUGGESTIONS) break
      const key = feature.label.trim().toLowerCase()
      // Skip anything already on the plan, or a duplicate skill label.
      if (!key || seen.has(key)) continue
      if (pendingTodoTitles.some(title => this.overlaps(feature.label, title))) continue
      seen.add(key)
      skillSuggestions.push({ text: feature.label })
    }
    if (skillSuggestions.length === 0) return llmSuggestions

    // Drop LLM suggestions that restate a skill item we are prepending.
    const skillTexts = skillSuggestions.map(s => s.text)
    const filteredLlm = llmSuggestions.filter(s => !skillTexts.some(text => this.overlaps(s.text, text)))

    const merged = [...skillSuggestions, ...filteredLlm].slice(0, MAX_TOTAL_SUGGESTIONS)

    // Behaviour 1 surfacing outcome: how many skill-reported pending capabilities were
    // prepended to "Continue building", and how many LLM suggestions were dropped as
    // restatements of them. `skillPendingCount` is the pre-dedup candidate pool.
    logger.info('next-actions.skill-suggestions-merged', {
      appId,
      skillPendingCount: pending.length,
      skillSuggestionCount: skillSuggestions.length,
      llmSuggestionCount: llmSuggestions.length,
      droppedLlmCount: llmSuggestions.length - filteredLlm.length,
      mergedCount: merged.length,
    })

    logger.debug('next-actions.skill-suggestions-merged.detail', {
      appId,
      skillSuggestions: skillSuggestions.map(s => s.text).join(' | '),
    })

    return merged
  }

  /**
   * Loose duplicate check (case-insensitive, bidirectional substring) matching the
   * client-side NBA/plan dedup in InputActionsPanel, so "Charge customers" ≈
   * "Charge customers when they book".
   */
  private overlaps(a: string, b: string): boolean {
    const x = a.trim().toLowerCase()
    const y = b.trim().toLowerCase()
    if (!x || !y) return false
    return x.includes(y) || y.includes(x)
  }

  private parseResponse(text: string): NextActionSuggestion[] {
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        logger.warn('next-actions.parse-no-json-array', { text: text.substring(0, 200) })
        return []
      }

      const parsed = JSON.parse(jsonMatch[0])
      if (!Array.isArray(parsed)) {
        logger.warn('next-actions.parse-not-array', { text: text.substring(0, 200) })
        return []
      }

      return parsed
        .filter((item: unknown) => item && typeof item === 'object' && typeof (item as NextActionSuggestion).text === 'string')
        .slice(0, 4)
    } catch (error) {
      logger.warn('next-actions.parse-failed', { text: text.substring(0, 200), error })
      return []
    }
  }
}
