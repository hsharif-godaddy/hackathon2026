/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useIsEmbedded } from './useIsEmbedded';

describe('useIsEmbedded', () => {
  const originalTop = window.top;
  const originalSelf = window.self;

  afterEach(() => {
    Object.defineProperty(window, 'top', { value: originalTop, writable: true, configurable: true });
    Object.defineProperty(window, 'self', { value: originalSelf, writable: true, configurable: true });
  });

  it('returns false when not in an iframe', () => {
    const { result } = renderHook(() => useIsEmbedded());
    expect(result.current).toBe(false);
  });

  it('returns true when self !== top', () => {
    const fakeTop = {};
    Object.defineProperty(window, 'top', { value: fakeTop, writable: true, configurable: true });
    Object.defineProperty(window, 'self', { value: {}, writable: true, configurable: true });

    const { result } = renderHook(() => useIsEmbedded());
    expect(result.current).toBe(true);
  });

  it('returns true when accessing top throws (cross-origin)', () => {
    const throwingTop = new Proxy({}, {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    Object.defineProperty(window, 'top', { value: throwingTop, writable: true, configurable: true });
    Object.defineProperty(window, 'self', { value: {}, writable: true, configurable: true });

    const { result } = renderHook(() => useIsEmbedded());
    expect(result.current).toBe(true);
  });
});
