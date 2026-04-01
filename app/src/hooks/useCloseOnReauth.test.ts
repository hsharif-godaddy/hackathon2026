/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useCloseOnReauth } from './useCloseOnReauth';

let mockSeq = 0;

vi.mock('@/stores/useAuthUIStore', () => ({
  useAuthUIStore: (selector: any) => selector({ needsReauthSeq: mockSeq }),
}));

describe('useCloseOnReauth', () => {
  beforeEach(() => {
    mockSeq = 0;
  });

  it('should not call onClose on mount when isOpen is false and seq is already non-zero', () => {
    const onClose = vi.fn();
    mockSeq = 1;

    renderHookWithProviders(() => useCloseOnReauth(false, onClose));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('should not call onClose on mount when needsReauthSeq is already non-zero', () => {
    const onClose = vi.fn();
    mockSeq = 5;

    renderHookWithProviders(() => useCloseOnReauth(true, onClose));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('should call onClose when seq increments after mount and isOpen is true', () => {
    const onClose = vi.fn();
    mockSeq = 0;

    const { rerender } = renderHookWithProviders(() => useCloseOnReauth(true, onClose));

    expect(onClose).not.toHaveBeenCalled();

    mockSeq = 1;
    rerender();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should not call onClose when seq increments but isOpen is false', () => {
    const onClose = vi.fn();
    mockSeq = 0;

    const { rerender } = renderHookWithProviders(() => useCloseOnReauth(false, onClose));

    mockSeq = 1;
    rerender();

    expect(onClose).not.toHaveBeenCalled();
  });

  it('should reset baseline on modal re-open in long-lived component', () => {
    const onClose = vi.fn();
    mockSeq = 0;

    let isOpen = false;
    const { rerender } = renderHookWithProviders(() => useCloseOnReauth(isOpen, onClose));

    // First reauth while closed
    mockSeq = 1;
    rerender();
    expect(onClose).not.toHaveBeenCalled();

    // Open modal - baseline resets to current seq
    isOpen = true;
    rerender();
    expect(onClose).not.toHaveBeenCalled();

    // Second reauth while open - should close
    mockSeq = 2;
    rerender();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should use latest onClose reference', () => {
    const onClose1 = vi.fn();
    const onClose2 = vi.fn();
    mockSeq = 0;

    let currentOnClose = onClose1;
    const { rerender } = renderHookWithProviders(() => useCloseOnReauth(true, currentOnClose));

    currentOnClose = onClose2;
    rerender();

    mockSeq = 1;
    rerender();

    expect(onClose1).not.toHaveBeenCalled();
    expect(onClose2).toHaveBeenCalledTimes(1);
  });
});
