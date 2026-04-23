/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { ChatTab } from '@/app/[market]/develop/components/types';
import { useVisitedTabs } from './useVisitedTabs';

describe('useVisitedTabs', () => {
  it('should include CHAT in the initial set', () => {
    const { result } = renderHook(() => useVisitedTabs(ChatTab.CHAT));

    expect(result.current.has(ChatTab.CHAT)).toBe(true);
    expect(result.current.size).toBe(1);
  });

  it('should not include unvisited tabs', () => {
    const { result } = renderHook(() => useVisitedTabs(ChatTab.CHAT));

    expect(result.current.has(ChatTab.HISTORY)).toBe(false);
    expect(result.current.has(ChatTab.MEDIAS)).toBe(false);
    expect(result.current.has(ChatTab.ANALYTICS)).toBe(false);
    expect(result.current.has(ChatTab.SETTINGS)).toBe(false);
  });

  it('should add a tab when it becomes active', () => {
    const { result, rerender } = renderHook(
      ({ tab }) => useVisitedTabs(tab),
      { initialProps: { tab: ChatTab.CHAT } }
    );

    act(() => rerender({ tab: ChatTab.HISTORY }));

    expect(result.current.has(ChatTab.CHAT)).toBe(true);
    expect(result.current.has(ChatTab.HISTORY)).toBe(true);
    expect(result.current.size).toBe(2);
  });

  it('should accumulate all visited tabs', () => {
    const { result, rerender } = renderHook(
      ({ tab }) => useVisitedTabs(tab),
      { initialProps: { tab: ChatTab.CHAT } }
    );

    act(() => rerender({ tab: ChatTab.HISTORY }));
    act(() => rerender({ tab: ChatTab.MEDIAS }));
    act(() => rerender({ tab: ChatTab.ANALYTICS }));

    expect(result.current.has(ChatTab.CHAT)).toBe(true);
    expect(result.current.has(ChatTab.HISTORY)).toBe(true);
    expect(result.current.has(ChatTab.MEDIAS)).toBe(true);
    expect(result.current.has(ChatTab.ANALYTICS)).toBe(true);
    expect(result.current.has(ChatTab.SETTINGS)).toBe(false);
    expect(result.current.size).toBe(4);
  });

  it('should not create a new set when revisiting a tab', () => {
    const { result, rerender } = renderHook(
      ({ tab }) => useVisitedTabs(tab),
      { initialProps: { tab: ChatTab.CHAT } }
    );

    act(() => rerender({ tab: ChatTab.HISTORY }));
    const setAfterFirstVisit = result.current;

    act(() => rerender({ tab: ChatTab.CHAT }));
    const setAfterRevisit = result.current;

    expect(setAfterRevisit).toBe(setAfterFirstVisit);
  });
});
