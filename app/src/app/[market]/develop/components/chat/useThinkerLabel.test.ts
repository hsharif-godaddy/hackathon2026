/**
 * @vitest-environment jsdom
 */
import { beforeEach,describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mutable store values the mocked selectors read at render time.
const mocks = vi.hoisted(() => ({
  runningToolName: null as string | null,
  awaitCount: 0,
  interimStatus: null as string | null,
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useActiveRunningToolName: () => mocks.runningToolName,
  useActiveAwaitAgentsCount: () => mocks.awaitCount,
  useInterimStatus: () => mocks.interimStatus,
}));

vi.mock('@/hooks/useTranslations', () => ({
  // Mirror the real t(key, values?, defaultMessage?) — return the default when given,
  // else the key, so assertions are deterministic without ICU interpolation.
  useTranslations: () => (key: string, _values?: unknown, defaultMessage?: string) => defaultMessage ?? key,
}));

vi.mock('@/utils/toolNameMapping', () => ({
  getToolActiveDisplayName: (name: string) => `tool:${name}`,
}));

import { useThinkerLabel } from './useThinkerLabel';

const label = (): string => renderHook(() => useThinkerLabel()).result.current;

describe('useThinkerLabel precedence', () => {
  beforeEach(() => {
    mocks.runningToolName = null;
    mocks.awaitCount = 0;
    mocks.interimStatus = null;
  });

  it("a running tool's own label wins over an interim status", () => {
    mocks.runningToolName = 'colorScheme';
    mocks.interimStatus = 'Setting up your project…';
    expect(label()).toBe('tool:colorScheme');
  });

  it('falls back to the interim status when no tool is running', () => {
    mocks.interimStatus = 'Finding vibes that match your brand…';
    expect(label()).toBe('Finding vibes that match your brand…');
  });

  it('falls back to the generic thinking label when nothing else is set', () => {
    expect(label()).toBe('builder_agent_thinking');
  });

  it('shows the count-aware awaitAgents label, ignoring any interim status', () => {
    mocks.runningToolName = 'awaitAgents';
    mocks.awaitCount = 3;
    mocks.interimStatus = 'should be ignored';
    const result = label();
    expect(result).not.toBe('should be ignored');
    // default: 'Waiting for {count, plural, one {# task} other {# tasks}} to finish'
    expect(result).toContain('task');
  });
});
