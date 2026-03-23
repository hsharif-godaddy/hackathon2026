import type { MessageSegment, ToolCall } from '../database/schema.js';
import { ConversationRepository } from '../database/repositories/ConversationRepository.js';

/**
 * Manages message segments to maintain proper chronological order of content and tool calls
 * This ensures conversation replay shows tool calls interspersed at the correct positions
 */
export class MessageSegmentManager {
  private segments: MessageSegment[] = [];
  private conversationRepo: ConversationRepository;

  constructor(conversationRepo: ConversationRepository) {
    this.conversationRepo = conversationRepo;
  }

  /**
   * Add a content segment to the message
   */
  addContentSegment(content: string): MessageSegment {
    const segment: MessageSegment = {
      id: this.generateSegmentId(),
      type: 'content',
      content: content.trim(),
      timestamp: new Date()
    };

    this.segments.push(segment);
    return segment;
  }

  /**
   * Add a tool call segment to the message
   */
  addToolCallSegment(toolCall: ToolCall): MessageSegment {
    const segment: MessageSegment = {
      id: this.generateSegmentId(),
      type: 'tool_call',
      tool_call: toolCall,
      timestamp: new Date()
    };

    this.segments.push(segment);
    return segment;
  }

  /**
   * Update an existing tool call segment (e.g., when tool completes)
   */
  updateToolCallSegment(segmentId: string, toolCall: Partial<ToolCall>): MessageSegment | null {
    const segment = this.segments.find(s => s.id === segmentId);
    if (segment?.type === 'tool_call' && segment.tool_call) {
      segment.tool_call = { ...segment.tool_call, ...toolCall };
      return segment;
    }
    return null;
  }

  /**
   * Get all segments in chronological order
   */
  getSegments(): MessageSegment[] {
    return [...this.segments].sort((a, b) => {
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
      return timeA - timeB;
    });
  }

  /**
   * Get the combined content from all content segments
   */
  getCombinedContent(): string {
    return this.segments
      .filter(s => s.type === 'content' && s.content)
      .map(s => s.content)
      .join('');
  }

  /**
   * Get all tool calls from tool call segments (for backward compatibility)
   */
  getToolCalls(): ToolCall[] {
    return this.segments
      .filter(s => s.type === 'tool_call' && s.tool_call)
      .map(s => s.tool_call!)
      .sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
  }

  /**
   * Save the current segments to the database message
   */
  async saveToMessage(messageId: string): Promise<void> {
    const combinedContent = this.getCombinedContent();
    const segments = this.getSegments();

    await this.conversationRepo.updateMessage(messageId, {
      content: combinedContent,
      segments: segments,
      metadata: { isStreaming: false }
    });
  }

  /**
   * Load segments from an existing message
   */
  loadFromMessage(segments?: MessageSegment[]): void {
    if (segments && segments.length > 0) {
      this.segments = [...segments];
    } else {
      this.segments = [];
    }
  }

  /**
   * Clear all segments
   */
  clear(): void {
    this.segments = [];
  }

  /**
   * Generate a unique segment ID
   */
  private generateSegmentId(): string {
    return `seg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Find a tool call segment by tool call ID
   */
  findToolCallSegment(toolCallId: string): MessageSegment | null {
    return this.segments.find(s => 
      s.type === 'tool_call' && 
      s.tool_call?.id === toolCallId
    ) || null;
  }

  /**
   * Get conversation timeline for debugging
   */
  getTimeline(): Array<{ timestamp: Date; type: string; summary: string }> {
    return this.segments.map(segment => ({
      timestamp: segment.timestamp,
      type: segment.type,
      summary: segment.type === 'content' 
        ? `Content: ${(segment.content || '').substring(0, 50)}...`
        : `Tool: ${segment.tool_call?.tool_name} (${segment.tool_call?.status})`
    }));
  }
}