import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import {
  type ChatMessage,
  useStreamingConversationStore,
} from './useStreamingConversationStore';

// Mock the logger
vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useStreamingConversationStore', function packageTests() {
  beforeEach(() => {
    // Reset the store to initial state before each test
    const store = useStreamingConversationStore.getState();
    act(() => {
      store.cleanup();
    });
    vi.clearAllMocks();
  });

  describe('app switching', function appSwitching() {
    it('should save state to appChatHistory when switching apps', function saveState() {
      // Set up app 1 with some state
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-1');
      });

      const userMessage: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello from app 1',
        timestamp: new Date(),
      };

      act(() => {
        useStreamingConversationStore.getState().addCompletedMessage(userMessage);
      });

      // Verify app 1 state
      const stateAfterSetup = useStreamingConversationStore.getState();
      expect(stateAfterSetup.currentAppId).toBe('app-1');
      expect(stateAfterSetup.messages).toHaveLength(1);

      // Switch to app 2
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-2');
      });

      // Verify app 1 state was saved in appChatHistory
      const cached = useStreamingConversationStore.getState().appChatHistory['app-1'];
      expect(cached).toBeDefined();
      expect(cached.messages).toHaveLength(1);
      expect(cached.messages[0].content).toBe('Hello from app 1');
    });

    it('should restore state from appChatHistory when switching back to an app', function restoreState() {
      const store = useStreamingConversationStore.getState();

      // Set up app 1 with some state
      act(() => {
        store.setCurrentAppId('app-1');
      });

      const userMessage: ChatMessage = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello from app 1',
        timestamp: new Date(),
      };

      act(() => {
        store.addCompletedMessage(userMessage);
      });

      // Switch to app 2
      act(() => {
        store.setCurrentAppId('app-2');
      });

      // Verify clean state for app 2
      expect(useStreamingConversationStore.getState().messages).toHaveLength(0);
      expect(useStreamingConversationStore.getState().streamingState).toBe('idle');

      // Set up app 2 with different state
      act(() => {
        useStreamingConversationStore.getState().addCompletedMessage({
          id: 'msg-2',
          role: 'user',
          content: 'Hello from app 2',
          timestamp: new Date(),
        });
      });

      // Switch back to app 1
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-1');
      });

      // Verify app 1 state was restored
      const restoredState = useStreamingConversationStore.getState();
      expect(restoredState.currentAppId).toBe('app-1');
      expect(restoredState.messages).toHaveLength(1);
      expect(restoredState.messages[0].content).toBe('Hello from app 1');
    });

    it('should not restore active stream - let server recovery handle it', function noRestoreActiveStream() {
      const store = useStreamingConversationStore.getState();

      // Set up app 1 with an active stream
      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('User message');
      });

      // Verify active stream exists
      expect(useStreamingConversationStore.getState().activeStream).not.toBeNull();

      // Append some content to the stream
      act(() => {
        useStreamingConversationStore.getState().appendToStream('Hello');
      });

      const activeStreamContent = useStreamingConversationStore.getState().activeStream?.content;
      expect(activeStreamContent).toBe('Hello');

      // Switch to app 2
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-2');
      });

      // Verify app 2 starts fresh
      expect(useStreamingConversationStore.getState().activeStream).toBeNull();
      expect(useStreamingConversationStore.getState().streamingState).toBe('idle');

      // Switch back to app 1
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-1');
      });

      // Active stream is NOT restored - server recovery determines stream state
      // This ensures we don't get stuck with stale "streaming" state when stream completed on server
      const state = useStreamingConversationStore.getState();
      expect(state.activeStream).toBeNull();
      expect(state.streamingState).toBe('idle');
      expect(state.isLoading).toBe(false);
      // But messages ARE restored from cache
      expect(state.messages.length).toBeGreaterThan(0);
    });

    it('should not lose data when rapidly switching between apps', function rapidSwitching() {
      const store = useStreamingConversationStore.getState();

      // Set up app 1
      act(() => {
        store.setCurrentAppId('app-1');
        store.addCompletedMessage({
          id: 'msg-1',
          role: 'user',
          content: 'App 1 message',
          timestamp: new Date(),
        });
      });

      // Set up app 2
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-2');
        useStreamingConversationStore.getState().addCompletedMessage({
          id: 'msg-2',
          role: 'user',
          content: 'App 2 message',
          timestamp: new Date(),
        });
      });

      // Rapidly switch between apps
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-1');
      });
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-2');
      });
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-1');
      });

      // Verify app 1 data is intact
      const finalState = useStreamingConversationStore.getState();
      expect(finalState.currentAppId).toBe('app-1');
      expect(finalState.messages).toHaveLength(1);
      expect(finalState.messages[0].content).toBe('App 1 message');
    });

    it('should handle switching to the same app as no-op', function sameAppNoOp() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.addCompletedMessage({
          id: 'msg-1',
          role: 'user',
          content: 'Test message',
          timestamp: new Date(),
        });
      });

      const messagesBefore = useStreamingConversationStore.getState().messages;

      // Switch to the same app
      act(() => {
        useStreamingConversationStore.getState().setCurrentAppId('app-1');
      });

      const messagesAfter = useStreamingConversationStore.getState().messages;

      // Should be the same reference (no unnecessary updates)
      expect(messagesBefore).toBe(messagesAfter);
    });
  });

  describe('#finalizeStream', function finalizeStreamTests() {
    it('should mark running tools as incomplete on finalization', function markIncomplete() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Create a weather app');
      });

      // Simulate tool_start without a matching tool_result (token truncation scenario)
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      // Verify tool is running
      const streamBefore = useStreamingConversationStore.getState().activeStream;
      expect(streamBefore?.toolCalls).toHaveLength(1);
      expect(streamBefore?.toolCalls[0].status).toBe('running');

      // Finalize the stream (simulates "complete" event arriving)
      act(() => {
        useStreamingConversationStore.getState().finalizeStream();
      });

      // activeStream should be null
      expect(useStreamingConversationStore.getState().activeStream).toBeNull();

      // The finalized message should have the tool marked as incomplete, not running
      const messages = useStreamingConversationStore.getState().messages;
      const assistantMsg = messages.find(m => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg?.toolCalls).toHaveLength(1);
      expect(assistantMsg?.toolCalls?.[0].status).toBe('incomplete');

      // Segments should also reflect incomplete status
      const toolSegment = assistantMsg?.segments?.find(s => s.type === 'tool_start');
      expect(toolSegment?.toolCall?.status).toBe('incomplete');
    });

    it('should not change completed tools during finalization', function preserveCompleted() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Build something');
      });

      // Add a tool that already completed
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          result: { success: true },
          status: 'completed',
        });
      });

      // Add another tool that is still running
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-2',
          name: 'terminalCommand',
          input: {},
          status: 'running',
        });
      });

      // Finalize
      act(() => {
        useStreamingConversationStore.getState().finalizeStream();
      });

      const assistantMsg = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.toolCalls).toHaveLength(2);
      // Completed tool stays completed
      expect(assistantMsg?.toolCalls?.find(tc => tc.id === 'tool-1')?.status).toBe('completed');
      // Running tool becomes incomplete
      expect(assistantMsg?.toolCalls?.find(tc => tc.id === 'tool-2')?.status).toBe('incomplete');
    });

    it('should set outputTokenLimitReached when finishReason is length and tools are incomplete', function outputTokenLimit() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Create a weather app');
      });

      // Add a running tool (simulates tool_start without tool_result)
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      // Finalize with finishReason: 'length'
      act(() => {
        useStreamingConversationStore.getState().finalizeStream({ finishReason: 'length' });
      });

      const assistantMsg = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.outputTokenLimitReached).toBe(true);
    });

    it('should not set outputTokenLimitReached when finishReason is not length', function noOutputTokenLimit() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Create a weather app');
      });

      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      // Finalize with finishReason: 'stop'
      act(() => {
        useStreamingConversationStore.getState().finalizeStream({ finishReason: 'stop' });
      });

      const assistantMsg = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.outputTokenLimitReached).toBeUndefined();
    });

    it('should set outputTokenLimitReached when finishReason is length even without incomplete tools', function textOnlyTruncation() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Create a weather app');
      });

      // Add a tool that completed normally (no running tools)
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          result: { success: true },
          status: 'completed',
        });
      });

      // Finalize with finishReason: 'length' — text was truncated
      act(() => {
        useStreamingConversationStore.getState().finalizeStream({ finishReason: 'length' });
      });

      const assistantMsg = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.outputTokenLimitReached).toBe(true);
    });

    it('should set connectionLost when finishReason is aborted', function connectionLost() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Build a todo app');
      });

      act(() => {
        useStreamingConversationStore.getState().finalizeStream({ finishReason: 'aborted' });
      });

      const assistantMsg = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.connectionLost).toBe(true);
    });

    it('should not set connectionLost when finishReason is not aborted', function noConnectionLost() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Build a todo app');
      });

      act(() => {
        useStreamingConversationStore.getState().finalizeStream({ finishReason: 'stop' });
      });

      const assistantMsg = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(assistantMsg?.connectionLost).toBeUndefined();
    });
  });

  describe('#addToolStartSegment', function addToolStartSegmentTests() {
    it('should update existing tool when tool_start arrives after tool_input_delta', function fixupDeltaRace() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Edit a file');
      });

      // Simulate tool_input_delta arriving first (creates tool with unknown-tool name)
      act(() => {
        useStreamingConversationStore.getState().updateToolDelta('tool-1', 'unknown-tool', '{"command":"str_replace"');
      });

      const streamBefore = useStreamingConversationStore.getState().activeStream;
      expect(streamBefore?.toolCalls).toHaveLength(1);
      expect(streamBefore?.toolCalls[0].name).toBe('unknown-tool');

      // Now tool_start arrives with correct name
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'textEditor',
          input: {},
          status: 'running',
        });
      });

      const streamAfter = useStreamingConversationStore.getState().activeStream;
      // Should have exactly 1 tool, not 2
      expect(streamAfter?.toolCalls).toHaveLength(1);
      expect(streamAfter?.toolCalls[0].name).toBe('textEditor');
      expect(streamAfter?.toolCalls[0].id).toBe('tool-1');

      // Segment should also be updated with correct name
      const toolSegment = streamAfter?.segments.find(s => s.type === 'tool_start' && s.toolCall?.id === 'tool-1');
      expect(toolSegment?.toolCall?.name).toBe('textEditor');
      expect(toolSegment?.content).toBe('Starting textEditor...');
    });

    it('should append normally when no existing tool with same ID', function normalAppend() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Edit a file');
      });

      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'textEditor',
          input: {},
          status: 'running',
        });
      });

      const stream = useStreamingConversationStore.getState().activeStream;
      expect(stream?.toolCalls).toHaveLength(1);
      expect(stream?.toolCalls[0].name).toBe('textEditor');
    });
  });

  describe('#addToolCallSegment', function addToolCallSegmentTests() {
    it('should fix up tool name when tool_call arrives with correct name', function fixupName() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Edit a file');
      });

      // Simulate delta creating tool with unknown name, then tool_start fixing it
      act(() => {
        useStreamingConversationStore.getState().updateToolDelta('tool-1', 'unknown-tool', '{"command":');
      });

      // tool_call arrives with correct name and full input
      act(() => {
        useStreamingConversationStore.getState().addToolCallSegment({
          id: 'tool-1',
          name: 'textEditor',
          input: { command: 'str_replace', path: '/app/page.tsx' },
          status: 'running',
        });
      });

      const stream = useStreamingConversationStore.getState().activeStream;
      expect(stream?.toolCalls).toHaveLength(1);
      expect(stream?.toolCalls[0].name).toBe('textEditor');

      // Segment should also have updated name and content
      const toolSegment = stream?.segments.find(s => s.type === 'tool_start' && s.toolCall?.id === 'tool-1');
      expect(toolSegment?.toolCall?.name).toBe('textEditor');
      expect(toolSegment?.content).toBe('Starting textEditor...');
    });
  });

  describe('#addToolResultSegment', function addToolResultSegmentTests() {
    it('should apply tool result to active stream', function applyToActive() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Write some code');
      });

      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          result: { success: true },
          status: 'completed',
        });
      });

      // Tool should be completed in the active stream
      const stream = useStreamingConversationStore.getState().activeStream;
      expect(stream?.toolCalls?.[0].status).toBe('completed');
      expect(stream?.toolCalls?.[0].result).toEqual({ success: true });

      // Should have a tool_result segment
      const resultSegment = stream?.segments?.find(s => s.type === 'tool_result');
      expect(resultSegment).toBeDefined();
      expect(resultSegment?.toolCall?.status).toBe('completed');
    });

    it('should apply late tool result to finalized message when activeStream is null', function lateApply() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Write some code');
      });

      // Add a tool in running state
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      // Finalize the stream (simulates complete arriving before tool_result)
      act(() => {
        useStreamingConversationStore.getState().finalizeStream();
      });

      // At this point tool is marked 'incomplete' in finalized message
      const msgBefore = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(msgBefore?.toolCalls?.[0].status).toBe('incomplete');

      // Now tool_result arrives late (race condition)
      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          result: { success: true, filePath: '/src/App.jsx' },
          status: 'completed',
        });
      });

      // The tool in the finalized message should now be updated to completed
      const msgAfter = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(msgAfter?.toolCalls?.[0].status).toBe('completed');
      expect(msgAfter?.toolCalls?.[0].result).toEqual({ success: true, filePath: '/src/App.jsx' });

      // Should have a tool_result segment added
      const resultSegment = msgAfter?.segments?.find(s => s.type === 'tool_result');
      expect(resultSegment).toBeDefined();
    });

    it('should apply multiple late tool results to same finalized message in succession', function multipleLateApply() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Write some code');
      });

      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'tool-2',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      act(() => {
        useStreamingConversationStore.getState().finalizeStream();
      });

      const msgAfterFinalize = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(msgAfterFinalize?.toolCalls).toHaveLength(2);
      expect(msgAfterFinalize?.toolCalls?.[0].status).toBe('incomplete');
      expect(msgAfterFinalize?.toolCalls?.[1].status).toBe('incomplete');

      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'tool-1',
          name: 'fileEdit',
          input: {},
          result: { success: true, path: '/a.ts' },
          status: 'completed',
        });
      });

      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'tool-2',
          name: 'fileEdit',
          input: {},
          result: { success: true, path: '/b.ts' },
          status: 'completed',
        });
      });

      const msgAfter = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(msgAfter?.toolCalls?.[0].status).toBe('completed');
      expect(msgAfter?.toolCalls?.[0].result).toEqual({ success: true, path: '/a.ts' });
      expect(msgAfter?.toolCalls?.[1].status).toBe('completed');
      expect(msgAfter?.toolCalls?.[1].result).toEqual({ success: true, path: '/b.ts' });
      const resultSegments = msgAfter?.segments?.filter(s => s.type === 'tool_result') ?? [];
      expect(resultSegments).toHaveLength(2);
    });

    it('should apply late results from stream 1 to stream 1 message when stream 2 is active', function lateResultsDuringNewStream() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('First prompt');
      });
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'stream1-tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'stream1-tool-2',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });
      act(() => {
        useStreamingConversationStore.getState().finalizeStream();
      });

      expect(useStreamingConversationStore.getState().messages).toHaveLength(2); // user1, assistant1
      const stream1Assistant = useStreamingConversationStore.getState().messages[1];
      expect(stream1Assistant?.role).toBe('assistant');
      expect(stream1Assistant?.toolCalls?.[0].status).toBe('incomplete');
      expect(stream1Assistant?.toolCalls?.[1].status).toBe('incomplete');

      act(() => {
        store.startNewStream('Second prompt');
      });

      expect(useStreamingConversationStore.getState().messages).toHaveLength(3); // user1, assistant1, user2
      expect(useStreamingConversationStore.getState().activeStream).not.toBeNull();
      const activeStream = useStreamingConversationStore.getState().activeStream;
      expect(activeStream?.toolCalls).toHaveLength(0);

      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'stream1-tool-1',
          name: 'fileEdit',
          input: {},
          result: { success: true, path: '/a.ts' },
          status: 'completed',
        });
      });
      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'stream1-tool-2',
          name: 'fileEdit',
          input: {},
          result: { success: true, path: '/b.ts' },
          status: 'completed',
        });
      });

      const messages = useStreamingConversationStore.getState().messages;
      expect(messages).toHaveLength(3);
      const stream1Msg = messages[1];
      expect(stream1Msg?.toolCalls?.[0].status).toBe('completed');
      expect(stream1Msg?.toolCalls?.[1].status).toBe('completed');
      expect(stream1Msg?.toolCalls?.[0].result).toEqual({ success: true, path: '/a.ts' });
      expect(stream1Msg?.toolCalls?.[1].result).toEqual({ success: true, path: '/b.ts' });
      const stillActive = useStreamingConversationStore.getState().activeStream;
      expect(stillActive).not.toBeNull();
      expect(stillActive?.toolCalls).toHaveLength(0);
      expect(stillActive?.segments?.filter(s => s.type === 'tool_result')).toHaveLength(0);
    });

    it('should not apply late results from stream 1 to stream 2 when stream 2 has different tool IDs', function lateResultNotAppliedToNewStreamWithTools() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('First prompt');
      });
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'stream1-tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });
      act(() => {
        useStreamingConversationStore.getState().finalizeStream();
      });

      act(() => {
        store.startNewStream('Second prompt');
      });
      act(() => {
        useStreamingConversationStore.getState().addToolStartSegment({
          id: 'stream2-tool-1',
          name: 'fileEdit',
          input: {},
          status: 'running',
        });
      });

      const activeBeforeLate = useStreamingConversationStore.getState().activeStream;
      expect(activeBeforeLate?.toolCalls).toHaveLength(1);
      expect(activeBeforeLate?.toolCalls?.[0].id).toBe('stream2-tool-1');

      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'stream1-tool-1',
          name: 'fileEdit',
          input: {},
          result: { success: true, path: '/from-stream1.ts' },
          status: 'completed',
        });
      });

      const messages = useStreamingConversationStore.getState().messages;
      const stream1Msg = messages[1];
      expect(stream1Msg?.toolCalls?.[0].id).toBe('stream1-tool-1');
      expect(stream1Msg?.toolCalls?.[0].status).toBe('completed');
      expect(stream1Msg?.toolCalls?.[0].result).toEqual({ success: true, path: '/from-stream1.ts' });

      const activeAfter = useStreamingConversationStore.getState().activeStream;
      expect(activeAfter?.toolCalls).toHaveLength(1);
      expect(activeAfter?.toolCalls?.[0].id).toBe('stream2-tool-1');
      expect(activeAfter?.toolCalls?.[0].status).toBe('running');
      expect(activeAfter?.segments?.filter(s => s.type === 'tool_result')).toHaveLength(0);
    });

    it('should not crash when no matching tool exists in finalized message', function noMatch() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.startNewStream('Write something');
      });

      // Finalize with no tools
      act(() => {
        useStreamingConversationStore.getState().finalizeStream();
      });

      // Try to add a tool result for a tool that doesn't exist
      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'nonexistent-tool',
          name: 'fileEdit',
          input: {},
          result: { success: true },
          status: 'completed',
        });
      });

      // Should not crash, message should be unchanged
      const msg = useStreamingConversationStore.getState().messages.find(m => m.role === 'assistant');
      expect(msg?.toolCalls).toHaveLength(0);
    });

    it('should not crash when there are no messages at all', function noMessages() {
      // No stream started, no messages - just call addToolResultSegment directly
      act(() => {
        useStreamingConversationStore.getState().addToolResultSegment({
          id: 'orphan-tool',
          name: 'fileEdit',
          input: {},
          result: { success: true },
          status: 'completed',
        });
      });

      // Should not crash
      expect(useStreamingConversationStore.getState().messages).toHaveLength(0);
    });
  });

  describe('agent name management', function agentNameManagement() {
    it('should set and retrieve currentAgentName', function setAndGet() {
      const store = useStreamingConversationStore.getState();

      expect(store.currentAgentName).toBeNull();

      act(() => {
        store.setCurrentAgentName('Marketing Agent');
      });

      const state = useStreamingConversationStore.getState();
      expect(state.currentAgentName).toBe('Marketing Agent');
    });

    it('should allow setting currentAgentName to null', function setNull() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAgentName('Commerce Agent');
      });

      expect(useStreamingConversationStore.getState().currentAgentName).toBe('Commerce Agent');

      act(() => {
        store.setCurrentAgentName(null);
      });

      expect(useStreamingConversationStore.getState().currentAgentName).toBeNull();
    });

    it('should reset currentAgentName when switching apps', function resetOnAppSwitch() {
      const store = useStreamingConversationStore.getState();

      act(() => {
        store.setCurrentAppId('app-1');
        store.setCurrentAgentName('Design Agent');
      });

      expect(useStreamingConversationStore.getState().currentAgentName).toBe('Design Agent');

      act(() => {
        store.setCurrentAppId('app-2');
      });

      expect(useStreamingConversationStore.getState().currentAgentName).toBeNull();
    });
  });
});
