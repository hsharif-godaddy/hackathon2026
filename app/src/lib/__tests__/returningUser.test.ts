/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://localhost" }
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isReturningUser, setReturningUserCookie } from '../returningUser';

const COOKIE_NAME = 'airo_returning_user';

describe('isReturningUser', () => {
  beforeEach(() => {
    // Clear cookies before each test
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
  });

  afterEach(() => {
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
  });

  it('returns false when the cookie is absent', () => {
    expect(isReturningUser()).toBe(false);
  });

  it('returns true when the cookie is present', () => {
    document.cookie = `${COOKIE_NAME}=1; Path=/`;
    expect(isReturningUser()).toBe(true);
  });

  it('returns false in non-browser environments', () => {
    const original = Object.getOwnPropertyDescriptor(global, 'document');
    Object.defineProperty(global, 'document', { value: undefined, configurable: true });
    expect(isReturningUser()).toBe(false);
    if (original) {
      Object.defineProperty(global, 'document', original);
    }
  });
});

describe('setReturningUserCookie', () => {
  afterEach(() => {
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; Path=/`;
  });

  it('sets the returning user cookie', () => {
    setReturningUserCookie();
    expect(document.cookie).toContain(COOKIE_NAME);
    expect(isReturningUser()).toBe(true);
  });

  it('is a no-op in non-browser environments', () => {
    const original = Object.getOwnPropertyDescriptor(global, 'document');
    Object.defineProperty(global, 'document', { value: undefined, configurable: true });
    expect(() => setReturningUserCookie()).not.toThrow();
    if (original) {
      Object.defineProperty(global, 'document', original);
    }
  });
});
