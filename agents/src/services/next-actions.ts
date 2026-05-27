import { getModel } from '@airo/ai-lib'
import { generateText } from 'ai'

import { AppRepository } from '../database/repositories/AppRepository.js'
import { getConversationTokenStore, getSummaryStore } from '../memory/adapters/index.js'
import type { ConversationTokenStore, SummaryStore } from '../memory/interfaces/index.js'
import { workspaceScopeFromAppId } from '../memory/interfaces/scope.js'
import { getTodoListStore } from '../planning/adapters/index.js'
import type { TodoListStore } from '../planning/interfaces/index.js'
import { Logger } from '../logging/index.js'

const logger = Logger.create({ component: 'next-actions' })

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

  constructor(
    private summaryStore: SummaryStore = getSummaryStore(),
    private conversationTokenStore: ConversationTokenStore = getConversationTokenStore(),
    private todoListStore: TodoListStore = getTodoListStore(),
  ) {}

  async generateNextActions(appId: string, customerId?: string): Promise<NextActionsResult> {
    const app = this.appRepo.findById(appId)
    if (!app) {
      throw new Error(`App not found: ${appId}`)
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
    }

    // 3. App state
    const isPublished = !!app.publishedUrl
    contextParts.push(`=== APP STATE ===\nPublished: ${isPublished}${isPublished ? ` (${app.publishedUrl})` : ''}`)

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

    const suggestions = this.parseResponse(result.text)

    logger.info('next-actions.generated', {
      appId,
      suggestionCount: suggestions.length,
      totalTokens: result.usage?.totalTokens,
    })

    return { suggestions }
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
