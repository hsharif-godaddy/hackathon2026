import type { ConversationMessage, ToolCall, MessageSegment } from '../database/schema.js';
import { ConversationRepository } from '../database/repositories/ConversationRepository.js';
import { AppRepository } from '../database/repositories/AppRepository.js';
import { AppContextManager } from './AppContextManager.js';
import { TodoContextManager } from './TodoContextManager.js';
import type { AgentExecutionContext } from '../base/agent.interface.js';
import { ToolCallRenderer } from './ToolCallRenderer.js';
import { logger } from '../logging/index.js';
import { conversationContextEvents, conversationHistoryEvents, conversationTokenLimitEvents } from '../logging/events/index.js';
import { countTokens, estimateTokens } from '../utils/token-counter.js';
import { ConversationHistoryLoader } from './ConversationHistoryLoader.js';
import {
  HotFileInclusionStrategy,
  FileEditCompressionStrategy,
  FileEditInputCompressionStrategy,
  DuplicateFileReadStrategy,
  TodoListRemovalStrategy,
} from './compression/strategies/index.js';
import { CssSuggestCompressionStrategy } from './compression/strategies/CssSuggestCompressionStrategy.js';

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
  private todoContextManager: TodoContextManager;
  private historyLoader: ConversationHistoryLoader;

  constructor(conversationRepo: ConversationRepository, maxMessages: number = 10) {
    this.conversationRepo = conversationRepo;
    this.maxMessages = maxMessages;
    this.appContextManager = new AppContextManager();
    this.todoContextManager = new TodoContextManager();
    
    this.historyLoader = new ConversationHistoryLoader(conversationRepo);
    
    const hotFileStrategy = new HotFileInclusionStrategy();
    const fileEditStrategy = new FileEditCompressionStrategy(hotFileStrategy);
    const fileEditInputStrategy = new FileEditInputCompressionStrategy(hotFileStrategy);
    const duplicateFileReadStrategy = new DuplicateFileReadStrategy(hotFileStrategy);
    
    this.historyLoader.registerCompressionStrategy(hotFileStrategy);
    this.historyLoader.registerCompressionStrategy(duplicateFileReadStrategy);
    this.historyLoader.registerCompressionStrategy(fileEditStrategy);
    this.historyLoader.registerCompressionStrategy(fileEditInputStrategy);
    // Remove all todoList entries from history - persistent [Current Todo List] section is the single source of truth
    this.historyLoader.registerCompressionStrategy(new TodoListRemovalStrategy());
    // Compress cssSuggest results to only show palette names
    this.historyLoader.registerCompressionStrategy(new CssSuggestCompressionStrategy());
  }

  /**
   * Get the ConversationHistoryLoader instance for direct access
   * @returns ConversationHistoryLoader instance
   */
  getHistoryLoader(): ConversationHistoryLoader {
    return this.historyLoader;
  }


  /**
   * Build LLM messages array with conversation history
   * @param systemPrompt - The system prompt to include
   * @param currentUserMessage - The current user message
   * @param conversationId - ID of the conversation to load history from
   * @param aiEditContext - Optional AI edit context for selected elements
   * @param executionContext - Optional execution context for app context generation
   * @param selectedTodoListId - Optional ID of the currently selected todo list
   * @returns Array of messages formatted for LLM API
   */
  async buildMessages(
    systemPrompt: string,
    currentUserMessage: string,
    conversationId?: string,
    aiEditContext?: any,
    executionContext?: AgentExecutionContext,
    selectedTodoListId?: string
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
    // Use compressed token-limited loader for efficiency
    if (conversationId) {
      const historyMessages = await this.loadConversationHistoryCompressed(conversationId, executionContext);
      messages.push(...historyMessages);
    }

    // Add app context (directory listing) before AI edit context if execution context is available
    if (executionContext) {
      const appContextMessage = await this.appContextManager.generateContextMessage(executionContext);
      if (appContextMessage) {
        messages.push({ role: 'user', content: appContextMessage });
      }
    }

    // Add todo list context as a separate message (always, even if no list selected)
    if (executionContext) {
      const todoContextMessage = await this.todoContextManager.generateTodoContext(
        executionContext,
        selectedTodoListId
      );
      if (todoContextMessage) {
        messages.push({ role: 'user', content: todoContextMessage });
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
    const hasTodoContext = !!(executionContext && validatedMessages.some(msg => msg.content?.startsWith('[Current Todo List]')));
    conversationContextEvents.buildSuccess(logger, {
      conversationId,
      totalMessages: validatedMessages.length,
      systemPromptLength: systemPrompt.length,
      currentMessageLength: currentUserMessage.length,
      hasHistory: !!conversationId && validatedMessages.length > 2,
      hasAppContext,
      hasTodoContext,
      hasAiEditContext: !!aiEditContext,
      hasVisualContext: !!executionContext?.metadata?.visualContext,
      hasSelectedImages: !!(executionContext?.metadata?.selectedImages && (executionContext.metadata.selectedImages as any[]).length > 0)
    });

    return validatedMessages;
  }

  /**
   * Load conversation history with compression and token limiting
   * @param conversationId - ID of the conversation
   * @param executionContext - Execution context containing appId and agentId in metadata
   * @returns Array of LLMMessage messages from conversation history
   */
  private async loadConversationHistoryCompressed(
    conversationId: string,
    executionContext?: AgentExecutionContext
  ): Promise<LLMMessage[]> {
    const allMessages = await this.conversationRepo.getMessages(conversationId);
    if (allMessages.length === 0) {
      logger.debug('conversation.history.no_messages', { conversationId });
      return [];
    }

    const appId = executionContext?.metadata?.appId as string | undefined;
    const agentId = executionContext?.metadata?.agentId as string | undefined;
    
    if (!appId || !agentId) {
      logger.warn('conversation.history.missing_ids', { 
        conversationId, 
        hasAppId: !!appId, 
        hasAgentId: !!agentId,
        message: 'Cannot load compressed history without appId and agentId'
      });
      return [];
    }
    
    const appRepo = new AppRepository();
    const app = appRepo.findById(appId);
    const appPath = app?.path;

    const maxTokens = 40000;
    
    try {
      const llmMessages = await this.historyLoader.loadMessagesWithTokenLimit(
        appId,
        agentId,
        maxTokens,
        undefined,
        true,
        appPath
      );
      
      logger.debug('conversation.history.compressed.loaded', {
        conversationId,
        appId,
        agentId,
        messageCount: llmMessages.length,
      });
      
      return llmMessages;
    } catch (error) {
      logger.error('conversation.history.compressed.load_failure', {
        conversationId,
        appId,
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
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