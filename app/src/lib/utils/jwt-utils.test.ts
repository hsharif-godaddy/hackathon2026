import { describe, expect, it } from 'vitest';

import { extractCustomerId, extractDelegatedEmployee, extractShopperId } from './jwt-utils';

function makeJWT(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

describe('extractShopperId', () => {
  it('returns top-level shopperId for basic tokens', () => {
    expect(extractShopperId(makeJWT({ shopperId: 'sh-top', cid: 'cid-top' }))).toBe('sh-top');
  });

  it('returns shopperId from e2s delegation chain', () => {
    expect(extractShopperId(makeJWT({ e2s: { shopperId: 'sh-e2s', cid: 'cid-e2s' } }))).toBe('sh-e2s');
  });

  it('returns shopperId from s2s delegation chain', () => {
    expect(extractShopperId(makeJWT({ s2s: { shopperId: 'sh-s2s', cid: 'cid-s2s' } }))).toBe('sh-s2s');
  });

  it('returns shopperId from cert2s delegation chain', () => {
    expect(extractShopperId(makeJWT({ cert2s: { shopperId: 'sh-cert2s', cid: 'cid-cert2s' } }))).toBe('sh-cert2s');
  });

  it('returns shopperId from e2s2s delegation chain', () => {
    expect(extractShopperId(makeJWT({ e2s2s: { shopperId: 'sh-e2s2s' } }))).toBe('sh-e2s2s');
  });

  it('prefers nested chain over top-level when both present', () => {
    expect(extractShopperId(makeJWT({ shopperId: 'sh-top', e2s: { shopperId: 'sh-e2s' } }))).toBe('sh-e2s');
  });

  it('returns null when shopperId is a non-string type', () => {
    expect(extractShopperId(makeJWT({ shopperId: 12345 }))).toBeNull();
  });

  it('returns sub as shopper ID fallback when shopperId is absent', () => {
    expect(extractShopperId(makeJWT({ sub: 'sh-from-sub' }))).toBe('sh-from-sub');
  });

  it('does not use sub when it is a Customer:-prefixed customer ID', () => {
    expect(extractShopperId(makeJWT({ sub: 'Customer:cid-123' }))).toBeNull();
  });

  it('does not use sub fallback when a delegation chain object is present (e.g. malformed e2s without shopperId)', () => {
    // e2s object present but missing shopperId — sub would be an employee ID, not a shopper ID
    expect(extractShopperId(makeJWT({ sub: 'employee-sub', e2s: { cid: 'cid-e2s' } }))).toBeNull();
  });

  it('delegation chain shopperId takes priority over sub fallback', () => {
    expect(extractShopperId(makeJWT({ sub: 'sh-from-sub', e2s: { shopperId: 'sh-e2s' } }))).toBe('sh-e2s');
  });

  it('returns null when payload has no shopperId or usable sub', () => {
    expect(extractShopperId(makeJWT({ cid: 'cid-only' }))).toBeNull();
  });

  it('returns null for an invalid token', () => {
    expect(extractShopperId('not.a.jwt')).toBeNull();
    expect(extractShopperId('')).toBeNull();
  });
});

describe('extractCustomerId', () => {
  it('returns top-level cid for basic tokens', () => {
    expect(extractCustomerId(makeJWT({ cid: 'cid-top' }))).toBe('cid-top');
  });

  it('returns cid from e2s delegation chain', () => {
    expect(extractCustomerId(makeJWT({ e2s: { cid: 'cid-e2s' } }))).toBe('cid-e2s');
  });

  it('returns cid from s2s delegation chain', () => {
    expect(extractCustomerId(makeJWT({ s2s: { cid: 'cid-s2s' } }))).toBe('cid-s2s');
  });

  it('returns cid from cert2s delegation chain', () => {
    expect(extractCustomerId(makeJWT({ cert2s: { cid: 'cid-cert2s' } }))).toBe('cid-cert2s');
  });

  it('returns cid from e2s2s delegation chain', () => {
    expect(extractCustomerId(makeJWT({ e2s2s: { cid: 'cid-e2s2s' } }))).toBe('cid-e2s2s');
  });

  it('prefers nested chain over top-level when both present', () => {
    expect(extractCustomerId(makeJWT({ cid: 'cid-top', e2s: { cid: 'cid-e2s' } }))).toBe('cid-e2s');
  });

  it('returns null when cid is a non-string type', () => {
    expect(extractCustomerId(makeJWT({ cid: 99999 }))).toBeNull();
  });

  it('returns cid extracted from Customer:-prefixed sub field', () => {
    expect(extractCustomerId(makeJWT({ sub: 'Customer:cid-from-sub' }))).toBe('cid-from-sub');
  });

  it('does not use sub without Customer: prefix as cid', () => {
    expect(extractCustomerId(makeJWT({ sub: 'plain-sub-value' }))).toBeNull();
  });

  it('does not use sub fallback when a delegation chain object is present (malformed e2s without cid)', () => {
    expect(extractCustomerId(makeJWT({ sub: 'Customer:cid-outer', e2s: { shopperId: 'sh-e2s' } }))).toBeNull();
  });

  it('returns null for an invalid token', () => {
    expect(extractCustomerId('not.a.jwt')).toBeNull();
  });
});

describe('extractDelegatedEmployee', () => {
  it('returns accountName from the del claim of an e2s token', () => {
    const token = makeJWT({
      auth: 'e2s',
      e2s: { shopperId: '67890', cid: 'customerId' },
      del: { accountName: 'fgoodwrk', typ: 'jomax', auth: 'basic' },
    });
    expect(extractDelegatedEmployee(token)).toBe('fgoodwrk');
  });

  it('returns null when del.accountName is a non-string type', () => {
    expect(extractDelegatedEmployee(makeJWT({ del: { accountName: 123, typ: 'jomax' } }))).toBeNull();
  });

  it('returns null when there is no del claim (non-impersonation token)', () => {
    expect(extractDelegatedEmployee(makeJWT({ shopperId: 'sh-top', cid: 'cid-top' }))).toBeNull();
  });

  it('returns null when del is not an object', () => {
    expect(extractDelegatedEmployee(makeJWT({ del: 'fgoodwrk' }))).toBeNull();
  });

  it('returns null for an invalid token', () => {
    expect(extractDelegatedEmployee('not.a.jwt')).toBeNull();
    expect(extractDelegatedEmployee('')).toBeNull();
  });
});
