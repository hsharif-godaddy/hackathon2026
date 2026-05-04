import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSharePayload } from '@airo/shared';

import {
  airoAppDomainForHost,
  decodeSharePayloadEdge,
} from '../edge-decode';

describe('decodeSharePayloadEdge', () => {
  it('round-trips a valid payload encoded by @airo/shared', () => {
    const original = { siteId: 'k8bnu24pcq', cellPrefix: 'c4', token: 'yPBorcyKvnYJ' };
    const encoded = encodeSharePayload(original);
    expect(decodeSharePayloadEdge(encoded)).toEqual(original);
  });

  it('round-trips with token containing - and _', () => {
    const original = { siteId: 'k8bnu24pcq', cellPrefix: 'c9', token: 'H-NQO5LBt0_H' };
    const encoded = encodeSharePayload(original);
    expect(decodeSharePayloadEdge(encoded)).toEqual(original);
  });

  it('round-trips with multi-digit cellPrefix', () => {
    const original = { siteId: 'test-app-123', cellPrefix: 'c36', token: 'yPBorcyKvnYJ' };
    const encoded = encodeSharePayload(original);
    expect(decodeSharePayloadEdge(encoded)).toEqual(original);
  });

  it('returns null for empty input', () => {
    expect(decodeSharePayloadEdge('')).toBeNull();
  });

  it('returns null when encoded length exceeds the cap', () => {
    expect(decodeSharePayloadEdge('a'.repeat(129))).toBeNull();
  });

  it('returns null on hostname-injection attempts (dot in siteId)', () => {
    // Hand-built base64url of "evil.com:c4:yPBorcyKvnYJ"
    const evil = btoa('evil.com:c4:yPBorcyKvnYJ').replace(/=+$/, '');
    expect(decodeSharePayloadEdge(evil)).toBeNull();
  });

  it('returns null when payload has wrong number of fields', () => {
    const wrong = btoa('only:two').replace(/=+$/, '');
    expect(decodeSharePayloadEdge(wrong)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(decodeSharePayloadEdge(undefined as unknown as string)).toBeNull();
    expect(decodeSharePayloadEdge(null as unknown as string)).toBeNull();
  });
});

describe('airoAppDomainForHost', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // global vitest setup mocks console.warn — re-spy so we can assert on it
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('returns the prod airo-app domain for the canonical prod BFF host (airo.ai)', () => {
    expect(airoAppDomainForHost('airo.ai')).toBe('airoapp.ai');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('returns the prod airo-app domain for the legacy prod BFF host', () => {
    // Legacy `airo-builder.godaddy.com` host stays recognized during the
    // migration to airo.ai. Safe to remove once cutover is complete.
    expect(airoAppDomainForHost('airo-builder.godaddy.com')).toBe('airoapp.ai');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('returns the test airo-app domain for the canonical test BFF host (test-airoapp.ai)', () => {
    expect(airoAppDomainForHost('test-airoapp.ai')).toBe('test-airoapp.ai');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('returns the test airo-app domain for the legacy test BFF host', () => {
    expect(airoAppDomainForHost('airo-builder.test-godaddy.com')).toBe('test-airoapp.ai');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('returns the test airo-app domain for the dev BFF host', () => {
    expect(airoAppDomainForHost('airo-builder.dev-godaddy.com')).toBe('test-airoapp.ai');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('strips ports before matching', () => {
    expect(airoAppDomainForHost('airo.ai:8443')).toBe('airoapp.ai');
    expect(airoAppDomainForHost('local.gasket.dev-godaddy.com:8443')).toBe('test-airoapp.ai');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('unwraps bracketed IPv6 hosts (regression: split(":") would mangle them)', () => {
    // `[::1]:3000`.split(':')[0] would be `[` — matching no known host. The
    // bracket-aware parse extracts `::1` and falls through to the warn (we
    // don't currently recognize raw IPv6 as a known host); the assertion is
    // that the bracket is NOT leaked into the unrecognized-host log.
    airoAppDomainForHost('[::1]:3000');
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toContain('::1');
    expect(consoleWarnSpy.mock.calls[0]?.[0]).not.toContain('"[":');
  });

  it('falls back to test domain AND warns for unknown hosts', () => {
    expect(airoAppDomainForHost('something.unexpected.example')).toBe('test-airoapp.ai');
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toMatch(/unrecognized BFF host/);
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toContain('something.unexpected.example');
  });

  it('does not warn for any of the known test hosts', () => {
    airoAppDomainForHost('test-airoapp.ai');
    airoAppDomainForHost('airo-builder.test-godaddy.com');
    airoAppDomainForHost('airo-builder.dev-godaddy.com');
    airoAppDomainForHost('local.gasket.dev-godaddy.com');
    airoAppDomainForHost('localhost');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});
