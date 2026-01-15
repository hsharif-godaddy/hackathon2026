import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

import {
  useStreamingConversationStore,
  type ChatMessage,
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
