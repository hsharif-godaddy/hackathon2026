import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageSegmentManager } from '../MessageSegmentManager.js';
import type { MessageStore } from '../../memory/interfaces/index.js';
import type { MessageSegment, ToolCall } from '../../database/schema.js';

describe('MessageSegmentManager', () => {
  let segmentManager: MessageSegmentManager;
  let mockMessageStore: MessageStore;

  beforeEach(() => {
    mockMessageStore = {
      updateMessage: vi.fn(),
    } as unknown as MessageStore;

    segmentManager = new MessageSegmentManager(mockMessageStore);
  });

  it('should maintain chronological order of content and tool calls', () => {
    // Add initial content
    segmentManager.addContentSegment('I will help you with that.');
    
    // Add a tool call
    const toolCall: ToolCall = {
      id: 'call_123',
      toolName: 'list_files',
      toolArgs: { path: '.' },
      startTime: Date.now(),
      status: 'running'
    };
    const toolSegment = segmentManager.addToolCallSegment(toolCall);

    // Add more content after tool call
    segmentManager.addContentSegment('Here are the files I found:');

    // Update tool call with results
    segmentManager.updateToolCallSegment(toolSegment.id, {
      toolResult: 'file1.txt\nfile2.js',
      endTime: Date.now(),
      status: 'success'
    });
    
    // Add final content
    segmentManager.addContentSegment('The files have been listed successfully.');

    const segments = segmentManager.getSegments();
    
    // Verify chronological order
    expect(segments).toHaveLength(4);
    expect(segments[0].type).toBe('content');
    expect(segments[0].content).toBe('I will help you with that.');
    expect(segments[1].type).toBe('tool_call');
    expect(segments[1].tool_call?.toolName).toBe('list_files');
    expect(segments[2].type).toBe('content');
    expect(segments[2].content).toBe('Here are the files I found:');
    expect(segments[3].type).toBe('content');
    expect(segments[3].content).toBe('The files have been listed successfully.');

    // Verify combined content
    const combinedContent = segmentManager.getCombinedContent();
    expect(combinedContent).toBe('I will help you with that.Here are the files I found:The files have been listed successfully.');
  });

  it('should save segments to database message', async () => {
    const messageId = 'msg_123';
    
    segmentManager.addContentSegment('Test content');
    segmentManager.addToolCallSegment({
      id: 'call_456',
      toolName: 'test_tool',
      toolArgs: {},
      status: 'success'
    });

    await segmentManager.saveToMessage(messageId);

    expect(mockMessageStore.updateMessage).toHaveBeenCalledWith(messageId, {
      content: 'Test content',
      segments: expect.arrayContaining([
        expect.objectContaining({ type: 'content', content: 'Test content' }),
        expect.objectContaining({ type: 'tool_call', tool_call: expect.objectContaining({ toolName: 'test_tool' }) })
      ]),
      metadata: { isStreaming: false }
    });
  });

  it('should load segments from existing message', () => {
    const existingSegments: MessageSegment[] = [
      {
        id: 'seg_1',
        type: 'content',
        content: 'Existing content',
        timestamp: new Date('2025-01-01T10:00:00Z')
      },
      {
        id: 'seg_2',
        type: 'tool_call',
        tool_call: {
          id: 'call_789',
          toolName: 'existing_tool',
          toolArgs: {},
          status: 'success'
        },
        timestamp: new Date('2025-01-01T10:01:00Z')
      }
    ];

    segmentManager.loadFromMessage(existingSegments);
    
    const segments = segmentManager.getSegments();
    expect(segments).toHaveLength(2);
    expect(segments[0].content).toBe('Existing content');
    expect(segments[1].tool_call?.toolName).toBe('existing_tool');
  });

  it('should find tool call segment by ID', () => {
    const toolCall: ToolCall = {
      id: 'find_me',
      toolName: 'find_tool',
      toolArgs: {},
      status: 'running'
    };
    
    segmentManager.addContentSegment('Some content');
    segmentManager.addToolCallSegment(toolCall);
    segmentManager.addContentSegment('More content');

    const foundSegment = segmentManager.findToolCallSegment('find_me');
    
    expect(foundSegment).not.toBeNull();
    expect(foundSegment?.tool_call?.toolName).toBe('find_tool');
  });

  it('should generate timeline for debugging', () => {
    segmentManager.addContentSegment('First message');
    
    const toolCall: ToolCall = {
      id: 'timeline_test',
      toolName: 'timeline_tool',
      toolArgs: {},
      status: 'success'
    };
    segmentManager.addToolCallSegment(toolCall);
    
    segmentManager.addContentSegment('Second message');

    const timeline = segmentManager.getTimeline();
    
    expect(timeline).toHaveLength(3);
    expect(timeline[0].type).toBe('content');
    expect(timeline[0].summary).toContain('Content: First message');
    expect(timeline[1].type).toBe('tool_call');
    expect(timeline[1].summary).toContain('Tool: timeline_tool (success)');
    expect(timeline[2].type).toBe('content');
    expect(timeline[2].summary).toContain('Content: Second message');
  });

  it('should handle string timestamps when loading from database', () => {
    // Simulate segments loaded from database where timestamps are strings
    const segmentsWithStringTimestamps: MessageSegment[] = [
      {
        id: 'seg_1',
        type: 'content',
        content: 'Second content',
        timestamp: '2025-01-01T10:02:00Z' as any // Simulate string timestamp from DB
      },
      {
        id: 'seg_2',
        type: 'content',
        content: 'First content',
        timestamp: '2025-01-01T10:01:00Z' as any // Simulate string timestamp from DB
      }
    ];

    segmentManager.loadFromMessage(segmentsWithStringTimestamps);
    
    // Should sort correctly despite string timestamps
    const segments = segmentManager.getSegments();
    expect(segments).toHaveLength(2);
    expect(segments[0].content).toBe('First content'); // Earlier timestamp
    expect(segments[1].content).toBe('Second content'); // Later timestamp
  });
});