/**
 * Tests for x-katana-version extraction used to forward Katana dark-release
 * artifact selectors to downstream mgmt-airo calls.
 */

import { describe, expect, it } from 'vitest';

import { extractKatanaVersion, KATANA_VERSION_HEADER } from '../katana-version';

describe('extractKatanaVersion', () => {
  it('reads the value from the x-katana-version header', () => {
    const headers = new Headers({ [KATANA_VERSION_HEADER]: '12345' });
    expect(extractKatanaVersion(headers)).toBe('12345');
  });

  it('falls back to the x_katana_version cookie (underscores) when the header is absent', () => {
    const headers = new Headers({ cookie: 'foo=bar; x_katana_version=98765; baz=qux' });
    expect(extractKatanaVersion(headers)).toBe('98765');
  });

  it('also accepts a hyphenated x-katana-version cookie as a defensive fallback', () => {
    const headers = new Headers({ cookie: 'x-katana-version=55' });
    expect(extractKatanaVersion(headers)).toBe('55');
  });

  it('prefers the header over the cookie when both are present', () => {
    const headers = new Headers({
      [KATANA_VERSION_HEADER]: 'from-header',
      cookie: 'x_katana_version=from-cookie',
    });
    expect(extractKatanaVersion(headers)).toBe('from-header');
  });

  it('returns undefined when neither header nor cookie is present', () => {
    expect(extractKatanaVersion(new Headers())).toBeUndefined();
    expect(extractKatanaVersion(new Headers({ cookie: 'foo=bar' }))).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    const headers = new Headers({ [KATANA_VERSION_HEADER]: '  42  ' });
    expect(extractKatanaVersion(headers)).toBe('42');
  });

  it('accepts version-style selectors', () => {
    const headers = new Headers({ [KATANA_VERSION_HEADER]: 'v1.2.3-rc_4' });
    expect(extractKatanaVersion(headers)).toBe('v1.2.3-rc_4');
  });

  it('URL-decodes cookie values', () => {
    const headers = new Headers({ cookie: 'x_katana_version=v1.2.3' });
    expect(extractKatanaVersion(headers)).toBe('v1.2.3');
  });

  it('rejects values with disallowed characters (injection guard)', () => {
    expect(extractKatanaVersion(new Headers({ [KATANA_VERSION_HEADER]: 'has space' }))).toBeUndefined();
    expect(extractKatanaVersion(new Headers({ [KATANA_VERSION_HEADER]: 'a/b' }))).toBeUndefined();
    // Empty after trim
    expect(extractKatanaVersion(new Headers({ [KATANA_VERSION_HEADER]: '   ' }))).toBeUndefined();
  });

  it('rejects oversized values (> 64 chars)', () => {
    const headers = new Headers({ [KATANA_VERSION_HEADER]: 'a'.repeat(65) });
    expect(extractKatanaVersion(headers)).toBeUndefined();
  });
});
