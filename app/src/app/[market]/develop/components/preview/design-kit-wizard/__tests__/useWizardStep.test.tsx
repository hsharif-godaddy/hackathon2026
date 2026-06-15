// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useWizardStore } from '@/stores/useWizardStore';
import { useWizardStep } from '../useWizardStep';

// The hook imports `useBrandData` from the sibling `./useBrandData` re-export, so
// mock that exact specifier (relative to this test file in __tests__/).
vi.mock('../useBrandData', () => ({
  useBrandData: (): { data: { wizard: { step: number } }; isLoading: boolean } => ({
    data: { wizard: { step: 2 } },
    isLoading: false,
  }),
}));

// The hook persists with the bare global `fetch`.
const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ success: true, wizard: { step: 3 } }), { status: 200 }),
);
vi.stubGlobal('fetch', fetchMock);

describe('useWizardStep', () => {
  beforeEach(() => {
    useWizardStore.setState({ stepByApp: {} });
    fetchMock.mockClear();
  });

  it('hydrates the step from brand-data then reflects live store updates', async () => {
    const { result } = renderHook(() => useWizardStep('app1234567'));

    // Hydrated from the mocked brand-data (brand.wizard.step = 2).
    await waitFor(() => expect(result.current.step).toBe(2));

    // BuildPhaseHandler updates the store; the hook reflects it live.
    act(() => {
      useWizardStore.getState().setStep('app1234567', 4);
    });
    await waitFor(() => expect(result.current.step).toBe(4));
  });

  it('setStep PUTs to the wizard-step BFF route and updates the store', async () => {
    const { result } = renderHook(() => useWizardStep('app1234567'));

    await act(async () => {
      await result.current.setStep(3);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/design-kit/app1234567/wizard-step',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 3 }),
      }),
    );
    expect(useWizardStore.getState().getStep('app1234567')).toBe(3);
  });

  it('reverts the store to the previous step when the PUT returns a non-ok response', async () => {
    useWizardStore.setState({ stepByApp: { app1234567: 2 } });
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useWizardStep('app1234567'));

    await act(async () => {
      await result.current.setStep(4);
    });

    // Optimistic update was rolled back to the previously persisted step.
    expect(useWizardStore.getState().getStep('app1234567')).toBe(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reverts the store to the previous step when fetch rejects (and never throws)', async () => {
    useWizardStore.setState({ stepByApp: { app1234567: 2 } });
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useWizardStep('app1234567'));

    await act(async () => {
      // Resolves rather than rejecting — fire-and-forget callers stay safe.
      await expect(result.current.setStep(5)).resolves.toBeUndefined();
    });

    expect(useWizardStore.getState().getStep('app1234567')).toBe(2);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
