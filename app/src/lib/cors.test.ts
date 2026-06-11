import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { withCorsHeaders } from './cors';

describe('withCorsHeaders allowlist', () => {
  it.each([
    'https://account.test-godaddy.com',
    'https://account.godaddy.com',
    'https://local.cx.test-godaddy.com:8443',
    'https://local.cx.godaddy.com:8443',
  ])('reflects allowlisted origin %s with credentials', (origin) => {
    const response = withCorsHeaders(NextResponse.json({ ok: true }), origin);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it.each([
    'https://evil.example.com',
    'https://local.cx.godaddy.com', // no port
    'http://local.cx.godaddy.com:8443', // wrong scheme
    null,
  ])('does not set CORS headers for non-allowlisted origin %s', (origin) => {
    const response = withCorsHeaders(NextResponse.json({ ok: true }), origin);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
});
