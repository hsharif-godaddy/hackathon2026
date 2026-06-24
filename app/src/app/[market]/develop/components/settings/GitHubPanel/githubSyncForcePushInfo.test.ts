/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';

import { renderHookWithProviders } from '@/tests/test-utils';
import { useGitHubSyncForcePushInfo } from './githubSyncForcePushInfo';

const APP_ID = 'test-app-123';
const STORAGE_KEY = `airo:github-sync-force-push-banner-dismiss-count:${APP_ID}`;

describe('useGitHubSyncForcePushInfo', function forcePushInfoTests() {
  beforeEach(function clearStorage() {
    localStorage.clear();
  });

  afterEach(function cleanup() {
    localStorage.clear();
  });

  it('should show banner and hide info icon with zero dismissals', function initialState() {
    const { result } = renderHookWithProviders(() => useGitHubSyncForcePushInfo(APP_ID));

    expect(result.current.showBanner).toBe(true);
    expect(result.current.showInfoIcon).toBe(false);
    expect(result.current.message).toBeTruthy();
  });

  it('should hide banner and show info icon at threshold (2 dismissals)', function threshold() {
    localStorage.setItem(STORAGE_KEY, '2');

    const { result } = renderHookWithProviders(() => useGitHubSyncForcePushInfo(APP_ID));

    expect(result.current.showBanner).toBe(false);
    expect(result.current.showInfoIcon).toBe(true);
  });

  it('should still show banner after 1 dismiss (below threshold)', function belowThreshold() {
    localStorage.setItem(STORAGE_KEY, '1');

    const { result } = renderHookWithProviders(() => useGitHubSyncForcePushInfo(APP_ID));

    expect(result.current.showBanner).toBe(true);
    expect(result.current.showInfoIcon).toBe(false);
  });

  it('should hide banner after dismissBanner is called and persist to localStorage', function dismiss() {
    const { result } = renderHookWithProviders(() => useGitHubSyncForcePushInfo(APP_ID));

    act(function dismiss() {
      result.current.dismissBanner();
    });

    expect(result.current.showBanner).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('should clamp negative localStorage values to zero', function negativeValue() {
    localStorage.setItem(STORAGE_KEY, '-5');

    const { result } = renderHookWithProviders(() => useGitHubSyncForcePushInfo(APP_ID));

    expect(result.current.showBanner).toBe(true);
    expect(result.current.showInfoIcon).toBe(false);
  });

  it('should clamp malformed localStorage values to zero', function malformed() {
    localStorage.setItem(STORAGE_KEY, 'not-a-number');

    const { result } = renderHookWithProviders(() => useGitHubSyncForcePushInfo(APP_ID));

    expect(result.current.showBanner).toBe(true);
    expect(result.current.showInfoIcon).toBe(false);
  });
});
