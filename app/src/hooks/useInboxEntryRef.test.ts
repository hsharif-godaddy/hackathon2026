/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useInboxEntryRef } from './useInboxEntryRef';

describe('useInboxEntryRef', () => {
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

  beforeEach(() => {
    window.history.replaceState(null, '', '/develop/app-123');
    vi.clearAllMocks();
  });

  it('captures ?ref= and strips it from the URL on mount, preserving other params and the hash', () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&ref=email&conversationId=conv-1#thread');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useInboxEntryRef());

    expect(result.current.consumeEntryRef()).toBe('email');
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?view=inbox&conversationId=conv-1');
    expect(window.location.hash).toBe('#thread');
  });

  it('consumes the value exactly once', () => {
    window.history.replaceState(null, '', '/develop/app-123?ref=email');

    const { result } = renderHook(() => useInboxEntryRef());

    expect(result.current.consumeEntryRef()).toBe('email');
    expect(result.current.consumeEntryRef()).toBeNull();
  });

  it('returns null and leaves the URL untouched when ?ref= is absent', () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useInboxEntryRef());

    expect(result.current.consumeEntryRef()).toBeNull();
    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?view=inbox');
  });

  it('treats an empty ?ref= as no entry point', () => {
    window.history.replaceState(null, '', '/develop/app-123?ref=');

    const { result } = renderHook(() => useInboxEntryRef());

    expect(result.current.consumeEntryRef()).toBeNull();
  });

  it('attributes nothing for an unknown ?ref= but still strips it from the URL', () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&ref=not-an-entry-point');
    replaceStateSpy.mockClear();

    const { result } = renderHook(() => useInboxEntryRef());

    expect(result.current.consumeEntryRef()).toBeNull();
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?view=inbox');
  });
});
