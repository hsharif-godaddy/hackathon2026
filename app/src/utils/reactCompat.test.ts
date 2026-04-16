/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shimReactInternals } from './reactCompat';

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import { logger } from '@/lib/request-context';

describe('shimReactInternals', () => {
  const internals = { ReactCurrentOwner: { current: null } };

  beforeEach(() => {
    delete (window as any).React;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as any).React;
  });

  it('warns when window.React is not set', () => {
    shimReactInternals();

    expect(logger.warn).toHaveBeenCalledWith('reactCompat.shim.skipped', {
      reason: 'window.React not set',
    });
  });

  it('aliases React 19 internals to the React 18 property name', () => {
    (window as any).React = {
      version: '19.3.0-canary',
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: internals,
    };

    shimReactInternals();

    expect((window as any).React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED).toBe(internals);
  });

  it('is idempotent when __SECRET_INTERNALS already exists', () => {
    const existingInternals = { ReactCurrentOwner: { current: 'existing' } };
    (window as any).React = {
      version: '18.3.1',
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: existingInternals,
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: internals,
    };

    shimReactInternals();

    expect((window as any).React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED).toBe(existingInternals);
  });

  it('warns when neither internals key exists', () => {
    (window as any).React = { version: '99.0.0' };

    shimReactInternals();

    expect(logger.warn).toHaveBeenCalledWith('reactCompat.shim.skipped', {
      reason: 'React 19 internals key not found on window.React',
      reactVersion: '99.0.0',
    });
  });
});
