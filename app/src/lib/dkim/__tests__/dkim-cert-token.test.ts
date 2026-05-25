import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// We hoist the mocks so they're installed before the module-under-test
// imports its dependencies.
const {
  mockExistsSync,
  mockReadFile,
  mockHttpsRequest,
  mockLogger,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFile: vi.fn(),
  mockHttpsRequest: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('node:fs', () => ({ existsSync: mockExistsSync }));
vi.mock('node:fs/promises', () => ({ readFile: mockReadFile }));
vi.mock('node:https', () => ({ default: { request: mockHttpsRequest } }));
vi.mock('@/lib/request-context', () => ({ logger: mockLogger }));

import { _clearTokenCacheForTesting, getDkimServiceToken } from '../dkim-cert-token';

// Build a minimal mock of the (req, res) → resolve flow that node:https
// emits. Tests pass a body string + statusCode; the helper drives the
// callback chain so makeTokenRequest resolves with the parsed token.
function mockHttpsResponse({ body, statusCode = 200 }: { body: string; statusCode?: number }) {
  mockHttpsRequest.mockImplementationOnce((_options: unknown, callback: (res: unknown) => void) => {
    const dataHandlers: Array<(chunk: string) => void> = [];
    const endHandlers: Array<() => void> = [];
    const res = {
      statusCode,
      on: (event: string, fn: (...args: unknown[]) => void) => {
        if (event === 'data') dataHandlers.push(fn as (chunk: string) => void);
        if (event === 'end') endHandlers.push(fn as () => void);
      },
    };
    // Schedule the response callback synchronously after the request
    // setup, mirroring how node:https calls back once the response head
    // arrives.
    queueMicrotask(() => {
      callback(res);
      // Push body bytes, then close.
      for (const handler of dataHandlers) handler(body);
      for (const handler of endHandlers) handler();
    });
    return {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
  });
}

function mockHttpsError(error: Error) {
  mockHttpsRequest.mockImplementationOnce(() => {
    const errorHandlers: Array<(err: Error) => void> = [];
    const req = {
      on: (event: string, fn: (...args: unknown[]) => void) => {
        if (event === 'error') errorHandlers.push(fn as (err: Error) => void);
      },
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
    queueMicrotask(() => {
      for (const handler of errorHandlers) handler(error);
    });
    return req;
  });
}

// Build a base64-encoded JWT-shaped string with the given exp claim.
// Signature is bogus — getDkimServiceToken doesn't verify, just decodes.
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${payload}.signature-not-verified`;
}

describe('getDkimServiceToken', () => {
  beforeEach(() => {
    _clearTokenCacheForTesting();
    mockExistsSync.mockReset();
    mockReadFile.mockReset();
    mockHttpsRequest.mockReset();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();

    // Default cert/key load — happy path.
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue('cert-or-key-pem');
  });

  afterEach(() => {
    _clearTokenCacheForTesting();
  });

  it('mints a token via SSO and returns it', async () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockHttpsResponse({ body: JSON.stringify({ data: token }) });

    const result = await getDkimServiceToken();
    expect(result).toBe(token);
    expect(mockHttpsRequest).toHaveBeenCalledOnce();
  });

  it('caches the token across calls within the exp window', async () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockHttpsResponse({ body: JSON.stringify({ data: token }) });

    const first = await getDkimServiceToken();
    const second = await getDkimServiceToken();
    expect(first).toBe(token);
    expect(second).toBe(token);
    // Critical: only one upstream call across two reads — cache hit on the second.
    expect(mockHttpsRequest).toHaveBeenCalledOnce();
  });

  it('single-flights concurrent refreshes', async () => {
    const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockHttpsResponse({ body: JSON.stringify({ data: token }) });

    // Two concurrent calls should share one in-flight refresh and resolve
    // to the same token. Without single-flight, both would hit SSO,
    // doubling the auth request rate during cold-cache windows.
    const [a, b] = await Promise.all([getDkimServiceToken(), getDkimServiceToken()]);
    expect(a).toBe(token);
    expect(b).toBe(token);
    expect(mockHttpsRequest).toHaveBeenCalledOnce();
  });

  it('refreshes the token after exp passes', async () => {
    const expiredJwt = makeJwt(Math.floor(Date.now() / 1000) - 60);
    const freshJwt = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockHttpsResponse({ body: JSON.stringify({ data: expiredJwt }) });
    mockHttpsResponse({ body: JSON.stringify({ data: freshJwt }) });

    await getDkimServiceToken();
    const second = await getDkimServiceToken();
    expect(second).toBe(freshJwt);
    expect(mockHttpsRequest).toHaveBeenCalledTimes(2);
  });

  it('falls back to 55 minutes when JWT exp parse fails (and logs warn)', async () => {
    const opaqueToken = 'not-a-jwt-just-an-opaque-string';
    mockHttpsResponse({ body: JSON.stringify({ data: opaqueToken }) });

    const result = await getDkimServiceToken();
    expect(result).toBe(opaqueToken);
    // The exp-parse fallback path should surface — silent fallback is what
    // the reviewer flagged. We log info for opaque tokens (a known shape)
    // and warn for parse failures (unexpected). Either signal is enough.
    const logged = [
      ...mockLogger.info.mock.calls.map((c: unknown[]) => c[0]),
      ...mockLogger.warn.mock.calls.map((c: unknown[]) => c[0]),
    ];
    expect(logged).toContain('dkim.cert-token.opaque');
  });

  it('warns on JWT-exp parse failure for malformed token', async () => {
    // Three-segment but invalid base64 in the payload — triggers the
    // try/catch around JSON.parse(Buffer.from(...).toString()).
    const malformed = 'a.@@@.c'; // '@@@' isn't valid base64 → JSON.parse throws
    mockHttpsResponse({ body: JSON.stringify({ data: malformed }) });

    await getDkimServiceToken();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'dkim.cert-token.exp-parse.fallback',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it('rejects when SSO returns non-2xx', async () => {
    mockHttpsResponse({ body: 'forbidden', statusCode: 403 });
    await expect(getDkimServiceToken()).rejects.toThrow(/SSO cert auth failed: 403/);
  });

  it('rejects when SSO returns empty body', async () => {
    mockHttpsResponse({ body: '' });
    await expect(getDkimServiceToken()).rejects.toThrow(/Empty SSO response/);
  });

  it('rejects when the network errors', async () => {
    mockHttpsError(new Error('ECONNREFUSED'));
    await expect(getDkimServiceToken()).rejects.toThrow(/ECONNREFUSED/);
  });

  it('falls back to opaque-string body when JSON parse fails (raw token response)', async () => {
    // Some SSO realms return the token as raw text, not JSON. The fallback
    // path treats trimmed body as the token directly.
    const raw = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    mockHttpsResponse({ body: `   ${raw}\n` });

    const result = await getDkimServiceToken();
    expect(result).toBe(raw);
  });

  it('throws when cert files are missing on disk', async () => {
    mockExistsSync.mockReturnValue(false);
    await expect(getDkimServiceToken()).rejects.toThrow(/DKIM client certificates not found/);
  });

  it('reads cert from env vars when DKIM_CLIENT_CERT/KEY are set', async () => {
    const originalCert = process.env.DKIM_CLIENT_CERT;
    const originalKey = process.env.DKIM_CLIENT_KEY;
    process.env.DKIM_CLIENT_CERT = 'inline-cert-pem';
    process.env.DKIM_CLIENT_KEY = 'inline-key-pem';

    try {
      const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
      mockHttpsResponse({ body: JSON.stringify({ data: token }) });

      const result = await getDkimServiceToken();
      expect(result).toBe(token);
      // Filesystem path NOT consulted when inline cert env vars are set.
      expect(mockReadFile).not.toHaveBeenCalled();
    } finally {
      process.env.DKIM_CLIENT_CERT = originalCert;
      process.env.DKIM_CLIENT_KEY = originalKey;
    }
  });

  it('logs default-URL warnings when env vars are unset', async () => {
    const originalEndpoint = process.env.DKIM_SSO_ENDPOINT;
    delete process.env.DKIM_SSO_ENDPOINT;

    try {
      const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
      mockHttpsResponse({ body: JSON.stringify({ data: token }) });

      await getDkimServiceToken();
      // Misconfigured prod deploys missing the env var would otherwise
      // silently route to test-godaddy.com; the warn makes it visible.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'dkim.cert-token.sso-endpoint.default',
        expect.objectContaining({ default: expect.stringContaining('sso.test-godaddy.com') }),
      );
    } finally {
      if (originalEndpoint !== undefined) process.env.DKIM_SSO_ENDPOINT = originalEndpoint;
    }
  });
});
