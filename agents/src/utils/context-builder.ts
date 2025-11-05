import { AILibContextManager } from '../agents/ai-lib-agents/context-manager.js'
import { AppRepository } from '../database/repositories/AppRepository.js'
import type { AgentsAppContext } from '../types/websocket-context.js'
import { logger } from '../logging/index.js'

export interface ContextBuildOptions {
  appId: string
  injectFakeVisual?: boolean
  injectFakeAiEdit?: boolean
  injectFakeSelectedImages?: boolean
  userInput?: string
}

/**
 * Shared context builder function that replicates WebSocket context building logic
 * Used by both WebSocket server and debug endpoint to ensure consistency
 */
export async function buildDebugContext(options: ContextBuildOptions) {
  const { appId, injectFakeVisual = false, injectFakeAiEdit = false, injectFakeSelectedImages = false, userInput } = options
  
  // Verify app exists in database (same as WebSocket)
  const appRepo = new AppRepository()
  const app = appRepo.findById(appId)
  
  if (!app) {
    throw new Error('App not found')
  }

  // Build AgentsAppContext exactly like WebSocket server expects
  const agentsAppContext: AgentsAppContext = {
    metadata: {
      appId: app.id,
      appPath: app.path
    },
    appContext: {
      maxDirectoryDepth: 3,
      includeDirectoryListing: true,
      includePackageInfo: true,
      includeDependencyStatus: true
    }
  }

  // Inject fake visual context if requested (for debugging)
  if (injectFakeVisual) {
    agentsAppContext.visualContext = {
      page: '/dashboard',
      scroll_position: { x: 0, y: 150 },
      active_section: 'main-content',
      viewport: { width: 1920, height: 1080 },
      timestamp: Date.now()
    }
  }

  // Inject fake AI edit context if requested (for debugging)
  if (injectFakeAiEdit) {
    agentsAppContext.aiEditContext = {
      selector: '.btn-primary',
      elementInfo: {
        tagName: 'button',
        className: 'btn btn-primary rounded-md px-4 py-2',
        id: 'submit-btn',
        textContent: 'Submit Form'
      },
      devContext: {
        fileName: 'components/Button.tsx',
        componentName: 'PrimaryButton',
        lineNumber: 42
      }
    }
  }

  // Inject fake selected images if requested (for debugging)
  if (injectFakeSelectedImages) {
    agentsAppContext.selectedImages = [{
      filename: 'sample-image.jpg',
      imageUrl: 'https://example.com/images/sample-image.jpg',
      thumbnailUrl: 'https://example.com/images/sample-image-thumb.jpg',
      mediaType: 'IMAGE',
      sourceType: 'gc',
      contentType: 'image/jpeg',
      size: 1024000,
      dimensions: {
        width: 1920,
        height: 1080
      }
    }]
  }

  // Add conversation context if user input provided (for debugging)
  if (userInput) {
    agentsAppContext.conversation = {
      conversationId: 'debug-conversation',
      maxMessages: 10
    }
  }

  logger.debug('context.builder.raw_context', {
    message: 'Built raw AgentsAppContext',
    appId,
    hasAppContext: !!agentsAppContext.appContext,
    hasVisualContext: !!agentsAppContext.visualContext,
    hasAiEditContext: !!agentsAppContext.aiEditContext,
    hasSelectedImages: !!agentsAppContext.selectedImages,
    hasConversation: !!agentsAppContext.conversation
  })

  // Initialize context manager (same as WebSocket)
  const contextManager = new AILibContextManager()
  
  // Convert to enhanced context (same as WebSocket)
  const enhancedContext = contextManager.convertToEnhancedContext(agentsAppContext)
  
  // Build context messages using empty system prompt (same as WebSocket)
  const contextResult = await contextManager.buildContextMessages('', enhancedContext)
  
  logger.info('context.builder.success', {
    message: 'Built context messages',
    appId,
    messageCount: contextResult.contextMessages.length
  })

  return {
    agentsAppContext,
    enhancedContext,
    contextResult,
    contextManager
  }
}