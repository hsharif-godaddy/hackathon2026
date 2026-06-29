import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from '@testing-library/react';

import { ViewMode } from '@/app/[market]/develop/components/types';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useView, type ViewAvailability } from './useView';

vi.mock('next/navigation', () => ({
  usePathname: () => '/develop/app-123',
}));

// Default: every mode available and resolved.
const allAvailable = () => ({ available: true, resolving: false });

describe('useView', () => {
  const pushStateSpy = vi.spyOn(window.history, 'pushState');
  const replaceStateSpy = vi.spyOn(window.history, 'replaceState');

  beforeEach(() => {
    window.history.replaceState(null, '', '/develop/app-123');
    useDevelopPageStore.setState({
      viewMode: ViewMode.EDIT,
      viewInitializedForPathname: null,
    });
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

  it('holds while resolving, then opens inbox once available', async () => {
    window.history.replaceState(null, '', '/develop/app-123?view=inbox');

    // The URL->store effect re-evaluates availability only when
    // getViewAvailability's *identity* changes. In page.tsx that identity is a
    // useCallback keyed on the inbox-account query (isLoadingAccount/brandId),
    // so it flips when the query settles. Mirror that here by passing a FRESH
    // function per render via renderHook props — NOT a stable closure over a
    // mutable `resolving` (a stable ref would never re-trigger the effect, and
    // the post-resolve assertion would hang).
    const makeAvailability =
      (resolving: boolean) =>
      (mode: ViewMode): ViewAvailability =>
        mode === ViewMode.INBOX ? { available: true, resolving } : allAvailable();

    const { rerender } = renderHook(
      ({ getViewAvailability }) => useView({ getViewAvailability }),
      { initialProps: { getViewAvailability: makeAvailability(true) } }
    );

    // Still resolving: no change, param preserved, not initialized.
    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewInitializedForPathname).toBeNull();
    });
    expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
    expect(window.location.search).toBe('?view=inbox');

    // Resolve as available — a new function identity re-runs the effect.
    rerender({ getViewAvailability: makeAvailability(false) });

    await waitFor(() => {
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
    });
    expect(window.location.search).toBe('?view=inbox');
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

  describe('resolveInitialViewMode (initial default)', () => {
    it('lands on the resolved initial mode on a fresh load with no view param', async () => {
      renderHook(() =>
        useView({ getViewAvailability: allAvailable, resolveInitialViewMode: () => ViewMode.BRAND })
      );

      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
      });
      expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
    });

    it('leaves the default viewMode when resolveInitialViewMode returns null', async () => {
      renderHook(() =>
        useView({ getViewAvailability: allAvailable, resolveInitialViewMode: () => null })
      );

      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
      });
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
    });

    it('lets a valid ?view deep link win over the initial default', async () => {
      window.history.replaceState(null, '', '/develop/app-123?view=inbox');

      renderHook(() =>
        useView({ getViewAvailability: allAvailable, resolveInitialViewMode: () => ViewMode.BRAND })
      );

      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
      });
    });

    it('applies the initial default when an unavailable ?view is stripped', async () => {
      window.history.replaceState(null, '', '/develop/app-123?view=inbox');

      const getViewAvailability = (mode: ViewMode): ViewAvailability =>
        mode === ViewMode.INBOX ? { available: false, resolving: false } : allAvailable();

      renderHook(() => useView({ getViewAvailability, resolveInitialViewMode: () => ViewMode.BRAND }));

      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
      });
      expect(new URLSearchParams(window.location.search).has('view')).toBe(false);
    });

    it('does not snap back to the initial default after the user changes tabs', async () => {
      const { rerender } = renderHook(() =>
        useView({ getViewAvailability: allAvailable, resolveInitialViewMode: () => ViewMode.BRAND })
      );

      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
      });

      // User navigates away from the default tab.
      act(() => {
        useDevelopPageStore.getState().setViewMode(ViewMode.EDIT);
      });
      rerender();

      // The per-pathname init guard prevents the default from re-applying.
      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
      });
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);
    });

    it('holds the initial default while initialViewResolving, then applies it once resolved', async () => {
      const { rerender } = renderHook(
        ({ resolving }) =>
          useView({
            getViewAvailability: allAvailable,
            resolveInitialViewMode: () => ViewMode.BRAND,
            initialViewResolving: resolving,
          }),
        { initialProps: { resolving: true } }
      );

      // Held: not initialized, default not applied.
      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewInitializedForPathname).toBeNull();
      });
      expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.EDIT);

      // Resolved: applies the default and initializes.
      rerender({ resolving: false });
      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.BRAND);
      });
      expect(useDevelopPageStore.getState().viewInitializedForPathname).toBe('/develop/app-123');
    });

    it('lets a valid ?view deep link win even while initialViewResolving', async () => {
      window.history.replaceState(null, '', '/develop/app-123?view=inbox');

      renderHook(() =>
        useView({
          getViewAvailability: allAvailable,
          resolveInitialViewMode: () => ViewMode.BRAND,
          initialViewResolving: true,
        })
      );

      // The available deep link initializes immediately; the hold only defers the
      // *default* landing, not a valid URL-synced mode.
      await waitFor(() => {
        expect(useDevelopPageStore.getState().viewMode).toBe(ViewMode.INBOX);
      });
    });
  });
});
