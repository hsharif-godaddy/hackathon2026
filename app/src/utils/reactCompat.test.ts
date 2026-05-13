/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shimReactInternals } from './reactCompat';

vi.mock('@/lib/request-context', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('shimReactInternals', () => {
  const internals = { ReactCurrentOwner: { current: null } };

  beforeEach(() => {
    delete (window as any).React;
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (window as any).React;
  });

  it('patches immediately when window.React exists at call time', () => {
    (window as any).React = {
      version: '19.3.0-canary',
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: internals,
    };

    shimReactInternals();

    expect((window as any).React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED).toBe(internals);
  });

  it('installs a trap and patches when window.React is set later', () => {
    shimReactInternals();

    (window as any).React = {
      version: '19.3.0-canary',
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: internals,
    };

    expect((window as any).React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED).toBe(internals);
  });

  it('restores a normal property descriptor after trap fires', () => {
    shimReactInternals();

    (window as any).React = {
      version: '19.3.0-canary',
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: internals,
    };

    const descriptor = Object.getOwnPropertyDescriptor(window, 'React');
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.set).toBeUndefined();
  });

  it('is idempotent when called multiple times', () => {
    shimReactInternals();
    shimReactInternals();

    (window as any).React = {
      version: '19.3.0-canary',
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: internals,
    };

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

  it('injects ReactCurrentOwner when __SECRET_INTERNALS lacks it', () => {
    (window as any).React = {
      version: '19.0.0',
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {},
    };

    shimReactInternals();

    const secret = (window as any).React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    expect(secret.ReactCurrentOwner).toEqual({ current: null });
  });

  it('is a no-op when neither internals key exists', () => {
    (window as any).React = { version: '99.0.0' };

    shimReactInternals();

    expect((window as any).React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED).toBeUndefined();
  });
});
