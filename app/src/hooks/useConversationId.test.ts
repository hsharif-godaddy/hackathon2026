/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useConversationId } from './useConversationId';

describe('useConversationId', () => {
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

  beforeEach(() => {
    window.history.replaceState(null, '', '/develop/app-123');
    vi.clearAllMocks();
  });

  it('returns the value when present and strips it, preserving other params', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&conversationId=conv-abc');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useConversationId());

    expect(result.current).toBe('conv-abc');

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has('conversationId')).toBe(false);
    });
    // Other params preserved; value stays stable after the strip.
    expect(new URLSearchParams(window.location.search).get('view')).toBe('inbox');
    expect(result.current).toBe('conv-abc');
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });

  it('strips a sole conversationId down to a bare pathname', async () => {
    window.history.replaceState(null, '', '/develop/app-123?conversationId=conv-abc');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useConversationId());

    expect(result.current).toBe('conv-abc');
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
  });

  it('returns null and does not touch the URL when the param is absent', () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useConversationId());

    expect(result.current).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?view=inbox');
  });

  it('treats an empty conversationId as absent (null, no strip)', () => {
    window.history.replaceState(null, '', '/develop/app-123?conversationId=');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useConversationId());

    expect(result.current).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('preserves the hash when stripping the param', async () => {
    window.history.replaceState(null, '', '/develop/app-123?conversationId=conv-abc#section');
    replaceStateSpy.mockClear();

    renderHook(() => useConversationId());

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(window.location.hash).toBe('#section');
  });
});
