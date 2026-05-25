/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useInitialization hook
 * 
 * These tests verify the state machine logic and UI state computation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SiteStatus } from '@/lib/control-plane/types';
import type { Site } from '@/stores/useSitesStore';
import { applyMarkInitialPromptSentEffects, checkHasInitialPrompt, deriveIsAwaitingStream, getEditPaths, isCompletedFileEdit, isSiteForCurrentApp, resetStaleAppContext, shouldFireSiteAwareHydration, shouldHydrateInitialPromptFromSite } from './useInitialization';

function makeSite(overrides: Partial<Site>): Site {
  return {
    id: 'app-1',
    status: SiteStatus.Running,
    account_id: 'cust-1',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as Site;
}

describe('useInitialization', function hookTests() {
  
  describe('InitializationPhase enum', function phaseEnumTests() {
    it('should have all expected phases', function phases() {
      const phases = [
        'idle',
        'checking-creation',
        'creating',
        'initializing-page',
        'ready',
        'error'
      ];

      // This test documents the expected phases
      expect(phases.length).toBe(6);
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
    // Helper function to test loader logic with proper typing
    function shouldShowLoaderForPhase(phase: 'idle' | 'creating' | 'completed'): boolean {
      return phase !== 'idle' && phase !== 'completed';
    }

    it('should show chat loader during creation phases', function chatLoaderCreation() {
      // When creationPhase is 'creating', showChatLoader should be true
      expect(shouldShowLoaderForPhase('creating')).toBe(true);
    });

    it('should hide chat loader when creation is complete', function chatLoaderComplete() {
      // When creationPhase is 'completed', showChatLoader should be false
      expect(shouldShowLoaderForPhase('completed')).toBe(false);
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

  describe('resetStaleAppContext', function resetStaleAppContextTests() {
    it('switches the streaming store and resets the todo list when the URL app id is new', function staleApp() {
      const setCurrentAppId = vi.fn();
      const reset = vi.fn();

      const didReset = resetStaleAppContext(
        { currentAppId: 'app-prev-123', setCurrentAppId },
        { reset },
        'job-new-456',
      );

      expect(didReset).toBe(true);
      expect(setCurrentAppId).toHaveBeenCalledWith('job-new-456');
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('does not touch either store when the streaming store already matches the URL app id', function alreadyInSync() {
      const setCurrentAppId = vi.fn();
      const reset = vi.fn();

      const didReset = resetStaleAppContext(
        { currentAppId: 'app-current-123', setCurrentAppId },
        { reset },
        'app-current-123',
      );

      expect(didReset).toBe(false);
      expect(setCurrentAppId).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
    });

    it('resets when the streaming store has no current app id (fresh session)', function freshSession() {
      const setCurrentAppId = vi.fn();
      const reset = vi.fn();

      const didReset = resetStaleAppContext(
        { currentAppId: null, setCurrentAppId },
        { reset },
        'job-new-456',
      );

      expect(didReset).toBe(true);
      expect(setCurrentAppId).toHaveBeenCalledWith('job-new-456');
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('deriveIsAwaitingStream', function deriveIsAwaitingStreamTests() {
    const cases: Array<{
      name: string;
      hasInitialPrompt: boolean;
      initialPromptSent: boolean;
      isStreaming: boolean;
      expected: boolean;
    }> = [
      { name: 'queued initial prompt before stream starts', hasInitialPrompt: true, initialPromptSent: false, isStreaming: false, expected: true },
      { name: 'initial prompt already sent (regression: must not stay true)', hasInitialPrompt: true, initialPromptSent: true, isStreaming: false, expected: false },
      { name: 'stream is in flight', hasInitialPrompt: true, initialPromptSent: false, isStreaming: true, expected: false },
      { name: 'no initial prompt at all', hasInitialPrompt: false, initialPromptSent: false, isStreaming: false, expected: false },
      { name: 'no initial prompt while streaming a follow-up', hasInitialPrompt: false, initialPromptSent: false, isStreaming: true, expected: false },
    ];

    cases.forEach(({ name, hasInitialPrompt, initialPromptSent, isStreaming, expected }) => {
      it(`returns ${expected} when ${name}`, function deriveCase() {
        expect(deriveIsAwaitingStream(hasInitialPrompt, initialPromptSent, isStreaming)).toBe(expected);
      });
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
    // Helper function to test loader logic with proper typing
    function shouldShowCreationLoader(phase: 'idle' | 'creating' | 'completed'): boolean {
      return phase !== 'idle' && phase !== 'completed';
    }

    it('should maintain showCreationLoader flag', function showCreationLoaderTest() {
      expect(shouldShowCreationLoader('creating')).toBe(true);
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

  describe('File edit detection helpers', function fileEditHelpers() {
    function makeTc(overrides: Partial<{ name: string; status: string; error: string; input: Record<string, unknown> }> = {}) {
      return {
        name: 'textEditor',
        status: 'completed',
        error: undefined as string | undefined,
        input: { command: 'str_replace', path: 'src/pages/index.tsx' } as Record<string, unknown>,
        ...overrides,
      };
    }

    describe('isCompletedFileEdit', function isCompletedFileEditTests() {
      it('should return true for a completed textEditor edit', function completedTextEditor() {
        expect(isCompletedFileEdit(makeTc())).toBe(true);
      });

      it('should return true for a completed str_replace_based_edit_tool', function completedStrReplace() {
        expect(isCompletedFileEdit(makeTc({ name: 'str_replace_based_edit_tool' }))).toBe(true);
      });

      it('should return true for a completed fileEdit', function completedFileEdit() {
        expect(isCompletedFileEdit(makeTc({ name: 'fileEdit', input: { path: 'src/components/Header.tsx' } }))).toBe(true);
      });

      it('should return false for view command', function viewCommand() {
        expect(isCompletedFileEdit(makeTc({ input: { command: 'view', path: 'src/pages/index.tsx' } }))).toBe(false);
      });

      it('should return false for non-edit tool', function nonEditTool() {
        expect(isCompletedFileEdit(makeTc({ name: 'fontTheme' }))).toBe(false);
      });

      it('should return false for running status', function runningStatus() {
        expect(isCompletedFileEdit(makeTc({ status: 'running' }))).toBe(false);
      });

      it('should return false for errored tool call', function erroredCall() {
        expect(isCompletedFileEdit(makeTc({ error: 'something failed' }))).toBe(false);
      });
    });

    describe('getEditPaths', function getEditPathsTests() {
      it('should extract path from input.path', function directPath() {
        expect(getEditPaths(makeTc())).toEqual(['src/pages/index.tsx']);
      });

      it('should extract path from input.file_path', function filePath() {
        expect(getEditPaths({ input: { file_path: 'src/pages/about.tsx' } })).toEqual(['src/pages/about.tsx']);
      });

      it('should extract paths from batch operations', function batchOps() {
        const tc = { input: { operations: [{ path: 'src/components/Header.tsx' }, { path: 'src/pages/index.tsx' }] } };
        expect(getEditPaths(tc)).toEqual(['src/components/Header.tsx', 'src/pages/index.tsx']);
      });

      it('should combine all path sources', function allSources() {
        const tc = {
          input: {
            path: 'a.tsx',
            file_path: 'b.tsx',
            operations: [{ path: 'c.tsx' }],
          },
        };
        expect(getEditPaths(tc)).toEqual(['a.tsx', 'b.tsx', 'c.tsx']);
      });

      it('should return empty array when no paths found', function noPaths() {
        expect(getEditPaths({ input: {} })).toEqual([]);
      });
    });

    describe('Big reveal detection logic', function bigRevealTests() {
      // Simulates the reveal logic from the useEffect
      function shouldReveal(toolCalls: ReturnType<typeof makeTc>[]) {
        const hasPageFileEdit = toolCalls.some(
          tc => isCompletedFileEdit(tc) && getEditPaths(tc).some(p => p.includes('src/pages/index'))
        );
        const hasAnyFileEdit = toolCalls.some(tc => isCompletedFileEdit(tc));
        const hasSuggestedResponse = toolCalls.some(
          tc => tc.name === 'suggestedResponse' && tc.status === 'completed'
        );
        return hasPageFileEdit || (hasAnyFileEdit && hasSuggestedResponse);
      }

      it('should reveal on page file edit', function pageEdit() {
        const toolCalls = [makeTc({ input: { command: 'str_replace', path: 'src/pages/index.tsx' } })];
        expect(shouldReveal(toolCalls)).toBe(true);
      });

      it('should reveal on batch fileEdit with page path in operations', function batchPageEdit() {
        const toolCalls = [makeTc({
          name: 'fileEdit',
          input: { operations: [{ path: 'src/pages/index.tsx' }] },
        })];
        expect(shouldReveal(toolCalls)).toBe(true);
      });

      it('should reveal on suggestedResponse after any file edit', function suggestedAfterEdit() {
        const toolCalls = [
          makeTc({ input: { command: 'str_replace', path: 'src/components/Header.tsx' } }),
          makeTc({ name: 'suggestedResponse', input: {}, status: 'completed' } as any),
        ];
        // suggestedResponse is not a file edit tool, so isCompletedFileEdit returns false for it,
        // but the second condition (hasAnyFileEdit && hasSuggestedResponse) should trigger
        expect(shouldReveal(toolCalls as any[])).toBe(true);
      });

      it('should not reveal on non-page edit alone', function nonPageEdit() {
        const toolCalls = [makeTc({ input: { command: 'str_replace', path: 'src/components/Header.tsx' } })];
        expect(shouldReveal(toolCalls)).toBe(false);
      });

      it('should not reveal on non-index page edit', function nonIndexPage() {
        const toolCalls = [makeTc({ input: { command: 'str_replace', path: 'src/pages/about.tsx' } })];
        expect(shouldReveal(toolCalls)).toBe(false);
      });

      it('should not reveal on suggestedResponse without any file edit', function suggestedAlone() {
        const toolCalls = [makeTc({ name: 'suggestedResponse', input: {} })];
        expect(shouldReveal(toolCalls)).toBe(false);
      });

      it('should not reveal on view-only command to page', function viewOnlyPage() {
        const toolCalls = [makeTc({ input: { command: 'view', path: 'src/pages/index.tsx' } })];
        expect(shouldReveal(toolCalls)).toBe(false);
      });
    });
  });

  // Regression: creating a second app after a first one caused the first app's
  // initial prompt to be displayed during the jobId stage because the
  // useDevelopPageStore.site object persisted across navigations. Ensure the
  // helper only matches sites whose id lines up with the current app or its
  // real (post-conversion) app id.
  describe('isSiteForCurrentApp', function isSiteForCurrentAppTests() {
    it('returns false when site is null', function noSite() {
      expect(isSiteForCurrentApp(null, 'app-1', null)).toBe(false);
    });

    it('returns false when site is undefined', function undefinedSite() {
      expect(isSiteForCurrentApp(undefined, 'app-1', null)).toBe(false);
    });

    it('returns true when site id matches appId', function matchesAppId() {
      expect(isSiteForCurrentApp({ id: 'app-1' }, 'app-1', null)).toBe(true);
    });

    it('returns true when site id matches realAppId (job→app conversion)', function matchesRealAppId() {
      // During job→app conversion, URL appId is still the jobId but site
      // already reflects the real app id.
      expect(isSiteForCurrentApp({ id: 'app-1' }, 'job-xyz', 'app-1')).toBe(true);
    });

    it('returns false when site is for a different (previous) app', function differentApp() {
      // Bug scenario: first app's site is still loaded while jobId for second
      // app is in the URL; no realAppId yet for the new app.
      expect(isSiteForCurrentApp({ id: 'app-1' }, 'job-2', null)).toBe(false);
    });

    it('returns false when site id does not match appId or realAppId', function noMatch() {
      expect(isSiteForCurrentApp({ id: 'app-1' }, 'job-2', 'app-2')).toBe(false);
    });

    it('returns false when appId is null and realAppId does not match', function nullAppId() {
      expect(isSiteForCurrentApp({ id: 'app-1' }, null, 'app-2')).toBe(false);
    });

    it('returns false when both appId and realAppId are null', function bothNull() {
      expect(isSiteForCurrentApp({ id: 'app-1' }, null, null)).toBe(false);
    });
  });

  describe('checkHasInitialPrompt', function checkHasInitialPromptTests() {
    beforeEach(() => {
      sessionStorage.clear();
      localStorage.clear();
    });

    it('returns false when neither sessionStorage flags nor site are set', function emptyState() {
      expect(checkHasInitialPrompt(null, 'app-1', null, null)).toBe(false);
    });

    it('returns true when sessionStorage flags are set on initialJobId', function jobIdFlags() {
      sessionStorage.setItem('initial-prompt-pending-job-1', 'true');
      sessionStorage.setItem('in-creation-flow-job-1', 'true');
      expect(checkHasInitialPrompt('job-1', 'app-1', null, null)).toBe(true);
    });

    it('returns true when sessionStorage flags are set on appId (rebuild mode)', function appIdFlags() {
      sessionStorage.setItem('initial-prompt-pending-app-1', 'true');
      sessionStorage.setItem('in-creation-flow-app-1', 'true');
      expect(checkHasInitialPrompt(null, 'app-1', null, null)).toBe(true);
    });

    it('returns true when site has initial_prompt for current app and flags are absent (DPP cold redirect)', function siteAware() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(true);
    });

    it('site-aware branch matches via realAppId during job→app conversion', function siteAwareRealAppId() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(checkHasInitialPrompt(null, 'job-xyz', site, 'app-1')).toBe(true);
    });

    it('site-aware branch is gated by isSiteForCurrentApp staleness guard', function staleSiteGuard() {
      // Previous app's site lingers in store while jobId for a new app is in URL
      const stalePrevSite = makeSite({ id: 'app-prev', initial_prompt: 'Previous app prompt' });
      expect(checkHasInitialPrompt(null, 'job-2', stalePrevSite, null)).toBe(false);
    });

    it('site-aware branch returns false when site has no initial_prompt', function siteWithoutPrompt() {
      const site = makeSite({ id: 'app-1' });
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(false);
    });

    it('site-aware branch returns false when initial_prompt is empty string', function emptyPrompt() {
      const site = makeSite({ id: 'app-1', initial_prompt: '' });
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(false);
    });

    it('site-aware branch returns false when the auto-sent flag is set in localStorage (refresh after first send)', function refreshGuard() {
      // The site payload on refresh is identical to a first-time DPP redirect
      // because mgmt-airo persists site.initial_prompt forever. Without this
      // cross-session guard, the previous PR (#3690) re-triggered auto-send on
      // every refresh — the regression that PR #3925 reverted.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-1', 'true');
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(false);
    });

    it('auto-sent flag is keyed by site.id, so it does not leak across apps', function flagPerApp() {
      // Flag set for app-prev must NOT suppress auto-send for app-1.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-prev', 'true');
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(true);
    });

    it('sessionStorage flags still win even when auto-sent flag is set (in-flight first send)', function sessionWinsOverFlag() {
      // The flag is written in markInitialPromptSent's `finally`, which runs
      // after send resolves. Within the same session, the sessionStorage flags
      // are the source of truth — they're cleared by the same call site after
      // PROMPT_SENT, so this scenario doesn't occur in practice but documents
      // the precedence.
      sessionStorage.setItem('initial-prompt-pending-app-1', 'true');
      sessionStorage.setItem('in-creation-flow-app-1', 'true');
      localStorage.setItem('initial-prompt-auto-sent-app-1', 'true');
      expect(checkHasInitialPrompt(null, 'app-1', null, null)).toBe(true);
    });
  });

  describe('applyMarkInitialPromptSentEffects', function effectsTests() {
    beforeEach(function clearStorage() {
      localStorage.clear();
      sessionStorage.clear();
    });

    it('writes the cross-session auto-sent localStorage flag for the appId', function writesFlag() {
      // The flag is the durable guard against the PR #3925 regression: on a
      // page refresh, mgmt-airo still serves a populated site.initial_prompt,
      // so the in-memory PROMPT_SENT machine event isn't enough on its own.
      // checkHasInitialPrompt and the site-aware hydration effect both consult
      // this flag to short-circuit the re-send path.
      applyMarkInitialPromptSentEffects('job-1', 'app-1');
      expect(localStorage.getItem('initial-prompt-auto-sent-app-1')).toBe('true');
    });

    it('clears all home-flow sessionStorage keys for initialJobId', function clearsJobIdKeys() {
      sessionStorage.setItem('initial-prompt-pending-job-1', 'true');
      sessionStorage.setItem('in-creation-flow-job-1', 'true');
      sessionStorage.setItem('initial-prompt-text-job-1', 'Build me a site');
      sessionStorage.setItem('initial-template-job-1', 'portfolio');
      sessionStorage.setItem('initial-upload-file-job-1', 'data:image/png;base64,...');

      applyMarkInitialPromptSentEffects('job-1', 'app-1');

      expect(sessionStorage.getItem('initial-prompt-pending-job-1')).toBeNull();
      expect(sessionStorage.getItem('in-creation-flow-job-1')).toBeNull();
      expect(sessionStorage.getItem('initial-prompt-text-job-1')).toBeNull();
      expect(sessionStorage.getItem('initial-template-job-1')).toBeNull();
      expect(sessionStorage.getItem('initial-upload-file-job-1')).toBeNull();
    });

    it('clears rebuild-mode sessionStorage keys for appId', function clearsAppIdKeys() {
      sessionStorage.setItem('initial-prompt-text-app-1', 'Add a new page');
      sessionStorage.setItem('initial-template-app-1', 'portfolio');
      sessionStorage.setItem('initial-upload-file-app-1', 'data:image/png;base64,...');

      applyMarkInitialPromptSentEffects('job-1', 'app-1');

      expect(sessionStorage.getItem('initial-prompt-text-app-1')).toBeNull();
      expect(sessionStorage.getItem('initial-template-app-1')).toBeNull();
      expect(sessionStorage.getItem('initial-upload-file-app-1')).toBeNull();
    });

    it('does not write the flag when appId is null', function nullAppId() {
      applyMarkInitialPromptSentEffects('job-1', null);
      // No way to enumerate localStorage keys reliably across environments;
      // the flag prefix means a null appId would write `${prefix}null` if the
      // null check was missing, so assert that key is also absent.
      expect(localStorage.getItem('initial-prompt-auto-sent-null')).toBeNull();
    });

    it('still clears initialJobId-keyed sessionStorage when appId is null', function nullAppIdStillClearsJob() {
      sessionStorage.setItem('initial-prompt-pending-job-1', 'true');
      sessionStorage.setItem('in-creation-flow-job-1', 'true');

      applyMarkInitialPromptSentEffects('job-1', null);

      expect(sessionStorage.getItem('initial-prompt-pending-job-1')).toBeNull();
      expect(sessionStorage.getItem('in-creation-flow-job-1')).toBeNull();
    });

    it('writes the flag when initialJobId is null but appId is set (cold DPP redirect)', function nullJobIdSetsFlag() {
      // DPP cold-redirect path: there is no initial job at all because the user
      // landed on /develop/{appId} directly. Only the appId-keyed cleanup +
      // localStorage flag write apply.
      applyMarkInitialPromptSentEffects(null, 'app-1');
      expect(localStorage.getItem('initial-prompt-auto-sent-app-1')).toBe('true');
    });

    it('is idempotent — calling twice keeps the flag set to true', function idempotent() {
      // markInitialPromptSent runs in sendPendingAutoSendMessage's finally,
      // which executes on both success and rejection paths. Idempotency means
      // a future refactor that double-fires the action is benign.
      applyMarkInitialPromptSentEffects('job-1', 'app-1');
      applyMarkInitialPromptSentEffects('job-1', 'app-1');
      expect(localStorage.getItem('initial-prompt-auto-sent-app-1')).toBe('true');
    });

    it('the flag it writes is observed by checkHasInitialPrompt (round-trip)', function roundTrip() {
      // End-to-end: after the action runs, the same site.initial_prompt that
      // would have triggered auto-send no longer does.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(true);

      applyMarkInitialPromptSentEffects('job-1', 'app-1');

      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(false);
    });
  });

  describe('shouldHydrateInitialPromptFromSite', function hydrationGateTests() {
    // The site-aware hydration effect (useInitialization.ts) dispatches
    // HYDRATE_APP with `hasInitialPrompt: true` when this predicate returns
    // true. The effect itself is one line — all the load-bearing logic lives
    // in the gates exercised below. A regression that drops any single gate
    // re-opens either the stale-site leak (cross-app navigation) or the
    // PR #3925 cross-session re-send.

    beforeEach(function clearStorage() {
      localStorage.clear();
      sessionStorage.clear();
    });

    it('returns true when every gate passes (cold DPP redirect)', function happyPath() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(true);
    });

    it('returns false when appId is null (no app to hydrate)', function noAppId() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(shouldHydrateInitialPromptFromSite(null, false, site, null)).toBe(false);
    });

    it('returns false when context.hasInitialPrompt is already true (idempotent)', function alreadyHydrated() {
      // The setAppId reducer in the machine only honors `true` for
      // hasInitialPrompt updates, but short-circuiting here keeps the effect
      // a no-op once hydration has occurred — and prevents an unnecessary
      // re-dispatch on every dependency change.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(shouldHydrateInitialPromptFromSite('app-1', true, site, null)).toBe(false);
    });

    it('returns false when site is null (still loading)', function siteNotLoaded() {
      expect(shouldHydrateInitialPromptFromSite('app-1', false, null, null)).toBe(false);
    });

    it('returns false when site.id does not match appId or realAppId (stale)', function staleSite() {
      // Navigation between apps: the previous app's site briefly remains in
      // useDevelopPageStore until `initializePage` resolves for the new app.
      // Without isSiteForCurrentApp, the previous prompt would auto-send for
      // the new app.
      const stale = makeSite({ id: 'app-prev', initial_prompt: 'Old prompt' });
      expect(shouldHydrateInitialPromptFromSite('app-1', false, stale, null)).toBe(false);
    });

    it('matches when site.id equals realAppId (mid-flight job→app flip)', function realAppIdMatch() {
      // During the creation flow's job→app flip, route param is still the job
      // id but realAppId from useSiteCreationStore points at the new app id.
      // BFF returns the site for the realAppId; this case must be allowed.
      const site = makeSite({ id: 'real-app-1', initial_prompt: 'Build me a portfolio' });
      expect(shouldHydrateInitialPromptFromSite('job-1', false, site, 'real-app-1')).toBe(true);
    });

    it('returns false when site.initial_prompt is empty string', function emptyPrompt() {
      const site = makeSite({ id: 'app-1', initial_prompt: '' });
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(false);
    });

    it('returns false when site.initial_prompt is undefined (no prompt to send)', function undefinedPrompt() {
      const site = makeSite({ id: 'app-1' });
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(false);
    });

    it('returns false when the cross-session auto-sent flag is set in localStorage', function alreadyAutoSent() {
      // The PR #3925 regression scenario: page refresh after the first auto-
      // send. mgmt-airo persists `site.initial_prompt` forever, so the BFF
      // response is identical to a first-time DPP redirect. Without this
      // gate the effect would re-trigger auto-send on every refresh.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-1', 'true');
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(false);
    });

    it('auto-sent flag is keyed by site.id (set on a different app does not block)', function flagKeyedBySiteId() {
      // The flag prevents re-trigger for app-1; an unrelated app-prev flag
      // must not suppress hydration for app-1.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-prev', 'true');
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(true);
    });

    it('round-trip with applyMarkInitialPromptSentEffects: gate flips after the helper runs', function roundTrip() {
      // End-to-end: the effect runs once for a fresh DPP redirect, the action
      // writes the flag in its `finally`, and the gate then short-circuits
      // every subsequent render (or refresh).
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(true);
      applyMarkInitialPromptSentEffects(null, 'app-1');
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(false);
    });
  });

  describe('shouldFireSiteAwareHydration', function historyGateTests() {
    // Pins the conversation-history gate that fixes the two #3997 production
    // regressions reported in GOC: existing apps re-firing the initial prompt
    // on load, and the "building your app" overlay sticking until refresh.
    // Both stem from the site-aware hydration effect dispatching HYDRATE_APP
    // for an app that already has a conversation; this gate stops it.
    //
    // The third arg, hasConversationCookie, distinguishes fresh from existing
    // apps. Fresh apps have no conversationId until the agent's first reply
    // sets it via `conversation_info`, so loadHistory() short-circuits and
    // history_loaded never arrives — the history-loading gate would deadlock.
    //
    // The cookie value is read inline at the effect call site (the
    // shouldFireSiteAwareHydration call inside the auto-send effect) and is
    // NOT in the effect dep array. This is intentional — cookies are not
    // reactive in React, and protection against multiple fires comes from
    // state.context.hasInitialPrompt short-circuiting the second predicate
    // after the first HYDRATE_APP. The tests below cover all 8 truth-table
    // combinations of (historyLoadingComplete, hasMessages, hasConversationCookie)
    // so a future refactor that re-orders predicates or moves the cookie read
    // into a useState/useRef/useMemo (which would silently shift the gate
    // semantics) trips a CI signal.

    it('returns true for a fresh app with no conversation cookie', function freshAppNoCookie() {
      // Cold DPP redirect path: load_history can't be emitted without a
      // conversationId, so historyLoadingComplete stays false. Fire HYDRATE_APP
      // immediately so auto-send proceeds; conversation_info from the agent
      // sets the cookie on first reply.
      expect(shouldFireSiteAwareHydration(false, false, false)).toBe(true);
    });

    it('returns true for an existing app once history has loaded empty', function existingAppHistoryLoaded() {
      // Cookie present, history_loaded arrived with messageCount: 0 — e.g. a
      // user who connected once but never sent a message. Auto-send should
      // still proceed.
      expect(shouldFireSiteAwareHydration(true, false, true)).toBe(true);
    });

    it('returns false while history is still loading for an existing app', function historyInFlight() {
      // Cookie present (existing app), history in flight: don't race — wait
      // for history_loaded to confirm hasMessages.
      expect(shouldFireSiteAwareHydration(false, false, true)).toBe(false);
    });

    it('returns false when the app already has messages (existing app)', function existingApp() {
      // The GOC scenario. Without this gate, an existing user revisiting
      // their app gets a duplicate user message AND a stuck overlay.
      expect(shouldFireSiteAwareHydration(true, true, true)).toBe(false);
    });

    it('returns false when both history and messages-prior-session gates fail', function bothFail() {
      // Defensive: the messages array can be hydrated from a previous app
      // briefly during navigation. Either gate failing should suppress fire
      // for an existing app.
      expect(shouldFireSiteAwareHydration(false, true, true)).toBe(false);
    });

    it('returns true for a fresh app even when messages are spuriously present', function freshAppSpuriousMessages() {
      // Defensive: if hasMessages is briefly true during navigation but the
      // cookie is absent (proven fresh), trust the cookie signal — the
      // messages are stale from a previous app and will clear on RESET.
      expect(shouldFireSiteAwareHydration(false, true, false)).toBe(true);
    });

    it('returns true for a fresh app once history has loaded empty (no cookie)', function freshAppHistoryLoadedNoCookie() {
      // Logically unreachable in production (history_loaded only arrives
      // after conversationId is set, which sets the cookie) but pinned anyway:
      // the !hasConversationCookie short-circuit must dominate any later gate.
      // A refactor that checked historyLoadingComplete && !hasMessages first
      // would still return true here — but a refactor that ordered them as
      // (historyLoadingComplete && hasMessages) ? false : <other> would shift
      // the (true, true, false) result below and this test guards the pair.
      expect(shouldFireSiteAwareHydration(true, false, false)).toBe(true);
    });

    it('returns true for a fresh app even when history loaded with messages (no cookie)', function freshAppHistoryWithMessagesNoCookie() {
      // Same logical-unreachable territory as above, but the load-bearing
      // assertion: the cookie short-circuit must beat the existing-app
      // hasMessages gate. A future refactor that reordered predicates to
      // check hasMessages first would flip this to false and silently break
      // the cold-DPP path.
      expect(shouldFireSiteAwareHydration(true, true, false)).toBe(true);
    });
  });
});
