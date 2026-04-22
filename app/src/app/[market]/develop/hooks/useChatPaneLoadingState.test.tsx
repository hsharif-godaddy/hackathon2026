/* eslint-disable react-hooks/rules-of-hooks -- renderHookWithProviders callbacks trigger this rule */
/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it } from 'vitest';

import { useChatPaneLoadingState } from '@/app/[market]/develop/hooks/useChatPaneLoadingState';
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore';
import { renderHookWithProviders } from '@/tests/test-utils';

type HookOptions = Parameters<typeof useChatPaneLoadingState>[0];

const defaultInitUi: HookOptions['initUi'] = {
  showChatLoader: false,
  chatLoaderPhase: 'waitingForWebSocket',
};

const defaultArchiveRestore: HookOptions['archiveRestore'] = {
  archiveGatePending: false,
  isArchivedForRestore: false,
  isRestoringFromArchive: false,
  archiveRestoreFailed: false,
  archiveRestoreComplete: false,
};

const defaultHibernation: HookOptions['hibernation'] = {
  isHibernated: false,
  isResuming: false,
};

const defaultImageReadiness: HookOptions['imageReadiness'] = {
  isChecking: false,
  isImageUpdating: false,
  error: null,
};

function baseOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    initUi: { ...defaultInitUi, ...overrides.initUi },
    isCreateFlowSession: overrides.isCreateFlowSession ?? false,
    archiveRestore: { ...defaultArchiveRestore, ...overrides.archiveRestore },
    hibernation: { ...defaultHibernation, ...overrides.hibernation },
    imageReadiness: { ...defaultImageReadiness, ...overrides.imageReadiness },
  };
}

describe('useChatPaneLoadingState', function useChatPaneLoadingStateTests() {
  beforeEach(function resetStore() {
    useStreamingConversationStore.getState().cleanup();
  });

  it('should return init phase message when chat loader is shown in create flow', function createFlowInitPhase() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          isCreateFlowSession: true,
          initUi: { showChatLoader: true, chatLoaderPhase: 'waitingForWebSocket' },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_waitingForWebSocket');
  });

  it('should return init phase for custom loader phase key', function customPhaseKey() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          isCreateFlowSession: true,
          initUi: { showChatLoader: true, chatLoaderPhase: 'websocketConnected' },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_websocketConnected');
  });

  it('should block on init loader for non-create session when not suppressed', function existingSessionInitBlocks() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          isCreateFlowSession: false,
          initUi: { showChatLoader: true, chatLoaderPhase: 'waitingForWebSocket' },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_waitingForWebSocket');
  });

  it('should suppress init chat loader after archive restore completes for non-create session', function suppressAfterArchiveComplete() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          isCreateFlowSession: false,
          initUi: { showChatLoader: true, chatLoaderPhase: 'waitingForWebSocket' },
          archiveRestore: {
            ...defaultArchiveRestore,
            archiveRestoreComplete: true,
          },
        })
      )
    );

    expect(result.current.loadingMessage).toBe(null);
  });

  it('should NOT suppress init chat loader for create flow even after archive restore completes', function initLoaderCreateFlowAfterArchiveComplete() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          isCreateFlowSession: true,
          initUi: { showChatLoader: true, chatLoaderPhase: 'waitingForWebSocket' },
          archiveRestore: { ...defaultArchiveRestore, archiveRestoreComplete: true },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_waitingForWebSocket');
  });

  it('should suppress init chat loader when conversation has messages', function suppressWhenHistoryPresent() {
    useStreamingConversationStore.setState({
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'hello',
          timestamp: new Date(),
        },
      ],
    });

    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          isCreateFlowSession: false,
          initUi: { showChatLoader: true, chatLoaderPhase: 'waitingForWebSocket' },
        })
      )
    );

    expect(result.current.loadingMessage).toBe(null);
  });

  it('should prefer init loader over archive gate when both apply', function initWinsOverArchiveGate() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          isCreateFlowSession: true,
          initUi: { showChatLoader: true, chatLoaderPhase: 'waitingForWebSocket' },
          archiveRestore: {
            ...defaultArchiveRestore,
            archiveGatePending: true,
          },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_waitingForWebSocket');
  });

  it('should return resuming when archive gate is pending and init does not block', function archiveGatePending() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          archiveRestore: {
            ...defaultArchiveRestore,
            archiveGatePending: true,
          },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_resuming');
  });

  it('should return restoring archive when archived for restore', function archivedForRestore() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          archiveRestore: {
            ...defaultArchiveRestore,
            isArchivedForRestore: true,
          },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_restoring_archive');
  });

  it('should return restoring archive while restoring from archive', function restoringFromArchive() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          archiveRestore: {
            ...defaultArchiveRestore,
            isRestoringFromArchive: true,
          },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_restoring_archive');
  });

  it('should return restoring archive when restore failed', function archiveRestoreFailed() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          archiveRestore: {
            ...defaultArchiveRestore,
            archiveRestoreFailed: true,
          },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_restoring_archive');
  });

  it('should prefer archive gate over restoring-archive flags', function gateBeforeRestoreFlags() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          archiveRestore: {
            ...defaultArchiveRestore,
            archiveGatePending: true,
            isArchivedForRestore: true,
          },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_resuming');
  });

  it('should return resuming when hibernated', function hibernated() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          hibernation: { isHibernated: true, isResuming: false },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_resuming');
  });

  it('should return resuming when resuming from hibernation', function resumingHibernation() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          hibernation: { isHibernated: false, isResuming: true },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_resuming');
  });

  it('should return checking images when image readiness is checking', function imageChecking() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          imageReadiness: { isChecking: true, isImageUpdating: false, error: null },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_checking_images');
  });

  it('should return updating images when image update is in progress', function imageUpdating() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          imageReadiness: { isChecking: false, isImageUpdating: true, error: null },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_updating_images');
  });

  it('should return updating images when image readiness reports an error', function imageReadinessError() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          imageReadiness: { isChecking: false, isImageUpdating: false, error: 'bad' },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_updating_images');
  });

  it('should prefer hibernation over image readiness', function hibernationBeforeImages() {
    const { result } = renderHookWithProviders(() =>
      useChatPaneLoadingState(
        baseOptions({
          hibernation: { isHibernated: true, isResuming: false },
          imageReadiness: { isChecking: true, isImageUpdating: false, error: null },
        })
      )
    );

    expect(result.current.loadingMessage).toBe('builder_chatpane_phase_resuming');
  });

  it('should return null when nothing is loading', function idle() {
    const { result } = renderHookWithProviders(() => useChatPaneLoadingState(baseOptions()));

    expect(result.current.loadingMessage).toBe(null);
  });
});
