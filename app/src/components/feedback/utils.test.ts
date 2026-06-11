// @vitest-environment jsdom
import { afterEach,beforeEach,describe, expect, it, vi } from 'vitest';

import { FULLSTORY_SESSION_URL_PREFIX, getAppIdFromUrl, getFullStorySessionId } from './utils';

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

describe('getFullStorySessionId', function getFullStorySessionIdTests() {
  beforeEach(function reset() {
    delete (window as { FS?: unknown }).FS;
  });

  afterEach(function restore() {
    delete (window as { FS?: unknown }).FS;
    vi.restoreAllMocks();
  });

  it('returns the verbatim (encoded) token from a /client-session/ URL', async function clientSession() {
    const token =
      '06658ebf-feab-4200-a710-61c2769f3000%3A69517c23-4b55-4d21-a6d5-f55d8e668a56%3A1780463915950';
    (window as unknown as { FS: () => Promise<string> }).FS = vi
      .fn()
      .mockResolvedValue(`https://app.fullstory.com/ui/YKBRC/client-session/${token}`);
    expect(await getFullStorySessionId()).toBe(token);
  });

  it('reconstructs the original replay URL via the prefix constant', async function reconstructs() {
    const token =
      '06658ebf-feab-4200-a710-61c2769f3000%3A69517c23-4b55-4d21-a6d5-f55d8e668a56%3A1780463915950';
    const url = `${FULLSTORY_SESSION_URL_PREFIX}${token}`;
    (window as unknown as { FS: () => Promise<string> }).FS = vi.fn().mockResolvedValue(url);
    expect(`${FULLSTORY_SESSION_URL_PREFIX}${await getFullStorySessionId()}`).toBe(url);
  });

  it('handles the legacy /session/ path variant', async function legacySession() {
    (window as unknown as { FS: () => Promise<string> }).FS = vi
      .fn()
      .mockResolvedValue('https://app.fullstory.com/ui/YKBRC/session/abcd1234%3A5678');
    expect(await getFullStorySessionId()).toBe('abcd1234%3A5678');
  });

  it('strips a trailing query string before extracting the token', async function trailingQuery() {
    (window as unknown as { FS: () => Promise<string> }).FS = vi
      .fn()
      .mockResolvedValue('https://app.fullstory.com/ui/YKBRC/client-session/tok123%3A456?foo=bar');
    expect(await getFullStorySessionId()).toBe('tok123%3A456');
  });

  it('returns null when FullStory is unavailable', async function unavailable() {
    expect(await getFullStorySessionId()).toBeNull();
  });

  it('returns null when the session URL is empty', async function empty() {
    (window as unknown as { FS: () => Promise<string | null> }).FS = vi.fn().mockResolvedValue(null);
    expect(await getFullStorySessionId()).toBeNull();
  });

  it('returns null when the URL is only a trailing slash', async function trailingSlashOnly() {
    (window as unknown as { FS: () => Promise<string> }).FS = vi.fn().mockResolvedValue('/');
    expect(await getFullStorySessionId()).toBeNull();
  });
});
