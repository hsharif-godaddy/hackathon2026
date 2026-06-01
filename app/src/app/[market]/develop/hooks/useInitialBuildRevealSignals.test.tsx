/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it } from 'vitest';

import { useInitialBuildRevealSignals } from '@/app/[market]/develop/hooks/useInitialBuildRevealSignals';
import { renderHookWithProviders } from '@/tests/test-utils';

const APP_ID = 'app-test-1';

describe('useInitialBuildRevealSignals', function hookTests() {
  beforeEach(function clearStorage() {
    window.localStorage.clear();
  });

  it('is not reveal-ready before first file edit', function notReady() {
    const { result } = renderHookWithProviders(() =>
      useInitialBuildRevealSignals(false, APP_ID)
    );

    expect(result.current.isRevealReady).toBe(false);
    expect(result.current.firstFileEdit).toBe(false);
  });

  it('becomes reveal-ready when hasSeenFirstFileEdit is true', function ready() {
    const { result } = renderHookWithProviders(() =>
      useInitialBuildRevealSignals(true, APP_ID)
    );

    expect(result.current.isRevealReady).toBe(true);
    expect(result.current.firstFileEdit).toBe(true);
  });

  it('persists firstFileEdit to localStorage when hasSeenFirstFileEdit flips true', function persist() {
    renderHookWithProviders(() => useInitialBuildRevealSignals(true, APP_ID));

    expect(
      window.localStorage.getItem(`appbuilder-feedback-reveal:${APP_ID}:firstFileEdit`)
    ).toBe('true');
  });

  it('reads persisted firstFileEdit after reload when machine flag is false', function reload() {
    window.localStorage.setItem(`appbuilder-feedback-reveal:${APP_ID}:firstFileEdit`, 'true');

    const { result } = renderHookWithProviders(() =>
      useInitialBuildRevealSignals(false, APP_ID)
    );

    expect(result.current.firstFileEdit).toBe(true);
    expect(result.current.isRevealReady).toBe(true);
  });
});
