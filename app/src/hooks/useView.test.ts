import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  CanvasId,
  COMMANDER_CANVAS_TABS_FLAG,
  DEFAULT_OPEN_CANVAS_IDS,
  PINNED_CANVAS_ID,
} from '@/app/[market]/commander/canvas/registry';
import { ViewMode } from '@/app/[market]/develop/components/types';
import { useCommanderStore } from '@/stores/useCommanderStore';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useView, type ViewAvailability } from './useView';

vi.mock('next/navigation', () => ({
  usePathname: () => '/develop/app-123',
}));

// Default: every mode available and resolved.
const allAvailable = () => ({ available: true, resolving: false });

// Toggle the canvas-tabs switchboard flag that useSwitchboard reads off window.
const setCanvasTabsFlag = (enabled: boolean): void => {
  window.gasketData = { switchboard: { [COMMANDER_CANVAS_TABS_FLAG]: enabled } };
};

describe('useView', () => {
  const pushStateSpy = vi.spyOn(window.history, 'pushState');
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

  beforeEach(() => {
    window.history.replaceState(null, '', '/develop/app-123');
    useDevelopPageStore.setState({
      viewMode: ViewMode.EDIT,
      viewInitializedForPathname: null,
    });
    useCommanderStore.setState({
      openCanvasIds: [...DEFAULT_OPEN_CANVAS_IDS],
      activeCanvasId: PINNED_CANVAS_ID,
    });
    window.gasketData = undefined;
    vi.clearAllMocks();
  });

  it('opens inbox from ?view=inbox when available, without clobbering the URL', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    replaceStateSpy.mockClear();

    renderHook(() => useView({ getViewAvailability: allAvailable }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
    });
    expect(window.location.search).toBe('?view=inbox');
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('opens inbox immediately without a resolving phase', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    replaceStateSpy.mockClear();

    // Inbox availability returns resolving: false on the first call — no deferred re-render.
    const getViewAvailability = (mode: ViewMode): ViewAvailability =>
      mode === ViewMode.INBOX
        ? { available: true, resolving: false }
        : { available: true, resolving: false };

    renderHook(() => useView({ getViewAvailability }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
    });
    // Initialized in a single tick — no second rerender required.
    expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
    expect(window.location.search).toBe('?view=inbox');
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('falls back to default and strips ?view=inbox when unavailable', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    replaceStateSpy.mockClear();

    const getViewAvailability = (mode: ViewMode) =>
      mode === ViewMode.INBOX ? { available: false, resolving: false } : allAvailable();

    renderHook(() => useView({ getViewAvailability }));

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.has('view')).toBe(false);
    });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
  });

  it('writes ?view=inbox on enter and strips it on leave (replaceState, no history entries)', async () => {
    renderHook(() => useView({ getViewAvailability: allAvailable }));

    act(() => {
      useDevelopPageStore.getState().setViewMode(ViewMode.INBOX);
    });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('view')).toBe('inbox');
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useDevelopPageStore.getState().setViewMode(ViewMode.EDIT);
    });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has('view')).toBe(false);
    });
    expect(replaceStateSpy).toHaveBeenCalledTimes(2);
    expect(pushStateSpy).not.toHaveBeenCalled();
  });

  it('leaves ?conversationId= intact while in INBOX but strips it on leave', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox&conversationId=conv-abc');

    renderHook(() => useView({ getViewAvailability: allAvailable }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
    });
    // Inbox owns the param while its view is active.
    expect(new URLSearchParams(window.location.search).get('conversationId')).toBe('conv-abc');

    act(() => {
      useDevelopPageStore.getState().setViewMode(ViewMode.EDIT);
    });

    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).has('conversationId')).toBe(false);
    });
    expect(new URLSearchParams(window.location.search).has('view')).toBe(false);
  });

  it('ignores an invalid ?view value', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=bogus');

    renderHook(() => useView({ getViewAvailability: allAvailable }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
    });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
  });

  it('restores viewMode from URL on popstate', async () => {
    renderHook(() => useView({ getViewAvailability: allAvailable }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
    });

    // Simulate Back/Forward landing on an inbox URL.
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
    });

    // Back to a no-view URL leaves the synced mode.
    window.history.replaceState(null, '', '/develop/app-123');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
    });
  });

  it('opens and activates the Inbox canvas tab on deep link when canvas tabs are enabled', async () => {
    setCanvasTabsFlag(true);
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');

    // Precondition: Inbox is not open by default, so setActiveCanvas alone would no-op.
    expect(useCommanderStore.getState().openCanvasIds).not.toContain(CanvasId.Inbox);

    renderHook(() => useView({ getViewAvailability: allAvailable }));

    await waitFor(() => {
      expect(useCommanderStore.getState().activeCanvasId).toBe(CanvasId.Inbox);
    });
    expect(useCommanderStore.getState().openCanvasIds).toContain(CanvasId.Inbox);
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
  });

  it('does not touch the commander store when canvas tabs are disabled', async () => {
    setCanvasTabsFlag(false);
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');

    renderHook(() => useView({ getViewAvailability: allAvailable }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
    });
    expect(useCommanderStore.getState().activeCanvasId).toBe(PINNED_CANVAS_ID);
    expect(useCommanderStore.getState().openCanvasIds).not.toContain(CanvasId.Inbox);
  });

  it('does not open the Inbox tab when the deep link is unavailable', async () => {
    setCanvasTabsFlag(true);
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');

    const getViewAvailability = (mode: ViewMode): ViewAvailability =>
      mode === ViewMode.INBOX ? { available: false, resolving: false } : allAvailable();

    renderHook(() => useView({ getViewAvailability }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
    });
    expect(useCommanderStore.getState().activeCanvasId).toBe(PINNED_CANVAS_ID);
    expect(useCommanderStore.getState().openCanvasIds).not.toContain(CanvasId.Inbox);
  });

  it('activates the Inbox tab on popstate to an inbox URL when canvas tabs are enabled', async () => {
    setCanvasTabsFlag(true);
    renderHook(() => useView({ getViewAvailability: allAvailable }));

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
    });

    window.history.replaceState(null, '', '/develop/app-123?view=inbox');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(useCommanderStore.getState().activeCanvasId).toBe(CanvasId.Inbox);
    });
    expect(useCommanderStore.getState().openCanvasIds).toContain(CanvasId.Inbox);
  });

  it('does not clobber a coexisting tab param', async () => {
    window.history.replaceState(null, '', '/develop/app-123?tab=history');

    const { rerender } = renderHook(() => useView({ getViewAvailability: allAvailable }));

    act(() => {
      useDevelopPageStore.getState().setViewMode(ViewMode.INBOX);
    });
    rerender();

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(params.get('view')).toBe('inbox');
      expect(params.get('tab')).toBe('history');
    });
  });
});
