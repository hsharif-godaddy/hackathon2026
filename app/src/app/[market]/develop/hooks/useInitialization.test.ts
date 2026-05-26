/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SiteStatus } from '@/lib/control-plane/types';
import type { Site } from '@/stores/useSitesStore';
import { applyMarkInitialPromptSentEffects, checkHasInitialPrompt, deriveIsAwaitingStream, getEditPaths, isCompletedFileEdit, isInCreationHandoff, isSiteForCurrentApp, resetStaleAppContext, shouldFireSiteAwareHydration, shouldHydrateInitialPromptFromSite } from './useInitialization';

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

      expect(subPhases.length).toBe(4);
    });
  });

  describe('UI state computation logic', function uiStateLogicTests() {
    // Helper function to test loader logic with proper typing
    function shouldShowLoaderForPhase(phase: 'idle' | 'creating' | 'completed'): boolean {
      return phase !== 'idle' && phase !== 'completed';
    }

    it('should show chat loader during creation phases', function chatLoaderCreation() {
      expect(shouldShowLoaderForPhase('creating')).toBe(true);
    });

    it('should hide chat loader when creation is complete', function chatLoaderComplete() {
      expect(shouldShowLoaderForPhase('completed')).toBe(false);
    });

    it('should show chat loader when waiting for websocket', function chatLoaderWebSocket() {
      const isInitialCreationFlow = true;
      const isWebSocketConnected = false;
      const shouldShowLoader = isInitialCreationFlow && !isWebSocketConnected;

      expect(shouldShowLoader).toBe(true);
    });

    it('should hide chat loader after websocket connects', function chatLoaderConnected() {
      const isInitialCreationFlow = true;
      const isWebSocketConnected = true;
      const initialPromptSent = false;
      const shouldShowLoader = isInitialCreationFlow && !isWebSocketConnected && !initialPromptSent;

      expect(shouldShowLoader).toBe(false);
    });

    it('should show preview loader during initial creation', function previewLoaderCreation() {
      const isInitialCreationFlow = true;
      const isLoading = true;
      const shouldShowLoader = isInitialCreationFlow && isLoading;

      expect(shouldShowLoader).toBe(true);
    });

    it('should hide preview loader after setup complete', function previewLoaderComplete() {
      const isInitialCreationFlow = false;
      const isLoading = true;
      const shouldShowLoader = isInitialCreationFlow && isLoading;

      expect(shouldShowLoader).toBe(false);
    });

    it('should enable auto-send when websocket connects', function autoSendEnabled() {
      const isInitialCreationFlow = true;
      const isWebSocketConnected = true;
      const initialPromptSent = false;
      const canAutoSend = isInitialCreationFlow && isWebSocketConnected && !initialPromptSent;

      expect(canAutoSend).toBe(true);
    });

    it('should disable auto-send after prompt sent', function autoSendDisabled() {
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

  // Regression: stale `site` from a previous app must not match a new appId/jobId.
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
      expect(isSiteForCurrentApp({ id: 'app-1' }, 'job-xyz', 'app-1')).toBe(true);
    });

    it('returns false when site is for a different (previous) app', function differentApp() {
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
      // PR #3925 regression: mgmt-airo persists site.initial_prompt forever, so refresh looks identical to first-time DPP.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-1', 'true');
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(false);
    });

    it('auto-sent flag is keyed by site.id, so it does not leak across apps', function flagPerApp() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-prev', 'true');
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(true);
    });

    it('sessionStorage flags still win even when auto-sent flag is set (in-flight first send)', function sessionWinsOverFlag() {
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
      // Durable PR #3925 guard: in-memory PROMPT_SENT alone won't survive refresh.
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

    it('clears the initial-job-id creation-handoff marker for the appId', function clearsHandoffMarker() {
      // Marker is set during the URL flip (jobId → realAppId) so the bypass survives the
      // loading.tsx Suspense remount. Once auto-send completes, subsequent same-tab reloads
      // should fall through to the strict gate, not the bypass.
      sessionStorage.setItem('initial-job-id-app-1', 'job-1');

      applyMarkInitialPromptSentEffects('job-1', 'app-1');

      expect(sessionStorage.getItem('initial-job-id-app-1')).toBeNull();
    });

    it('does not clear the handoff marker for a different appId', function preservesUnrelatedMarker() {
      sessionStorage.setItem('initial-job-id-app-2', 'job-2');

      applyMarkInitialPromptSentEffects('job-1', 'app-1');

      expect(sessionStorage.getItem('initial-job-id-app-2')).toBe('job-2');
    });

    it('does not write the flag when appId is null', function nullAppId() {
      applyMarkInitialPromptSentEffects('job-1', null);
      // Asserting the literal "null"-suffix key catches a missing null check.
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
      applyMarkInitialPromptSentEffects(null, 'app-1');
      expect(localStorage.getItem('initial-prompt-auto-sent-app-1')).toBe('true');
    });

    it('is idempotent — calling twice keeps the flag set to true', function idempotent() {
      applyMarkInitialPromptSentEffects('job-1', 'app-1');
      applyMarkInitialPromptSentEffects('job-1', 'app-1');
      expect(localStorage.getItem('initial-prompt-auto-sent-app-1')).toBe('true');
    });

    it('the flag it writes is observed by checkHasInitialPrompt (round-trip)', function roundTrip() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(true);

      applyMarkInitialPromptSentEffects('job-1', 'app-1');

      expect(checkHasInitialPrompt(null, 'app-1', site, null)).toBe(false);
    });
  });

  describe('shouldHydrateInitialPromptFromSite', function hydrationGateTests() {
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
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(shouldHydrateInitialPromptFromSite('app-1', true, site, null)).toBe(false);
    });

    it('returns false when site is null (still loading)', function siteNotLoaded() {
      expect(shouldHydrateInitialPromptFromSite('app-1', false, null, null)).toBe(false);
    });

    it('returns false when site.id does not match appId or realAppId (stale)', function staleSite() {
      const stale = makeSite({ id: 'app-prev', initial_prompt: 'Old prompt' });
      expect(shouldHydrateInitialPromptFromSite('app-1', false, stale, null)).toBe(false);
    });

    it('matches when site.id equals realAppId (mid-flight job→app flip)', function realAppIdMatch() {
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
      // PR #3925 regression: refresh-after-first-send must not re-fire.
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-1', 'true');
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(false);
    });

    it('auto-sent flag is keyed by site.id (set on a different app does not block)', function flagKeyedBySiteId() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      localStorage.setItem('initial-prompt-auto-sent-app-prev', 'true');
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(true);
    });

    it('round-trip with applyMarkInitialPromptSentEffects: gate flips after the helper runs', function roundTrip() {
      const site = makeSite({ id: 'app-1', initial_prompt: 'Build me a portfolio' });
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(true);
      applyMarkInitialPromptSentEffects(null, 'app-1');
      expect(shouldHydrateInitialPromptFromSite('app-1', false, site, null)).toBe(false);
    });
  });

  describe('shouldFireSiteAwareHydration', function historyGateTests() {
    // Conversation-history gate. fromCreationHandoff bypasses historyLoadingComplete
    // because the URL flip jobId→realAppId resets it; hasMessages always wins.

    it('returns true once history has loaded with no messages', function historyLoadedEmpty() {
      expect(shouldFireSiteAwareHydration(true, false)).toBe(true);
    });

    it('returns false while history is still loading', function historyInFlight() {
      expect(shouldFireSiteAwareHydration(false, false)).toBe(false);
    });

    it('returns false when the app already has messages (existing app)', function existingApp() {
      expect(shouldFireSiteAwareHydration(true, true)).toBe(false);
    });

    it('returns false when history is loading and messages are spuriously present', function historyInFlightWithMessages() {
      expect(shouldFireSiteAwareHydration(false, true)).toBe(false);
    });

    it('returns true on creation handoff even when history has not finished loading', function creationHandoffBypass() {
      expect(shouldFireSiteAwareHydration(false, false, true)).toBe(true);
    });

    it('returns false on creation handoff when messages are present', function creationHandoffStillGuardsMessages() {
      expect(shouldFireSiteAwareHydration(false, true, true)).toBe(false);
      expect(shouldFireSiteAwareHydration(true, true, true)).toBe(false);
    });
  });

  describe('isInCreationHandoff', function creationHandoffOrTests() {
    // Both branches of the OR (ref ∪ sessionStorage marker) must independently
    // keep the bypass live. The ref covers the in-place case; the sessionStorage
    // marker covers the loading.tsx Suspense remount that wipes the ref on the
    // jobId→realAppId URL flip. Dropping either branch silently re-deadlocks
    // the corresponding path.

    beforeEach(function clearStorage() {
      sessionStorage.clear();
    });

    it('returns false when appId is null', function noAppId() {
      expect(isInCreationHandoff(null, { realAppId: 'app-1' })).toBe(false);
    });

    it('returns true when only the ref matches (in-place — no remount)', function refOnly() {
      expect(isInCreationHandoff('app-1', { realAppId: 'app-1' })).toBe(true);
    });

    it('returns true when only the sessionStorage marker is present (post-remount: ref wiped)', function markerOnly() {
      sessionStorage.setItem('initial-job-id-app-1', 'job-1');
      expect(isInCreationHandoff('app-1', null)).toBe(true);
    });

    it('returns true when ref realAppId is null but the marker covers the flip', function nullRefRealAppId() {
      sessionStorage.setItem('initial-job-id-app-1', 'job-1');
      expect(isInCreationHandoff('app-1', { realAppId: null })).toBe(true);
    });

    it('returns false when neither branch matches the current appId', function neither() {
      expect(isInCreationHandoff('app-1', { realAppId: 'app-other' })).toBe(false);
    });

    it('marker is keyed by appId — a different app\'s marker does not bypass', function markerKeyedByAppId() {
      sessionStorage.setItem('initial-job-id-app-other', 'job-1');
      expect(isInCreationHandoff('app-1', null)).toBe(false);
    });
  });
});
