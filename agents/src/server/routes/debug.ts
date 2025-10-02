import { Router, Request, Response } from 'express'
import { logger } from '../../logging/index.js'
import { buildDebugContext } from '../../utils/context-builder.js'
import { countTokens } from '../../utils/token-counter.js'
import { createPromptBuilder } from '@airo/ai-lib'
import { getModularPromptPaths } from '../../utils/prompt-utils.js'

const router: Router = Router()

// Token counting model for debug context analysis
const TOKEN_COUNTING_MODEL = 'claude-sonnet-4'

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

  // Load all modular prompt sections in order (same as develop agent)
  promptBuilder
    .file(paths.getAgentFile('develop', 'core.md'))
    .file(paths.getSharedFile('communication.md'))
    .file(paths.getAgentFile('develop', 'decision-matrix.md'))
    .file(paths.getAgentFile('develop', 'approach.md'))
    .file(paths.getAgentFile('develop', 'visual-context.md'))
    .file(paths.getAgentFile('develop', 'validation.md'))
    .file(paths.getAgentFile('develop', 'design.md'))
    .file(paths.getSharedFile('security.md'))

  return await promptBuilder.build()
}

interface ContextSection {
  type: 'template' | 'app' | 'visual' | 'element' | 'conversation' | 'hot_files' | 'system_prompt' | 'unused'
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
router.get('/context/:appId', async (req: Request, res: Response): Promise<void> => {
  try {
    const appId = req.params.appId
    if (!appId) {
      res.status(400).json({ error: 'Missing appId parameter' })
      return
    }
    
    const { injectFakeVisual, injectFakeAiEdit, userInput } = req.query

    logger.info('debug.context.request', {
      appId,
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
    
    logger.info('debug.context.conversation_check', {
      hasConversation: !!enhancedContext.conversation,
      conversationId: enhancedContext.conversation?.conversationId,
      hasUserInput: !!userInput
    })
    
    if (enhancedContext.conversation) {
      try {
        const executionContext = contextManager['buildExecutionContext'](enhancedContext)
        const conversationContextManager = contextManager['conversationContextManager']
        
        // Load individual components separately for better visualization
        
        // 1. Get conversation history (actual chat messages)
        const conversationId = enhancedContext.conversation.conversationId
        if (conversationId) {
          const historyMessages = await conversationContextManager['loadConversationHistory'](
            conversationId
          )
          conversationHistory = historyMessages.map(msg => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content
          }))
        }
        
        // 2. Get app context (directory listing) as separate section
        if (executionContext) {
          const appContextMessage = await conversationContextManager['appContextManager'].generateContextMessage(executionContext)
          if (appContextMessage) {
            const appContextTokenResult = await countTokens(appContextMessage, TOKEN_COUNTING_MODEL)
            const appContextTokenCount = typeof appContextTokenResult === 'object' ? appContextTokenResult.tokenCount : appContextTokenResult
            
            contextSections.push({
              type: 'app',
              role: 'user',
              content: appContextMessage,
              tokenCount: appContextTokenCount
            })
          }
        }
        
        // 3. Get hot files context as separate section
        if (executionContext?.metadata?.appPath) {
          const fileContextManager = conversationContextManager['getFileContextManager'](executionContext.metadata.appPath as string)
          if (fileContextManager) {
            const hotFilesContext = await fileContextManager.getHotFilesContext()
            if (hotFilesContext && hotFilesContext.trim()) {
              const hotFilesTokenResult = await countTokens(hotFilesContext, TOKEN_COUNTING_MODEL)
              const hotFilesTokenCount = typeof hotFilesTokenResult === 'object' ? hotFilesTokenResult.tokenCount : hotFilesTokenResult
              
              contextSections.push({
                type: 'hot_files',
                role: 'user',
                content: hotFilesContext,
                tokenCount: hotFilesTokenCount
              })
            }
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
      const messageType = (message as any).type
      if (messageType === 'hot_files_context') {
        sectionType = 'hot_files'
      } else if (message.content.includes('[AI Edit Context]')) {
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

    // Hot files are automatically included by buildContextMessages() via buildHotFilesContextMessage()
    // No need to manually retrieve them here

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