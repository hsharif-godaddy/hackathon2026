/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useThinkerIndicator } from '@/app/[market]/develop/components/chat/useThinkerIndicator';

const mockUseAuth = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('useThinkerIndicator', () => {
  it('returns godaddy variant for general accounts', function generalAccount() {
    mockUseAuth.mockReturnValue({
      getUserInfo: () => ({ shopperId: '12345678' }),
    });

    const { result } = renderHook(() => useThinkerIndicator());

    expect(result.current.props.variant).toBe('godaddy');
  });

  it('returns thinking-daddy variant for TLA accounts', function tlaAccount() {
    mockUseAuth.mockReturnValue({
      getUserInfo: () => ({ shopperId: 'abc' }),
    });

    const { result } = renderHook(() => useThinkerIndicator());

    expect(result.current.props.variant).toBe('thinking-daddy');
  });

  it('defaults to godaddy when shopperId is missing', function missingShopperId() {
    mockUseAuth.mockReturnValue({
      getUserInfo: () => ({}),
    });

    const { result } = renderHook(() => useThinkerIndicator());

    expect(result.current.props.variant).toBe('godaddy');
  });
});
