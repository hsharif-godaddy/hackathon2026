import { Router, Request, Response, NextFunction } from 'express'
import { logger, log } from '../../logging/index.js'
import { buildDebugContext } from '../../utils/context-builder.js'
import { countTokens } from '../../utils/token-counter.js'
import { createPromptBuilder } from '@airo/ai-lib'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'
import { validateAppOwnership } from '../middleware/app-ownership.js'
import { getPersistentAssetPaths } from '../../utils/persistent-assets.js'
import { AppContextManager } from '../../services/AppContextManager.js'
import { readFile } from 'fs/promises'

const router: Router = Router()

/**
 * Custom validator that works with :appId parameter name
 * Temporarily maps appId to id for validateAppOwnership compatibility
 */
function validateAppIdParam(req: Request, res: Response, next: NextFunction): void {
  const originalAppId = req.params.appId;
  if (originalAppId) {
    req.params.id = originalAppId;
  }
  validateAppOwnership(req, res, () => {
    // Restore original param name
    if (originalAppId) {
      delete req.params.id;
    }
    next();
  });
}

// Token counting model for debug context analysis
const TOKEN_COUNTING_MODEL = 'claude-sonnet-4-6'

// Maximum token limit for context analysis
const MAX_CONTEXT_TOKENS = 150000

/**
 * Build the develop agent system prompt (same as in develop-agent.ts)
 */
async function buildDevelopSystemPrompt(): Promise<string> {
  const promptBuilder = createPromptBuilder()

  // Get modular prompt paths - need to adjust for correct path from server directory
  // Debug endpoint is in server/routes/, but prompts are in src/prompts/
  const debugModuleUrl = import.meta.url
  const srcModuleUrl = debugModuleUrl.replace('/server/routes/debug.ts', '/agents/develop-agent.ts')
  const paths = getModularPromptPaths(srcModuleUrl)

  // Load filesystem.md as a template (contains {{persistentPublicPath}} and {{persistentPrivatePath}} placeholders)
  const filesystemTemplate = await readFile(paths.getSharedFile('filesystem.md'), 'utf-8');

  // Load all modular prompt sections in order (same as develop agent)
  promptBuilder
    .file(paths.getAgentFile('develop', 'core.md'))
    .file(paths.getSharedFile('communication.md'))
    .file(paths.getAgentFile('develop', 'claude-behavior.md'))
    .template(filesystemTemplate) // Use template instead of file for dynamic path interpolation
    .file(paths.getAgentFile('develop', 'font-theme.md'))
    .file(paths.getAgentFile('develop', 'handoff.md'))
    .file(paths.getAgentFile('develop', 'backend.md'))
    .file(paths.getAgentFile('develop', 'frontend.md'))
    .file(paths.getAgentFile('develop', 'seo.md'))
    .file(paths.getAgentFile('develop', 'secrets.md'))
    .file(paths.getSharedFile('security.md'))

  // Build with context containing dynamic persistent asset paths
  const persistentAssetPaths = getPersistentAssetPaths();
  return await promptBuilder.build(persistentAssetPaths)
}

interface ContextSection {
  type: 'template' | 'app' | 'app_stable' | 'app_secrets' | 'app_media_slots' | 'visual' | 'element' | 'conversation' | 'system_prompt' | 'unused'
  role: 'system' | 'user'
  content: string
  tokenCount: number
}

interface ContextDebugResponse {
  systemPrompt: string
  contextSections: ContextSection[]
  totalTokens: number
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}

/**
 * GET /debug/context/:appId - Debug context building for an app
 */
router.get('/context/:appId', validateAppIdParam, async (req: Request, res: Response): Promise<void> => {
  try {
    const appId = req.params.appId
    if (!appId) {
      res.status(400).json({ error: 'Missing appId parameter' })
      return
    }

    const contextLogger = log.forApp(appId)
    const { injectFakeVisual, injectFakeAiEdit, userInput } = req.query

    contextLogger.info('debug.context.request', {
      injectFakeVisual: injectFakeVisual === 'true',
      injectFakeAiEdit: injectFakeAiEdit === 'true',
      hasUserInput: !!userInput
    })

    // Use shared context builder to replicate WebSocket behavior exactly
    const {
      agentsAppContext,
      enhancedContext,
      contextResult,
      contextManager
    } = await buildDebugContext({
      appId,
      injectFakeVisual: injectFakeVisual === 'true',
      injectFakeAiEdit: injectFakeAiEdit === 'true',
      ...(typeof userInput === 'string' && { userInput })
    })

    // Build system prompt separately (like develop agent does)
    const developSystemPrompt = await buildDevelopSystemPrompt()

    const { systemPrompt, contextMessages } = contextResult

    // Initialize context sections array
    const contextSections: ContextSection[] = []

    // Build conversation history if available, or create fake history for demo
    let conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []

    contextLogger.info('debug.context.conversation_check', {
      hasConversation: !!enhancedContext.conversation,
      conversationId: enhancedContext.conversation?.conversationId,
      hasUserInput: !!userInput
    })

    if (enhancedContext.conversation) {
      try {
        const executionContext = contextManager['buildExecutionContext'](enhancedContext)
        const conversationContextManager = contextManager['conversationContextManager']

        // Load individual components separately for better visualization

        // 1. Get conversation history (actual chat messages) using history loader
        const conversationId = enhancedContext.conversation.conversationId
        if (conversationId) {
          const historyLoader = conversationContextManager.getHistoryLoader()
          const historyMessages = await historyLoader.loadMessagesWithTokenLimitByConversationId(
            conversationId,
            40000,
            undefined,
            true,
            appId
          )
          conversationHistory = historyMessages.map((msg: any) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          }))
        }

        // 2. Get app context (stable, secrets, media slots) as separate sections
        if (executionContext) {
          const appContextManager = new AppContextManager()
          const appContextResult = await appContextManager.generateContextMessage(executionContext)

          if (appContextResult.stableContext) {
            const stableTokenResult = await countTokens(appContextResult.stableContext, TOKEN_COUNTING_MODEL)
            const stableTokenCount = typeof stableTokenResult === 'object' ? stableTokenResult.tokenCount : stableTokenResult
            contextSections.push({
              type: 'app_stable',
              role: 'user',
              content: appContextResult.stableContext,
              tokenCount: stableTokenCount
            })
          }

          if (appContextResult.secretsContext) {
            const secretsTokenResult = await countTokens(appContextResult.secretsContext, TOKEN_COUNTING_MODEL)
            const secretsTokenCount = typeof secretsTokenResult === 'object' ? secretsTokenResult.tokenCount : secretsTokenResult
            contextSections.push({
              type: 'app_secrets',
              role: 'user',
              content: appContextResult.secretsContext,
              tokenCount: secretsTokenCount
            })
          }

          if (appContextResult.mediaSlotsContext) {
            const mediaSlotsTokenResult = await countTokens(appContextResult.mediaSlotsContext, TOKEN_COUNTING_MODEL)
            const mediaSlotsTokenCount = typeof mediaSlotsTokenResult === 'object' ? mediaSlotsTokenResult.tokenCount : mediaSlotsTokenResult
            contextSections.push({
              type: 'app_media_slots',
              role: 'user',
              content: appContextResult.mediaSlotsContext,
              tokenCount: mediaSlotsTokenCount
            })
          }
        }

      } catch (error) {
        logger.warn('debug.context.conversation_history.failure', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Only create fake conversation history when user input is provided AND there's no real conversation
    if (userInput && conversationHistory.length === 0) {
      conversationHistory = [
        {
          role: 'user',
          content: 'Hello, can you help me build a modern landing page for my business?'
        },
        {
          role: 'assistant',
          content: 'I\'d be happy to help you build a modern landing page! Let me start by creating a clean, professional design that showcases your business effectively.'
        },
        {
          role: 'user',
          content: 'Great! I want it to have a hero section, some feature highlights, and a contact form.'
        },
        {
          role: 'assistant',
          content: 'Perfect! I\'ll create a landing page with:\n\n1. **Hero Section** - Eye-catching introduction with your main value proposition\n2. **Features Section** - Highlight your key services or benefits\n3. **Contact Form** - Easy way for visitors to get in touch\n\nLet me start building this for you.'
        },
        {
          role: 'user',
          content: userInput as string
        }
      ]
    }

    // Add conversation history as a context section if we have any (real or fake)
    if (conversationHistory.length > 0) {
      const conversationContent = conversationHistory.map((msg, index) =>
        `${index + 1}. **${msg.role.toUpperCase()}**: ${msg.content}`
      ).join('\n\n')

      const conversationTokenResult = await countTokens(conversationContent, TOKEN_COUNTING_MODEL)
      const conversationTokenCount = typeof conversationTokenResult === 'object' ? conversationTokenResult.tokenCount : conversationTokenResult

      contextSections.push({
        type: 'conversation',
        role: 'system',
        content: conversationContent,
        tokenCount: conversationTokenCount
      })
    }

    // Debug: Log what messages we got back from AI-Lib
    logger.debug('debug.context.messages_received', {
      messageCount: contextMessages.length,
      messageTypes: contextMessages.map(m => ({ role: m.role, type: (m as any).type, contentPreview: m.content.substring(0, 100) }))
    })

    // Convert context messages to sections with token counting
    // Skip app context if we loaded conversation components separately
    const hasConversationComponents = enhancedContext.conversation

    for (const message of contextMessages) {
      let sectionType: ContextSection['type'] = 'app' // default

      // Determine section type based on message type (if available) and content patterns
      if (message.content.includes('[AI Edit Context]')) {
        sectionType = 'element'
      } else if (message.content.includes('[User\'s Current Visual Context]')) {
        sectionType = 'visual'
      } else if (message.content.includes('[Current Project Context]')) {
        sectionType = 'app'
      } else if (message.content.includes('template') || message.insertionOrder === 'before_history') {
        // If it's inserted before history and not AI edit or visual, likely template
        if (!message.content.includes('[AI Edit Context]') && !message.content.includes('[User\'s Current Visual Context]') && !message.content.includes('[Current Project Context]')) {
          sectionType = 'template'
        }
      }

      // Skip app context if we already loaded it separately from conversation components
      if (hasConversationComponents && sectionType === 'app') {
        continue
      }

      const tokenCountResult = await countTokens(message.content, TOKEN_COUNTING_MODEL)
      const tokenCount = typeof tokenCountResult === 'object' ? tokenCountResult.tokenCount : tokenCountResult

      contextSections.push({
        type: sectionType,
        role: message.role,
        content: message.content,
        tokenCount
      })
    }

    // Count system prompt tokens (use developSystemPrompt not systemPrompt)
    const systemPromptTokenResult = await countTokens(developSystemPrompt, TOKEN_COUNTING_MODEL)
    const systemPromptTokens = typeof systemPromptTokenResult === 'object' ? systemPromptTokenResult.tokenCount : systemPromptTokenResult

    // Add system prompt as a section in the graph
    contextSections.unshift({
      type: 'system_prompt',
      role: 'system',
      content: developSystemPrompt,
      tokenCount: systemPromptTokens
    })

    // Calculate total tokens - ensure tokenCount is a number
    const contextTokens = contextSections.reduce((sum, section) => {
      return sum + section.tokenCount
    }, 0)
    const totalTokens = contextTokens

    // Add unused capacity section if under the limit
    const unusedTokens = MAX_CONTEXT_TOKENS - totalTokens
    if (unusedTokens > 0) {
      contextSections.push({
        type: 'unused',
        role: 'system',
        content: `Unused capacity: ${unusedTokens.toLocaleString()} tokens available out of ${MAX_CONTEXT_TOKENS.toLocaleString()} total limit`,
        tokenCount: unusedTokens
      })
    }

    const response: ContextDebugResponse = {
      systemPrompt: developSystemPrompt, // Use develop agent system prompt for debug display
      contextSections,
      totalTokens: Math.min(totalTokens, MAX_CONTEXT_TOKENS), // Cap at max limit for display
      conversationHistory
    }

    logger.info('debug.context.success', {
      appId,
      totalTokens,
      sectionCount: contextSections.length,
      systemPromptTokens,
      conversationHistoryLength: conversationHistory.length
    })

    res.json(response)

  } catch (error) {
    logger.error('debug.context.failure', {
      appId: req.params.appId,
      error: error instanceof Error ? error.message : String(error)
    })

    res.status(500).json({
      error: 'Failed to build context debug data',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

export default router
