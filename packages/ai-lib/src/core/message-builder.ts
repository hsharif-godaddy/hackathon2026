import { createLogger } from '@airo/ai-common'
import type { ModelMessage } from 'ai'
import type { AgentContext, FileInputContext } from './types.js'
import { buildHybridContent } from '../utils/image-content-builder.js'

const logger = createLogger('message-builder')

/**
 * Interface for building messages for AI SDK calls
 */
export interface MessageBuilder {
  /**
   * Build messages array for AI SDK generation
   */
  buildMessages(input: string, context?: AgentContext): ModelMessage[]

  /**
   * Build messages array with file context for AI SDK generation
   */
  buildMessagesWithFiles?(input: string, fileContext: FileInputContext, context?: AgentContext): ModelMessage[]

  /**
   * Get description of this message builder
   */
  getDescription(): string
}

/**
 * Simple message builder that creates system + user messages (current default)
 */
export class SimpleMessageBuilder implements MessageBuilder {
  constructor(private systemPrompt: string) {}

  buildMessages(input: string, context?: AgentContext): ModelMessage[] {
    const messages: ModelMessage[] = []

    // Add system message
    if (this.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.systemPrompt
      })
    }

    // Add initial context messages if provided
    if (context?.initialContextMessages && context.initialContextMessages.length > 0) {
      messages.push(...context.initialContextMessages as ModelMessage[])
    }

    // Add conversation history if provided
    if (context?.messages && context.messages.length > 0) {
      messages.push(...context.messages as ModelMessage[])
    }

    // Add user input with vision support if files are provided
    if (context?.files && context.files.length > 0) {
      const visionMessage = buildHybridContent(input, context.files)
      logger.debug('vision.build', {
        fileCount: context.files.length,
        contentType: typeof visionMessage.content,
        contentBlocks: Array.isArray(visionMessage.content) ? visionMessage.content.length : 'string',
        ...(Array.isArray(visionMessage.content) && {
          firstBlockType: visionMessage.content[0]?.type,
          hasImageBlock: visionMessage.content.some((b: any) => b.type === 'image')
        })
      })
      messages.push(visionMessage as ModelMessage)
    } else {
      messages.push({
        role: 'user',
        content: input
      })
    }

    return messages
  }

  buildMessagesWithFiles(input: string, fileContext: FileInputContext, context?: AgentContext): ModelMessage[] {
    const messages: ModelMessage[] = []

    // Add system message
    messages.push({
      role: 'system',
      content: this.systemPrompt
    })

    // Add initial context messages if provided
    if (context?.initialContextMessages && context.initialContextMessages.length > 0) {
      messages.push(...context.initialContextMessages as ModelMessage[])
    }

    // Add conversation history if provided
    if (context?.messages && context.messages.length > 0) {
      messages.push(...context.messages as ModelMessage[])
    }

    // Create file context message
    const fileContextParts: string[] = []

    if (fileContext.summary) {
      fileContextParts.push(`Files provided: ${fileContext.summary}`)
    }

    // Add individual file information
    fileContext.files.forEach((file, index) => {
      fileContextParts.push(`\n--- File ${index + 1}: ${file.metadata.filename || 'Unknown'} ---`)

      if (file.input.description) {
        fileContextParts.push(`Description: ${file.input.description}`)
      }

      fileContextParts.push(`Type: ${file.metadata.mimeType}`)
      fileContextParts.push(`Size: ${file.metadata.size} bytes`)

      if (file.warnings && file.warnings.length > 0) {
        fileContextParts.push(`Warnings: ${file.warnings.join(', ')}`)
      }

      if (file.textContent) {
        fileContextParts.push(`Content:\n${file.textContent}`)
      }

      if (file.structuredData) {
        fileContextParts.push(`Structured Data:\n${JSON.stringify(file.structuredData, null, 2)}`)
      }

      // Don't add base64 content to text parts - we'll handle images separately
    })

    // Add file context as user message
    if (fileContextParts.length > 0) {
      messages.push({
        role: 'user',
        content: fileContextParts.join('\n')
      })
    }

    // Build content for the main user message, including any images
    const messageContent: any[] = []

    // Add text input
    if (input) {
      messageContent.push({
        type: 'text',
        text: input
      })
    }

    // Add images with vision capabilities
    fileContext.files.forEach(file => {
      if (file.base64Content && file.metadata.mimeType?.startsWith('image/')) {
        messageContent.push({
          type: 'image',
          image: file.base64Content,
          mediaType: file.metadata.mimeType
        })
      }
    })

    // Add the main user message with text and images
    messages.push({
      role: 'user',
      content: messageContent.length === 1 && messageContent[0].type === 'text'
        ? messageContent[0].text  // Simple text message
        : messageContent          // Multi-part message with images
    })

    return messages
  }

  getDescription(): string {
    return 'Simple system + user message pattern with file support'
  }
}

/**
 * Caching-enabled message builder for prompt caching scenarios
 */
export class CachingMessageBuilder implements MessageBuilder {
  constructor(
    private systemPrompt: string,
  ) {}

  buildMessages(input: string, context?: AgentContext): ModelMessage[] {
    const messages: ModelMessage[] = []

    // Add system message with cache control
    if (this.systemPrompt) {
      // For caching, we need to use the experimental provider metadata format
      messages.push({
        role: 'system',
        content: this.systemPrompt,
        providerOptions: { anthropic: { cacheControl: { type: 'default' } } },
      } as ModelMessage)
    }

    // Add conversation history if provided
    if (context?.messages && context.messages.length > 0) {
      messages.push(...context.messages as ModelMessage[])
    }

    // Add user input with vision support if files are provided
    if (context?.files && context.files.length > 0) {
      const visionMessage = buildHybridContent(input, context.files)
      messages.push(visionMessage as ModelMessage)
    } else {
      messages.push({
        role: 'user',
        content: input
      })
    }

    return messages
  }

  getDescription(): string {
    return `Caching-enabled message builder`
  }
}

/**
 * Multi-turn conversation builder for complex interactions
 */
export class ConversationMessageBuilder implements MessageBuilder {
  constructor(
    private systemPrompt: string,
    private enableCaching: boolean = false
  ) {}

  buildMessages(input: string, context?: AgentContext): ModelMessage[] {
    const messages: ModelMessage[] = []

    // Add system message (with optional caching)
    if (this.systemPrompt) {
      if (this.enableCaching) {
        messages.push({
          role: 'system',
          content: this.systemPrompt,
          providerOptions: { anthropic: { cacheControl: { type: 'default' } } },
        } as ModelMessage)
      } else {
        messages.push({
          role: 'system',
          content: this.systemPrompt
        })
      }
    }

    // Add full conversation history if provided
    if (context?.messages && context.messages.length > 0) {
      messages.push(...context.messages as ModelMessage[])
    }

    // Add current user input with vision support if files are provided
    if (context?.files && context.files.length > 0) {
      const visionMessage = buildHybridContent(input, context.files)
      messages.push(visionMessage as ModelMessage)
    } else {
      messages.push({
        role: 'user',
        content: input
      })
    }

    return messages
  }

  getDescription(): string {
    return `Multi-turn conversation builder${this.enableCaching ? ' with caching' : ''}`
  }
}

/**
 * Create a simple message builder (default)
 */
export function createSimpleMessageBuilder(systemPrompt: string): MessageBuilder {
  return new SimpleMessageBuilder(systemPrompt)
}

/**
 * Create a caching-enabled message builder
 */
export function createCachingMessageBuilder(
  systemPrompt: string,
): MessageBuilder {
  return new CachingMessageBuilder(systemPrompt)
}

/**
 * Create a conversation message builder
 */
export function createConversationMessageBuilder(
  systemPrompt: string,
  enableCaching: boolean = false
): MessageBuilder {
  return new ConversationMessageBuilder(systemPrompt, enableCaching)
}
