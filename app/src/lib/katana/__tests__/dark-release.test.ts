/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://local.test/develop" }
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exitDarkRelease, getDarkReleaseVersion } from '../dark-release';

function clearAllCookies(): void {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0].trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

afterEach(() => {
  clearAllCookies();
  vi.unstubAllGlobals();
});

describe('getDarkReleaseVersion', () => {
  it('returns the sanitized value from the x_katana_version cookie', () => {
    document.cookie = 'x_katana_version=ce83bde0e7c4ca598426f0357d8c698a8985ff49; path=/';
    expect(getDarkReleaseVersion()).toBe('ce83bde0e7c4ca598426f0357d8c698a8985ff49');
  });

  it('returns undefined when the cookie is absent', () => {
    expect(getDarkReleaseVersion()).toBeUndefined();
  });

  it('ignores unrelated cookies', () => {
    document.cookie = 'foo=bar; path=/';
    expect(getDarkReleaseVersion()).toBeUndefined();
  });

  it('returns undefined for a value that fails sanitization', () => {
    // decodes to "a/b" — the slash is rejected by the selector charset
    document.cookie = 'x_katana_version=a%2Fb; path=/';
    expect(getDarkReleaseVersion()).toBeUndefined();
  });
});

describe('exitDarkRelease', () => {
  it('deletes the cookie and reloads when there are no dark-release query params', () => {
    document.cookie = 'x_katana_version=abc123; path=/';
    const reload = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal('location', { href: 'https://local.test/develop', reload, replace });

    exitDarkRelease();

    expect(getDarkReleaseVersion()).toBeUndefined();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('strips dark-release query params and replaces the URL when present', () => {
    document.cookie = 'x_katana_version=abc123; path=/';
    const reload = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal('location', {
      href: 'https://local.test/develop?x-katana-version=abc123&cookie=1&keep=1',
      reload,
      replace,
    });

    exitDarkRelease();

    expect(replace).toHaveBeenCalledTimes(1);
    const target = String(replace.mock.calls[0][0]);
    expect(target).not.toContain('x-katana-version');
    expect(target).not.toContain('cookie=1');
    expect(target).toContain('keep=1');
    expect(reload).not.toHaveBeenCalled();
  });
});
