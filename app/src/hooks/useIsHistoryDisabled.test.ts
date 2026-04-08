/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { ViewMode } from '@/app/develop/components/types';
import { useIsHistoryDisabled } from '@/hooks/useIsHistoryDisabled';

let mockViewMode = ViewMode.PREVIEW;
let mockIsPublishing = false;
let mockIsSelectingCommit = false;
let mockIsLoadingCommits = false;
let mockIsLoading = false;
let mockIsStreaming = false;
let mockHistoryLoadingComplete = true;

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    viewMode: mockViewMode,
    publishStates: {
      'app-123': { isPublishing: mockIsPublishing },
    },
  }),
}));

vi.mock('@/stores/useGitStore', () => ({
  useGitStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    isSelectingCommit: mockIsSelectingCommit,
  }),
}));

vi.mock('@/hooks/useGitHistory', () => ({
  useGitHistoryQuery: () => ({
    isLoading: mockIsLoadingCommits,
  }),
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useIsLoading: () => mockIsLoading,
  useIsActivelyStreaming: () => mockIsStreaming,
  useHistoryLoadingComplete: () => mockHistoryLoadingComplete,
}));

describe('useIsHistoryDisabled', () => {
  beforeEach(() => {
    mockViewMode = ViewMode.PREVIEW;
    mockIsPublishing = false;
    mockIsSelectingCommit = false;
    mockIsLoadingCommits = false;
    mockIsLoading = false;
    mockIsStreaming = false;
    mockHistoryLoadingComplete = true;
  });

  it('should return false when no conditions are met', () => {
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(false);
  });

  it('should return true when conversation is loading', () => {
    mockIsLoading = true;
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(true);
  });

  it('should return true when actively streaming', () => {
    mockIsStreaming = true;
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(true);
  });

  it('should return true when history recovery is incomplete', () => {
    mockHistoryLoadingComplete = false;
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(true);
  });

  it('should return true when commits are loading', () => {
    mockIsLoadingCommits = true;
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(true);
  });

  it('should return true when selecting a commit', () => {
    mockIsSelectingCommit = true;
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(true);
  });

  it('should return true when in code view mode', () => {
    mockViewMode = ViewMode.CODE;
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(true);
  });

  it('should return true when publishing', () => {
    mockIsPublishing = true;
    const { result } = renderHook(() => useIsHistoryDisabled('app-123'));
    expect(result.current).toBe(true);
  });

  it('should ignore publishing state when appId is empty', () => {
    mockIsPublishing = true;
    const { result } = renderHook(() => useIsHistoryDisabled(''));
    expect(result.current).toBe(false);
  });
});
