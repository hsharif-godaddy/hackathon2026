// @vitest-environment jsdom
import { afterEach,describe, expect, it } from 'vitest';

import { getAppIdFromUrl } from './utils';

describe('getAppIdFromUrl', function getAppIdFromUrlTests() {
  const originalLocation = window.location;

  function setPathname(pathname: string) {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, pathname },
    });
  }

  afterEach(function restore() {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('should extract appId from develop path', function extractAppId() {
    setPathname('/en-US/develop/abc123/context');
    expect(getAppIdFromUrl()).toBe('abc123');
  });

  it('should extract appId from develop path without subpage', function extractAppIdNoSubpage() {
    setPathname('/en-US/develop/xyz789');
    expect(getAppIdFromUrl()).toBe('xyz789');
  });

  it('should return null when not on a develop page', function noDevlopPage() {
    setPathname('/en-US/');
    expect(getAppIdFromUrl()).toBeNull();
  });

  it('should return null when develop segment has no following segment', function developNoId() {
    setPathname('/en-US/develop');
    expect(getAppIdFromUrl()).toBeNull();
  });

  it('should return null for root path', function rootPath() {
    setPathname('/');
    expect(getAppIdFromUrl()).toBeNull();
  });
});
