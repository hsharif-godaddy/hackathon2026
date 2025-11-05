import type { ConversationMessage, ToolCall, MessageSegment } from '../database/schema.js';
import { ConversationRepository } from '../database/repositories/ConversationRepository.js';
import { AppContextManager } from './AppContextManager.js';
import { FileContextManager } from './FileContextManager.js';
import type { AgentExecutionContext } from '../base/agent.interface.js';
import { ToolCallRenderer } from './ToolCallRenderer.js';
import { logger } from '../logging/index.js';
import { conversationContextEvents, conversationHistoryEvents, conversationTokenLimitEvents } from '../logging/events/index.js';
import { countTokens, estimateTokens } from '../utils/token-counter.js';

/**
 * LLM message format for OpenAI-style APIs
 */
interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  name?: string;
}

/**
 * Manages conversation context for LLM interactions
 * Handles loading and formatting conversation history with configurable limits
 */
export class ConversationContextManager {
  private conversationRepo: ConversationRepository;
  private readonly maxMessages: number;
  private appContextManager: AppContextManager;
  private fileContextManagers = new Map<string, FileContextManager>();

  constructor(conversationRepo: ConversationRepository, maxMessages: number = 10) {
    this.conversationRepo = conversationRepo;
    this.maxMessages = maxMessages;
    this.appContextManager = new AppContextManager();
  }

  /**
   * Get or create a FileContextManager for an app
   */
  public getFileContextManager(appPath: string): FileContextManager {
    if (!this.fileContextManagers.has(appPath)) {
      this.fileContextManagers.set(appPath, new FileContextManager(appPath));
    }
    return this.fileContextManagers.get(appPath)!;
  }

  /**
   * Build LLM messages array with conversation history
   * @param systemPrompt - The system prompt to include
   * @param currentUserMessage - The current user message
   * @param conversationId - ID of the conversation to load history from
   * @param aiEditContext - Optional AI edit context for selected elements
   * @param executionContext - Optional execution context for app context generation
   * @returns Array of messages formatted for LLM API
   */
  async buildMessages(
    systemPrompt: string,
    currentUserMessage: string,
    conversationId?: string,
    aiEditContext?: any,
    executionContext?: AgentExecutionContext
  ): Promise<LLMMessage[]> {
    // Validate inputs
    if (!systemPrompt || systemPrompt.trim() === '') {
      throw new Error('System prompt cannot be empty');
    }
    if (!currentUserMessage || currentUserMessage.trim() === '') {
      throw new Error('Current user message cannot be empty');
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt.trim() }
    ];

    // Load conversation history if we have a conversation ID
    if (conversationId) {
      const historyMessages = await this.loadConversationHistory(conversationId);
      messages.push(...historyMessages);
    }

    // Add app context (directory listing) before AI edit context if execution context is available
    if (executionContext) {
      const appContextMessage = await this.appContextManager.generateContextMessage(executionContext);
      if (appContextMessage) {
        messages.push({ role: 'user', content: appContextMessage });
      }
    }

    // Add hot files context if execution context is available
    if (executionContext?.metadata?.appPath) {
      const fileContextManager = this.getFileContextManager(executionContext.metadata.appPath as string);
      const hotFilesContext = await fileContextManager.getHotFilesContext();
      if (hotFilesContext) {
        messages.push({ role: 'user', content: hotFilesContext });
      }
    }

    // Add AI edit context as a separate user message if available
    if (aiEditContext) {
      const contextMessage = this.formatAiEditContextMessage(aiEditContext);
      messages.push({ role: 'user', content: contextMessage });
    }

    // Add visual context as a separate user message if available
    if (executionContext?.metadata?.visualContext) {
      const visualContextMessage = this.formatVisualContextMessage(executionContext.metadata.visualContext);
      messages.push({ role: 'user', content: visualContextMessage });
    }

    // Add selected images context as a separate user message if available
    if (executionContext?.metadata?.selectedImages) {
      const selectedImagesMessage = this.formatSelectedImagesContextMessage(executionContext.metadata.selectedImages);
      messages.push({ role: 'user', content: selectedImagesMessage });
    }

    // Add the current user message
    messages.push({ role: 'user', content: currentUserMessage.trim() });

    // Final validation - ensure no message has empty content
    const validatedMessages = messages.filter(msg => {
      if (!msg.content || msg.content.trim() === '') {
        logger.warn('conversation.context.empty_message_filtered', {
          role: msg.role,
          hasToolCalls: !!(msg as any).tool_calls,
          hasToolCallId: !!(msg as any).tool_call_id
        });
        return false;
      }
      return true;
    });

    if (validatedMessages.length === 0) {
      throw new Error('All messages filtered out due to empty content');
    }

    // Structured logging
    const hasAppContext = executionContext && validatedMessages.some(msg => msg.content?.startsWith('[Current Project Structure]'));
    conversationContextEvents.buildSuccess(logger, {
      conversationId,
      totalMessages: validatedMessages.length,
      systemPromptLength: systemPrompt.length,
      currentMessageLength: currentUserMessage.length,
      hasHistory: !!conversationId && validatedMessages.length > 2,
      hasAppContext,
      hasAiEditContext: !!aiEditContext,
      hasVisualContext: !!executionContext?.metadata?.visualContext,
      hasSelectedImages: !!(executionContext?.metadata?.selectedImages && (executionContext.metadata.selectedImages as any[]).length > 0)
    });

    return validatedMessages;
  }

  /**
   * Load conversation history from database and convert to LLM format
   * @param conversationId - ID of the conversation
   * @returns Array of LLM messages from conversation history
   */
  private async loadConversationHistory(conversationId: string): Promise<LLMMessage[]> {
    const allMessages = await this.conversationRepo.getMessages(conversationId);
    
    // Structured logging for conversation history loading
    conversationContextEvents.loadBegin(logger, { conversationId });
    
    // Take the last N messages (excluding the current one which we'll add separately)
    // We want pairs of user/agent messages, so we take more and then trim appropriately
    const recentMessages = allMessages.slice(-(this.maxMessages * 2));
    
    if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
      conversationContextEvents.loadSuccess(logger, {
        conversationId,
        messageCount: allMessages.length,
        recentMessageCount: recentMessages.length,
        hasHistory: allMessages.length > 0,
        hasAppContext: false,
        hasAiEditContext: false,
        hasVisualContext: false,
      });
    }
    
    const llmMessages: LLMMessage[] = [];

    for (const message of recentMessages) {
      if (message.sender === 'user') {
        // For user messages, just use the content
        if (message.content && message.content.trim() !== '') {
          llmMessages.push({
            role: 'user',
            content: message.content.trim()
          });
        } else {
          logger.warn('conversation.history.empty_user_message', {
            conversationId,
            messageId: message.id
          });
        }
      } else if (message.sender === 'agent') {
        // For agent messages, reconstruct from segments if available, fallback to old format
        if (message.segments && message.segments.length > 0) {
          // Use segments for proper chronological order
          const { assistantMessages, toolMessages } = this.processMessageSegments(message.segments, conversationId);
          llmMessages.push(...assistantMessages, ...toolMessages);
        } else {
          // Fallback to old format for backward compatibility
          const assistantMessage = this.createLegacyAssistantMessage(message);
          if (assistantMessage) {
            llmMessages.push(assistantMessage);
            
            // Add tool results
            const toolMessages = this.createLegacyToolMessages(message);
            llmMessages.push(...toolMessages);
          }
        }
      }
    }

    // Ensure we don't exceed the message limit
    // Keep the most recent messages, maintaining user/assistant pairs
    if (llmMessages.length > this.maxMessages) {
      return llmMessages.slice(-this.maxMessages);
    }

    return llmMessages;
  }

  /**
   * Process message segments to create properly ordered LLM messages
   */
  private processMessageSegments(segments: MessageSegment[], conversationId?: string): {
    assistantMessages: LLMMessage[];
    toolMessages: LLMMessage[];
  } {
    // Sort segments by timestamp to maintain chronological order
    const sortedSegments = segments.sort((a, b) => {
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
    
    const assistantMessages: LLMMessage[] = [];
    const toolMessages: LLMMessage[] = [];
    
    let currentAssistantMessage: LLMMessage | null = null;
    let contentAccumulator = '';
    const toolCallsAccumulator: any[] = [];
    
    for (const segment of sortedSegments) {
      if (segment.type === 'content' && segment.content) {
        contentAccumulator += segment.content;
      } else if (segment.type === 'tool_call' && segment.tool_call) {
        // Only include tool calls that have results to avoid Bedrock validation errors
        if (!segment.tool_call.tool_result) {
          if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
          logger.warn('conversation.history.tool_call.skipped', {
            conversationId,
            toolCallId: segment.tool_call.id,
            reason: 'no_result',
          });
        }
          continue;
        }

        // When we encounter a tool call, finalize the current assistant message if we have content
        if (contentAccumulator.trim()) {
          if (currentAssistantMessage) {
            currentAssistantMessage.content += contentAccumulator;
          } else {
            currentAssistantMessage = {
              role: 'assistant',
              content: contentAccumulator.trim()
            };
          }
          contentAccumulator = '';
        }
        
        // Add tool call to the current assistant message (only if it has a result)
        const toolCall = this.convertSingleToolCall(segment.tool_call);
        toolCallsAccumulator.push(toolCall);
        
        // Add the tool result as a rendered tool message
        try {
          const renderedToolCall = ToolCallRenderer.renderToolCall({
            id: segment.tool_call.id,
            tool_name: segment.tool_call.tool_name,
            tool_args: segment.tool_call.tool_args,
            tool_result: segment.tool_call.tool_result,
            ...(segment.tool_call.error && { error: segment.tool_call.error })
          });
          
          toolMessages.push(renderedToolCall);
        } catch (error) {
          logger.warn('conversation.history.tool_call.render_failure', {
            conversationId,
            toolCallId: segment.tool_call.id,
            error: (error as Error).message,
          });
          // Fallback to simple content
          const toolContent = typeof segment.tool_call.tool_result === 'string' 
            ? segment.tool_call.tool_result.trim()
            : JSON.stringify(segment.tool_call.tool_result);
            
          if (toolContent && toolContent !== '{}' && toolContent !== 'null') {
            toolMessages.push({
              role: 'tool',
              content: toolContent,
              tool_call_id: segment.tool_call.id,
              name: segment.tool_call.tool_name
            });
          }
        }
      }
    }
    
    // Finalize the assistant message
    if (currentAssistantMessage || contentAccumulator.trim() || toolCallsAccumulator.length > 0) {
      const finalMessage: LLMMessage = {
        role: 'assistant',
        content: (currentAssistantMessage?.content || '') + contentAccumulator.trim()
      };
      
      if (toolCallsAccumulator.length > 0) {
        finalMessage.tool_calls = toolCallsAccumulator;
      }
      
      if (finalMessage.content || finalMessage.tool_calls) {
        assistantMessages.push(finalMessage);
      }
    }
    
    return { assistantMessages, toolMessages };
  }
  
  /**
   * Create legacy assistant message for backward compatibility
   */
  private createLegacyAssistantMessage(message: ConversationMessage): LLMMessage | null {
    // Check if message has content or segments with content
    const hasMainContent = message.content && message.content.trim() !== '';
    const hasSegmentContent = message.segments && message.segments.length > 0 && 
      message.segments.some(segment => segment.type === 'content' && segment.content && segment.content.trim() !== '');
    
    if (!hasMainContent && !hasSegmentContent) {
      return null;
    }

    // Use content from segments if main content is empty but segments have content
    let messageContent = message.content;
    if ((!messageContent || messageContent.trim() === '') && hasSegmentContent) {
      messageContent = message.segments!
        .filter(segment => segment.type === 'content' && segment.content)
        .map(segment => segment.content)
        .join('');
    }

    const assistantMessage: LLMMessage = {
      role: 'assistant',
      content: messageContent.trim()
    };

    // Add tool calls if present (only those with results to avoid Bedrock validation errors)
    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolCallsWithResults = message.toolCalls.filter(tc => tc.tool_result);
      if (toolCallsWithResults.length > 0) {
        assistantMessage.tool_calls = this.convertToolCalls(toolCallsWithResults);
      }
    }

    return assistantMessage;
  }
  
  /**
   * Create legacy tool messages for backward compatibility
   */
  private createLegacyToolMessages(message: ConversationMessage): LLMMessage[] {
    const toolMessages: LLMMessage[] = [];
    
    if (message.toolCalls && message.toolCalls.length > 0) {
      for (const toolCall of message.toolCalls) {
        if (toolCall.tool_result) {
          // Render tool call using the renderer
          try {
            const renderedToolCall = ToolCallRenderer.renderToolCall({
              id: toolCall.id,
              tool_name: toolCall.tool_name,
              tool_args: toolCall.tool_args,
              tool_result: toolCall.tool_result,
              ...(toolCall.error && { error: toolCall.error })
            });
            
            toolMessages.push(renderedToolCall);
          } catch (error) {
            logger.warn('conversation.history.legacy_tool_call.render_failure', {
              conversationId: 'unknown',
              toolCallId: toolCall.id,
              error: (error as Error).message,
            });
            // Fallback to simple content
            const toolContent = typeof toolCall.tool_result === 'string'
              ? toolCall.tool_result.trim()
              : JSON.stringify(toolCall.tool_result);

            // Only add tool messages with non-empty content
            if (toolContent && toolContent !== '{}' && toolContent !== 'null') {
              toolMessages.push({
                role: 'tool',
                content: toolContent,
                tool_call_id: toolCall.id,
                name: toolCall.tool_name
              });
            }
          }
        }
      }
    }
    
    return toolMessages;
  }
  
  /**
   * Convert a single tool call to LLM API format
   */
  private convertSingleToolCall(toolCall: ToolCall): {
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  } {
    return {
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.tool_name,
        arguments: typeof toolCall.tool_args === 'string' 
          ? toolCall.tool_args 
          : JSON.stringify(toolCall.tool_args)
      }
    };
  }

  /**
   * Convert database tool calls to LLM API format
   */
  private convertToolCalls(toolCalls: ToolCall[]): Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }> {
    return toolCalls.map(toolCall => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.tool_name,
        arguments: typeof toolCall.tool_args === 'string' 
          ? toolCall.tool_args 
          : JSON.stringify(toolCall.tool_args)
      }
    }));
  }

  /**
   * Format AI edit context into a safe user message
   * @param aiEditContext - The AI edit context data
   * @returns Formatted context message
   */
  private formatAiEditContextMessage(aiEditContext: any): string {
    try {
      const elementInfo = aiEditContext.elementInfo || {};
      const devContext = aiEditContext.devContext || {};
      
      // Sanitize and validate the context data
      const sanitizedContext = {
        element: {
          tag: String(elementInfo.tagName || 'unknown').replace(/[<>]/g, ''),
          classes: String(elementInfo.className || 'none').substring(0, 200),
          id: String(elementInfo.id || 'none').substring(0, 100),
          textContent: String(elementInfo.textContent || 'none').substring(0, 300),
          selector: String(aiEditContext.selector || 'unknown').substring(0, 200)
        },
        source: {
          fileName: String(devContext.fileName || 'unknown').substring(0, 200),
          componentName: String(devContext.componentName || 'unknown').substring(0, 100),
          lineNumber: Number.isInteger(devContext.lineNumber) ? devContext.lineNumber : 'unknown'
        }
      };

      return `[AI Edit Context - Selected Element]

Element Details:
- Tag: ${sanitizedContext.element.tag}
- Classes: ${sanitizedContext.element.classes}
- ID: ${sanitizedContext.element.id}
- Text Content: "${sanitizedContext.element.textContent}"
- CSS Selector: ${sanitizedContext.element.selector}

Source Code Location:
- File: ${sanitizedContext.source.fileName}
- Component: ${sanitizedContext.source.componentName}
- Line: ${sanitizedContext.source.lineNumber}

Instructions: The following user message refers to changes for this specific selected element. Focus your edits on the code at the specified file and location.`;

    } catch (error) {
      logger.warn('conversation.context.ai_edit_format.failure', {
        error: (error as Error).message,
      });
      return '[AI Edit Context] Element selected for editing (formatting error)';
    }
  }

  /**
   * Format visual context into a safe user message
   * @param visualContext - The visual context data from iframe
   * @returns Formatted context message
   */
  private formatVisualContextMessage(visualContext: any): string {
    try {
      // Sanitize and validate the visual context data
      const sanitizedContext = {
        page: String(visualContext.page || '/').substring(0, 200),
        scroll_position: {
          x: typeof visualContext.scroll_position?.x === 'number' && !isNaN(visualContext.scroll_position.x) ? visualContext.scroll_position.x : 0,
          y: typeof visualContext.scroll_position?.y === 'number' && !isNaN(visualContext.scroll_position.y) ? visualContext.scroll_position.y : 0
        },
        active_section: visualContext.active_section ? String(visualContext.active_section).substring(0, 100) : 'unknown',
        viewport: {
          width: (typeof visualContext.viewport?.width === 'number' && !isNaN(visualContext.viewport.width)) ? visualContext.viewport.width : 0,
          height: (typeof visualContext.viewport?.height === 'number' && !isNaN(visualContext.viewport.height)) ? visualContext.viewport.height : 0
        },
        timestamp: visualContext.timestamp || Date.now()
      };

      let activePageSection = ''
      let contextNotes = ''
      
      if (sanitizedContext.active_section === 'dev-tools-initializing') {
        activePageSection = 'The user\'s preview application is loaded but visual context capture is still initializing.'
        contextNotes = 'The preview app is running and dev-tools are loading. The visual context system should be available shortly. Focus on understanding the user\'s intent from their message. When they say "this" or "here", ask for clarification about which specific element or section they\'re referring to.'
      } else if (sanitizedContext.active_section === 'iframe-blocked') {
        activePageSection = 'The user\'s preview application access is blocked or restricted.'
        contextNotes = 'Visual context cannot be captured due to technical restrictions. Focus on understanding the user\'s intent from their message context. When they use terms like "this" or "here", ask for clarification or provide general guidance.'
      } else if (sanitizedContext.active_section === 'no-iframe') {
        activePageSection = 'No preview application iframe was found.'
        contextNotes = 'The user may be referring to code or functionality in general. Focus on understanding their development needs and provide appropriate guidance.'
      } else if (sanitizedContext.active_section === 'unknown') {
        activePageSection = 'The active page section could not be determined.'
        contextNotes = `The user's message refers to content visible at their current scroll position (${sanitizedContext.scroll_position.y}px from top). When they say "this" or "here", try to understand from context what they're referring to.`
      } else {
        activePageSection = `The user is currently viewing the "${sanitizedContext.active_section}" section.`
        contextNotes = `The user's message refers to content visible at their current scroll position (${sanitizedContext.scroll_position.y}px from top). When they say "this" or "here", they likely mean elements visible in the "${sanitizedContext.active_section}" section around this scroll position.`
      }

      return `[User's Current Visual Context]

Page Information:
- Current Page: ${sanitizedContext.page}
- ${activePageSection}

Scroll Position:
- Horizontal: ${sanitizedContext.scroll_position.x}px
- Vertical: ${sanitizedContext.scroll_position.y}px

Viewport Size:
- Width: ${sanitizedContext.viewport.width}px
- Height: ${sanitizedContext.viewport.height}px

Context Notes: ${contextNotes}`;

    } catch (error) {
      logger.warn('conversation.context.visual_format.failure', {
        error: (error as Error).message,
      });
      return '[Visual Context] User context captured (formatting error)';
    }
  }

  /**
   * Format selected images context into a safe user message
   * @param selectedImages - The selected images data from Image Manager
   * @returns Formatted context message
   */
  private formatSelectedImagesContextMessage(selectedImages: any): string {
    try {
      if (!Array.isArray(selectedImages) || selectedImages.length === 0) {
        return '';
      }

      // Build context for each selected image
      const imageDescriptions = selectedImages.map((image: any, index: number) => {
        const sanitizedImage = {
          filename: String(image.filename || 'unknown').substring(0, 200),
          imageUrl: String(image.imageUrl || '').substring(0, 500),
          thumbnailUrl: String(image.thumbnailUrl || '').substring(0, 500),
          mediaType: String(image.mediaType || 'IMAGE'),
          sourceType: String(image.sourceType || 'unknown'),
          contentType: String(image.contentType || 'unknown'),
          size: typeof image.size === 'number' ? image.size : 0,
          dimensions: {
            width: typeof image.dimensions?.width === 'number' ? image.dimensions.width : 0,
            height: typeof image.dimensions?.height === 'number' ? image.dimensions.height : 0
          }
        };

        return `Image ${index + 1}:
- Filename: ${sanitizedImage.filename}
- Image URL: ${sanitizedImage.imageUrl}
- Thumbnail URL: ${sanitizedImage.thumbnailUrl}
- Media Type: ${sanitizedImage.mediaType}
- Content Type: ${sanitizedImage.contentType}
- File Size: ${(sanitizedImage.size / 1024).toFixed(2)} KB
- Dimensions: ${sanitizedImage.dimensions.width}x${sanitizedImage.dimensions.height}px`;
      }).join('\n\n');

      return `[Selected Images from Image Manager]

The user has selected ${selectedImages.length} image${selectedImages.length > 1 ? 's' : ''} from the Image Manager:

${imageDescriptions}

These images are available for use in the project. You can reference them by their URLs in your code.
When the user mentions "this image" or "the image", they are likely referring to the selected image above.`;

    } catch (error) {
      logger.warn('conversation.context.selected_images_format.failure', {
        error: (error as Error).message,
      });
      return '[Selected Images Context] Images selected (formatting error)';
    }
  }

  /**
   * Load all messages for an app/agent combination with token-based limiting
   * @param appId - ID of the app
   * @param agentId - ID of the agent
   * @param maxTokens - Maximum tokens to include (default 40k)
   * @param modelName - Model name for accurate token counting (optional)
   * @returns Array of LLM messages with token limit applied
   */
  async loadAllMessagesWithTokenLimit(
    appId: string, 
    agentId: string, 
    maxTokens: number = 40000, 
    modelName?: string
  ): Promise<LLMMessage[]> {
    conversationTokenLimitEvents.loadBegin(logger, {
      appId,
      agentId,
      maxTokens,
    });
    
    try {
      // Get all conversations for this app/agent
      const conversations = await this.conversationRepo.findByAppAndAgent(appId, agentId)
      // Log conversation discovery in debug mode
      if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
        logger.debug('conversation.token_limit.conversations_found', {
          appId,
          agentId,
          conversationsCount: conversations.length,
        });
      }
      
      // Get all messages from all conversations, ordered by timestamp
      const allMessages: Array<{
        id: string
        conversationId: string
        sender: 'user' | 'agent'
        content: string
        segments?: any[]
        toolCalls?: any[]
        createdAt: Date
      }> = []
      
      for (const conversation of conversations) {
        const messages = await this.conversationRepo.getMessages(conversation.id)
        allMessages.push(...messages.map(msg => ({
          ...msg,
          conversationId: conversation.id
        })))
      }
      
      // Sort by timestamp (newest first for token limiting, then reverse for chronological)
      allMessages.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      
      if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
        logger.debug('conversation.token_limit.messages_found', {
          appId,
          agentId,
          totalMessages: allMessages.length,
        });
      }
      
      // Apply token-based limiting
      const limitedMessages: typeof allMessages = []
      let currentTokenCount = 0
      
      for (const message of allMessages) {
        const messageContent = message.content || ''
        
        // Count tokens using proper tokenizer if model name provided, otherwise use estimation
        let messageTokens: number
        if (modelName && messageContent.trim()) {
          try {
            const result = countTokens(messageContent, modelName)
            messageTokens = result.tokenCount
            
            if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
              logger.debug('conversation.token_limit.token_count', {
                messageId: message.id,
                contentLength: messageContent.length,
                tokenCount: messageTokens,
                provider: result.provider,
                modelName: result.normalizedModelName,
              });
            }
          } catch (error) {
            // Fallback to estimation if token counting fails
            messageTokens = estimateTokens(messageContent)
            logger.warn('conversation.token_limit.fallback_estimation', {
              messageId: message.id,
              error: (error as Error).message,
              estimatedTokens: messageTokens,
            });
          }
        } else {
          // Use estimation when no model name provided
          messageTokens = estimateTokens(messageContent)
        }
        
        // Check if adding this message would exceed token limit
        if (currentTokenCount + messageTokens > maxTokens && limitedMessages.length > 0) {
          if (process.env.DEBUG_CONVERSATION_HISTORY === 'true') {
            logger.info('conversation.token_limit.limit_reached', {
              appId,
              agentId,
              processedMessages: limitedMessages.length,
              currentTokens: currentTokenCount,
              maxTokens,
              modelName: modelName || 'unknown',
            });
          }
          break
        }
        
        limitedMessages.push(message)
        currentTokenCount += messageTokens
      }
      
      // Reverse to get chronological order (oldest first)
      limitedMessages.reverse()
      
      // Convert to LLM messages
      const llmMessages: LLMMessage[] = []
      
      for (const message of limitedMessages) {
        if (message.sender === 'user') {
          if (message.content && message.content.trim() !== '') {
            llmMessages.push({
              role: 'user',
              content: message.content.trim()
            })
          }
        } else if (message.sender === 'agent') {
          // Process agent messages with segments or fallback to legacy
          if (message.segments && message.segments.length > 0) {
            const { assistantMessages, toolMessages } = this.processMessageSegments(message.segments, message.conversationId)
            llmMessages.push(...assistantMessages, ...toolMessages)
          } else {
            // Fallback to legacy format
            const assistantMessage = this.createLegacyAssistantMessage(message)
            if (assistantMessage) {
              llmMessages.push(assistantMessage)
              const toolMessages = this.createLegacyToolMessages(message)
              llmMessages.push(...toolMessages)
            }
          }
        }
      }
      
      // Debug logging
      const messagesByRole = llmMessages.reduce((acc, msg) => {
        acc[msg.role] = (acc[msg.role] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      
      const toolMessages = llmMessages.filter(msg => msg.role === 'tool')
      const assistantMessagesWithTools = llmMessages.filter(msg => 
        msg.role === 'assistant' && 'tool_calls' in msg && (msg as any).tool_calls?.length > 0
      )
      
      conversationTokenLimitEvents.loadSuccess(logger, {
        appId,
        agentId,
        conversationsFound: conversations.length,
        totalDbMessages: allMessages.length,
        processedMessages: limitedMessages.length,
        estimatedTokens: currentTokenCount,
        maxTokens,
        modelName: modelName || 'estimation',
        messageDistribution: messagesByRole,
      });
      
      return llmMessages
      
    } catch (error) {
      conversationTokenLimitEvents.loadFailure(logger, error as Error, {
        appId,
        agentId,
        maxTokens,
      });
      return [];
    }
  }

  /**
   * Record a file modification operation
   */
  recordFileModification(appPath: string, filePath: string, success: boolean): void {
    const fileContextManager = this.getFileContextManager(appPath);
    fileContextManager.recordFileModification(filePath, success);
  }

  /**
   * Record a file read operation
   */
  recordFileRead(appPath: string, filePath: string): void {
    const fileContextManager = this.getFileContextManager(appPath);
    fileContextManager.recordFileRead(filePath);
  }

  /**
   * Get file context summary for an app
   */
  getFileContextSummary(appPath: string): {
    totalFiles: number;
    hotFiles: number;
    totalTokensUsed: number;
  } {
    const fileContextManager = this.getFileContextManager(appPath);
    return fileContextManager.getSummary();
  }

  /**
   * Prune old file context entries for memory management
   */
  pruneFileContexts(): void {
    for (const fileContextManager of this.fileContextManagers.values()) {
      fileContextManager.pruneOldEntries();
    }
  }

  /**
   * Get conversation summary for debugging
   */
  async getConversationSummary(conversationId: string): Promise<{
    totalMessages: number;
    recentMessages: number;
    messageTypes: Record<string, number>;
  }> {
    const allMessages = await this.conversationRepo.getMessages(conversationId);
    const recentMessages = allMessages.slice(-(this.maxMessages * 2));

    const messageTypes: Record<string, number> = {};
    for (const message of allMessages) {
      messageTypes[message.sender] = (messageTypes[message.sender] || 0) + 1;
    }

    return {
      totalMessages: allMessages.length,
      recentMessages: recentMessages.length,
      messageTypes
    };
  }
}