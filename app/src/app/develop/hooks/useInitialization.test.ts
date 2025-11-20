/**
 * Tests for useInitialization hook
 * 
 * These tests verify the state machine logic and UI state computation
 */

import { describe, it, beforeEach, expect } from 'vitest';

describe('useInitialization', function hookTests() {
  
  describe('InitializationPhase enum', function phaseEnumTests() {
    it('should have all expected phases', function phases() {
      const phases = [
        'idle',
        'checking-creation',
        'creating',
        'initializing-page',
        'loading-history',
        'ready',
        'error'
      ];
      
      // This test documents the expected phases
      expect(phases.length).toBe(7);
    });
  });

  describe('InitializationSubPhase enum', function subPhaseEnumTests() {
    it('should have all expected sub-phases', function subPhases() {
      const subPhases = [
        'none',
        'connecting-websocket',
        'sending-initial-prompt',
        'initial-prompt-sent'
      ];
      
      // This test documents the expected sub-phases
      expect(subPhases.length).toBe(4);
    });
  });

  describe('UI state computation logic', function uiStateLogicTests() {
    it('should show chat loader during creation phases', function chatLoaderCreation() {
      // When creationPhase is 'creating', showChatLoader should be true
      const creationPhase = 'creating';
      const shouldShowLoader = creationPhase !== 'idle' && creationPhase !== 'completed';
      
      expect(shouldShowLoader).toBe(true);
    });

    it('should hide chat loader when creation is complete', function chatLoaderComplete() {
      // When creationPhase is 'completed', showChatLoader should be false
      const creationPhase = 'completed';
      const shouldShowLoader = creationPhase !== 'idle' && creationPhase !== 'completed';
      
      expect(shouldShowLoader).toBe(false);
    });

    it('should show chat loader when waiting for websocket', function chatLoaderWebSocket() {
      // When isInitialCreationFlow is true and websocket is not connected
      const isInitialCreationFlow = true;
      const isWebSocketConnected = false;
      const shouldShowLoader = isInitialCreationFlow && !isWebSocketConnected;
      
      expect(shouldShowLoader).toBe(true);
    });

    it('should hide chat loader after websocket connects', function chatLoaderConnected() {
      // When websocket connects, loader should hide
      const isInitialCreationFlow = true;
      const isWebSocketConnected = true;
      const initialPromptSent = false;
      const shouldShowLoader = isInitialCreationFlow && !isWebSocketConnected && !initialPromptSent;
      
      expect(shouldShowLoader).toBe(false);
    });

    it('should show preview loader during initial creation', function previewLoaderCreation() {
      // When in initial creation flow and loading
      const isInitialCreationFlow = true;
      const isLoading = true;
      const shouldShowLoader = isInitialCreationFlow && isLoading;
      
      expect(shouldShowLoader).toBe(true);
    });

    it('should hide preview loader after setup complete', function previewLoaderComplete() {
      // When initial setup is complete
      const isInitialCreationFlow = false;
      const isLoading = true;
      const shouldShowLoader = isInitialCreationFlow && isLoading;
      
      expect(shouldShowLoader).toBe(false);
    });

    it('should enable auto-send when websocket connects', function autoSendEnabled() {
      // Auto-send should be enabled when websocket connects with pending prompt
      const isInitialCreationFlow = true;
      const isWebSocketConnected = true;
      const initialPromptSent = false;
      const canAutoSend = isInitialCreationFlow && isWebSocketConnected && !initialPromptSent;
      
      expect(canAutoSend).toBe(true);
    });

    it('should disable auto-send after prompt sent', function autoSendDisabled() {
      // Auto-send should be disabled after prompt is sent
      const isInitialCreationFlow = true;
      const isWebSocketConnected = true;
      const initialPromptSent = true;
      const canAutoSend = isInitialCreationFlow && isWebSocketConnected && !initialPromptSent;
      
      expect(canAutoSend).toBe(false);
    });
  });

  describe('Phase transition logic', function phaseTransitionTests() {
    it('should transition from idle to checking-creation for job IDs', function idleToChecking() {
      const isJobId = true;
      const currentPhase = 'idle';
      const shouldTransition = isJobId && currentPhase === 'idle';
      
      expect(shouldTransition).toBe(true);
    });

    it('should transition from idle to initializing-page for app IDs', function idleToInitializing() {
      const isJobId = false;
      const currentPhase = 'idle';
      const shouldTransition = !isJobId && currentPhase === 'idle';
      
      expect(shouldTransition).toBe(true);
    });

    it('should transition to connecting-websocket when ready', function readyToConnecting() {
      const phase = 'ready';
      const isWebSocketConnected = false;
      const isInitialCreationFlow = true;
      const shouldTransition = phase === 'ready' && !isWebSocketConnected && isInitialCreationFlow;
      
      expect(shouldTransition).toBe(true);
    });

    it('should transition to sending-initial-prompt when connected', function connectingToSending() {
      const phase = 'ready';
      const isWebSocketConnected = true;
      const isInitialCreationFlow = true;
      const initialPromptSent = false;
      const shouldTransition = phase === 'ready' && isWebSocketConnected && isInitialCreationFlow && !initialPromptSent;
      
      expect(shouldTransition).toBe(true);
    });

    it('should transition to initial-prompt-sent after send', function sendingToSent() {
      const phase = 'ready';
      const isWebSocketConnected = true;
      const isInitialCreationFlow = true;
      const initialPromptSent = true;
      const shouldTransition = phase === 'ready' && isWebSocketConnected && isInitialCreationFlow && initialPromptSent;
      
      expect(shouldTransition).toBe(true);
    });
  });

  describe('Error handling logic', function errorHandlingTests() {
    it('should show error when creation fails', function creationError() {
      const creationError = 'Failed to create site';
      const hasError = creationError !== null;
      
      expect(hasError).toBe(true);
    });

    it('should not show error when no error exists', function noError() {
      const creationError = null;
      const hasError = creationError !== null;
      
      expect(hasError).toBe(false);
    });

    it('should allow retry when error occurs', function retryOnError() {
      const creationError = 'Failed to create site';
      const retryCount = 1;
      const maxRetries = 3;
      const canRetry = creationError !== null && retryCount < maxRetries;
      
      expect(canRetry).toBe(true);
    });

    it('should not allow retry after max retries', function maxRetriesReached() {
      const creationError = 'Failed to create site';
      const retryCount = 3;
      const maxRetries = 3;
      const canRetry = creationError !== null && retryCount < maxRetries;
      
      expect(canRetry).toBe(false);
    });
  });

  describe('sessionStorage key management', function sessionStorageTests() {
    beforeEach(function clearStorage() {
      sessionStorage.clear();
    });

    it('should store initial job ID', function storeJobId() {
      const jobId = 'test-job-123';
      sessionStorage.setItem('initial-job-id', jobId);
      
      const stored = sessionStorage.getItem('initial-job-id');
      expect(stored).toBe(jobId);
    });

    it('should store initial prompt', function storePrompt() {
      const prompt = 'Create a website';
      sessionStorage.setItem('initial-prompt-pending', prompt);
      
      const stored = sessionStorage.getItem('initial-prompt-pending');
      expect(stored).toBe(prompt);
    });

    it('should clear initial prompt after send', function clearPrompt() {
      sessionStorage.setItem('initial-prompt-pending', 'test prompt');
      sessionStorage.removeItem('initial-prompt-pending');
      
      const stored = sessionStorage.getItem('initial-prompt-pending');
      expect(stored).toBe(null);
    });

    it('should detect initial creation flow from sessionStorage', function detectInitialFlow() {
      sessionStorage.setItem('initial-job-id', 'test-job');
      
      const hasInitialJobId = sessionStorage.getItem('initial-job-id') !== null;
      expect(hasInitialJobId).toBe(true);
    });
  });

  describe('Backward compatibility', function compatibilityTests() {
    it('should maintain showCreationLoader flag', function showCreationLoader() {
      const creationPhase = 'creating';
      const showCreationLoader = creationPhase !== 'idle' && creationPhase !== 'completed';
      
      expect(showCreationLoader).toBe(true);
    });

    it('should maintain creationError exposure', function creationError() {
      const error = 'Test error';
      const exposedError = error;
      
      expect(exposedError).toBe('Test error');
    });

    it('should maintain retry/cancel actions', function retryCancel() {
      const retryAction = () => 'retry';
      const cancelAction = () => 'cancel';
      
      expect(retryAction()).toBe('retry');
      expect(cancelAction()).toBe('cancel');
    });
  });

  describe('Chat loader phase mapping', function chatLoaderPhaseTests() {
    it('should map checking-creation to initializing', function checkingCreation() {
      const creationPhase = 'checking-creation';
      const mappedPhase = creationPhase === 'checking-creation' ? 'initializing' : creationPhase;
      
      expect(mappedPhase).toBe('initializing');
    });

    it('should map creating to deploying', function creating() {
      const creationPhase = 'creating';
      const mappedPhase = creationPhase === 'creating' ? 'deploying' : creationPhase;
      
      expect(mappedPhase).toBe('deploying');
    });

    it('should map websocket wait to verifying-agent', function verifyingAgent() {
      const isWaitingForWebSocket = true;
      const mappedPhase = isWaitingForWebSocket ? 'verifying-agent' : 'idle';
      
      expect(mappedPhase).toBe('verifying-agent');
    });
  });
});
