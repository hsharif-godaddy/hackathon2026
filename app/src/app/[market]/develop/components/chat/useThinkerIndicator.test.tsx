/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useThinkerIndicator } from '@/app/[market]/develop/components/chat/useThinkerIndicator';

const mockUseSwitchboard = vi.fn();

vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (featureName: string) => mockUseSwitchboard(featureName),
}));

describe('useThinkerIndicator', () => {
  it('returns thinking-daddy variant when the flag is enabled', function flagEnabled() {
    mockUseSwitchboard.mockReturnValue(true);

    const { result } = renderHook(() => useThinkerIndicator());

    expect(result.current.props.variant).toBe('thinking-daddy');
  });

  it('returns godaddy variant when the flag is disabled', function flagDisabled() {
    mockUseSwitchboard.mockReturnValue(false);

    const { result } = renderHook(() => useThinkerIndicator());

    expect(result.current.props.variant).toBe('godaddy');
  });

  it('defaults to godaddy when the flag is undefined', function flagUndefined() {
    mockUseSwitchboard.mockReturnValue(undefined);

    const { result } = renderHook(() => useThinkerIndicator());

    expect(result.current.props.variant).toBe('godaddy');
  });
});
