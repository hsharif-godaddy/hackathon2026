/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { IntString } from '@/types/inbox/local/core';
import { useConversationId } from './useConversationId';

describe('useConversationId', () => {
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState');
  const pushStateSpy = vi.spyOn(window.history, 'pushState');

  beforeEach(() => {
    window.history.replaceState(null, '', '/develop/app-123');
    useDevelopPageStore.setState({ viewMode: ViewMode.INBOX });
    vi.clearAllMocks();
  });

  it('seeds the active conversation from ?conversationId= on mount without touching the URL', () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&conversationId=conv-abc');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useConversationId());

    expect(result.current.activeConversationId).toBe('conv-abc');
    // Param already present and consistent with state: no rewrite.
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?view=inbox&conversationId=conv-abc');
  });

  it('treats an empty conversationId as no active conversation', () => {
    window.history.replaceState(null, '', '/develop/app-123?conversationId=');

    const { result } = renderHook(() => useConversationId());

    expect(result.current.activeConversationId).toBeNull();
  });

  it('writes ?conversationId= (replaceState) when a conversation becomes active, preserving other params', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useConversationId());

    act(() => {
      result.current.setActiveConversationId('conv-xyz' as IntString);
    });

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('conversationId')).toBe('conv-xyz');
    });
    expect(new URLSearchParams(window.location.search).get('view')).toBe('inbox');
    expect(pushStateSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).toHaveBeenCalled();
  });

  it('removes ?conversationId= when the active conversation is cleared', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&conversationId=conv-abc');

    const { result } = renderHook(() => useConversationId());

    act(() => {
      result.current.setActiveConversationId(null);
    });

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has('conversationId')).toBe(false);
    });
    expect(new URLSearchParams(window.location.search).get('view')).toBe('inbox');
  });

  it('clears the active conversation and strips the param when the view leaves INBOX', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&conversationId=conv-abc');

    const { result } = renderHook(() => useConversationId());
    expect(result.current.activeConversationId).toBe('conv-abc');

    act(() => {
      useDevelopPageStore.setState({ viewMode: ViewMode.EDIT });
    });

    await waitFor(() => {
      expect(result.current.activeConversationId).toBeNull();
    });
    expect(new URLSearchParams(window.location.search).has('conversationId')).toBe(false);
  });

  it('lands on the list (no active conversation) when returning to INBOX', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&conversationId=conv-abc');

    const { result } = renderHook(() => useConversationId());

    act(() => {
      useDevelopPageStore.setState({ viewMode: ViewMode.EDIT });
    });
    await waitFor(() => {
      expect(result.current.activeConversationId).toBeNull();
    });

    act(() => {
      useDevelopPageStore.setState({ viewMode: ViewMode.INBOX });
    });

    // Returning does not reopen the previously active conversation.
    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
    });
    expect(result.current.activeConversationId).toBeNull();
    expect(new URLSearchParams(window.location.search).has('conversationId')).toBe(false);
  });

  it('re-syncs the active conversation from the URL on popstate', async () => {
    const { result } = renderHook(() => useConversationId());

    expect(result.current.activeConversationId).toBeNull();

    window.history.replaceState(null, '', '/develop/app-123?view=inbox&conversationId=conv-back');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(result.current.activeConversationId).toBe('conv-back');
    });
  });

  it('preserves the hash when writing the param', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox#section');

    const { result } = renderHook(() => useConversationId());

    act(() => {
      result.current.setActiveConversationId('conv-hash' as IntString);
    });

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('conversationId')).toBe('conv-hash');
    });
    expect(window.location.hash).toBe('#section');
  });
});
