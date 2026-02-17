import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { ChatTab, SettingsSection } from '@/app/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useChatTabs } from './useChatTabs';

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/develop/app-123',
}));

describe('useChatTabs', () => {
  const pushStateSpy = vi.spyOn(window.history, 'pushState');
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

  beforeEach(() => {
    // Reset URL before each test
    window.history.replaceState(null, '', '/develop/app-123');
    useDevelopPageStore.setState({
      activeChatTab: ChatTab.CHAT,
      activeSettingsSection: SettingsSection.DOMAIN,
    });
    vi.clearAllMocks();
  });

  it('should read initial tab from URL without clobbering it', async () => {
    // Set URL with tab param before rendering hook
    window.history.replaceState(null, '', '/develop/app-123?tab=history');
    replaceStateSpy.mockClear();

    renderHook(() => useChatTabs());

    await waitFor(() => {
      const state = useDevelopPageStore.getState();
      expect(state.activeChatTab).toBe(ChatTab.HISTORY);
    });

    expect(window.location.search).toBe('?tab=history');
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('should use pushState for user changes (first and subsequent)', async () => {
    const { result, rerender } = renderHook(() => useChatTabs());

    // Change to history tab
    act(() => {
      result.current.setActiveChatTab(ChatTab.HISTORY);
    });
    rerender();

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('tab')).toBe('history');
    });
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();

    // Change back to chat tab
    act(() => {
      result.current.setActiveChatTab(ChatTab.CHAT);
    });
    rerender();

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.has('tab')).toBe(false);
    });
    expect(pushStateSpy).toHaveBeenCalledTimes(2);
  });

  it('should remove default settings param from URL on init', async () => {
    window.history.replaceState(null, '', '/develop/app-123?tab=settings&settings=domain');
    replaceStateSpy.mockClear();

    renderHook(() => useChatTabs());

    await waitFor(() => {
      const state = useDevelopPageStore.getState();
      expect(state.activeChatTab).toBe(ChatTab.SETTINGS);
      expect(state.activeSettingsSection).toBe(SettingsSection.DOMAIN);
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get('tab')).toBe('settings');
    expect(params.has('settings')).toBe(false);
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });
});
