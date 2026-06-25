// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { logger } from '@/lib/request-context';
import { useWizardStore } from '@/stores/useWizardStore';
import { useWizardPhase } from '../useWizardPhase';

// The hook imports `useBrandData` from the sibling `./useBrandData` re-export, so
// mock that exact specifier (relative to this test file in __tests__/).
vi.mock('../useBrandData', () => ({
  useBrandData: (
    appId: string,
  ): { data: { wizard?: { phase: string } }; isLoading: boolean } => ({
    // 'appNoData' exercises the no-persisted-phase default; any other id hydrates 'brand'.
    data: appId === 'appNoData' ? {} : { wizard: { phase: 'brand' } },
    isLoading: false,
  }),
}));

// The hook persists with the bare global `fetch`.
const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({ success: true, wizard: { phase: 'ready' } }), { status: 200 }),
);
vi.stubGlobal('fetch', fetchMock);

describe('useWizardPhase', () => {
  beforeEach(() => {
    useWizardStore.setState({ phaseByApp: {} });
    fetchMock.mockClear();
  });

  it('hydrates the phase from brand-data then reflects live store updates', async () => {
    const { result } = renderHook(() => useWizardPhase('app1234567'));

    // Hydrated from the mocked brand-data (brand.wizard.phase = 'brand').
    await waitFor(() => expect(result.current.phase).toBe('brand'));

    // BuildPhaseHandler updates the store; the hook reflects it live.
    act(() => {
      useWizardStore.getState().setPhase('app1234567', 'ready');
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
  });

  it('defaults to gathering when nothing is persisted or in the store', () => {
    const { result } = renderHook(() => useWizardPhase('appNoData'));
    expect(result.current.phase).toBe('gathering');
  });

  it('setPhase PUTs to the wizard-step BFF route and updates the store', async () => {
    const { result } = renderHook(() => useWizardPhase('app1234567'));

    await act(async () => {
      await result.current.setPhase('ready');
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/design-kit/app1234567/wizard-step',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phase: 'ready' }),
      }),
    );
    expect(useWizardStore.getState().getPhase('app1234567')).toBe('ready');
  });

  it('reverts the store to the previous phase when the PUT returns a non-ok response', async () => {
    useWizardStore.setState({ phaseByApp: { app1234567: 'brand' } });
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useWizardPhase('app1234567'));

    await act(async () => {
      await result.current.setPhase('ready');
    });

    // Optimistic update was rolled back to the previously persisted phase.
    expect(useWizardStore.getState().getPhase('app1234567')).toBe('brand');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reverts the store to the previous phase when fetch rejects (and never throws)', async () => {
    useWizardStore.setState({ phaseByApp: { app1234567: 'brand' } });
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useWizardPhase('app1234567'));

    await act(async () => {
      // Resolves rather than rejecting — fire-and-forget callers stay safe.
      await expect(result.current.setPhase('ready')).resolves.toBeUndefined();
    });

    expect(useWizardStore.getState().getPhase('app1234567')).toBe('brand');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
