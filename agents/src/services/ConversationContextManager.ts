import type { ConversationMessage, ToolCall, MessageSegment } from '../database/schema.js';
import { ConversationRepository } from '../database/repositories/ConversationRepository.js';

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

  constructor(conversationRepo: ConversationRepository, maxMessages: number = 5) {
    this.conversationRepo = conversationRepo;
    this.maxMessages = maxMessages;
  }

  /**
   * Build LLM messages array with conversation history
   * @param systemPrompt - The system prompt to include
   * @param currentUserMessage - The current user message
   * @param conversationId - ID of the conversation to load history from
   * @returns Array of messages formatted for LLM API
   */
  async buildMessages(
    systemPrompt: string,
    currentUserMessage: string,
    conversationId?: string
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

    // Add the current user message
    messages.push({ role: 'user', content: currentUserMessage.trim() });

    // Final validation - ensure no message has empty content
    const validatedMessages = messages.filter(msg => {
      if (!msg.content || msg.content.trim() === '') {
        console.warn(`Filtering out message with empty content: ${JSON.stringify(msg)}`);
        return false;
      }
      return true;
    });

    if (validatedMessages.length === 0) {
      throw new Error('All messages filtered out due to empty content');
    }

    // Debug logging
    console.log(`ConversationContextManager: Built ${validatedMessages.length} messages for conversation ${conversationId || 'new'}`);
    validatedMessages.forEach((msg, idx) => {
      console.log(`  Message ${idx}: ${msg.role} - ${msg.content?.substring(0, 100)}${msg.content?.length > 100 ? '...' : ''}`);
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
    
    // Take the last N messages (excluding the current one which we'll add separately)
    // We want pairs of user/agent messages, so we take more and then trim appropriately
    const recentMessages = allMessages.slice(-(this.maxMessages * 2));
    
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
          console.warn(`Skipping message ${message.id} with empty content from conversation`);
        }
      } else if (message.sender === 'agent') {
        // For agent messages, reconstruct from segments if available, fallback to old format
        if (message.segments && message.segments.length > 0) {
          // Use segments for proper chronological order
          const { assistantMessages, toolMessages } = this.processMessageSegments(message.segments);
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
  private processMessageSegments(segments: MessageSegment[]): {
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
    let toolCallsAccumulator: any[] = [];
    
    for (const segment of sortedSegments) {
      if (segment.type === 'content' && segment.content) {
        contentAccumulator += segment.content;
      } else if (segment.type === 'tool_call' && segment.tool_call) {
        // Only include tool calls that have results to avoid Bedrock validation errors
        if (!segment.tool_call.tool_result) {
          console.warn(`Skipping tool call ${segment.tool_call.id} without result in conversation history`);
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
        
        // Add the tool result as a tool message
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
    if (!message.content || message.content.trim() === '') {
      console.warn(`Skipping message ${message.id} with empty content from conversation`);
      return null;
    }

    const assistantMessage: LLMMessage = {
      role: 'assistant',
      content: message.content.trim()
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