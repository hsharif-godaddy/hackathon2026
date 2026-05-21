import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// In-memory mock state shared with the loadCrmCert mock + the https mock.
let httpsCallCount = 0;
let mockSsoResponse = { statusCode: 200, body: '' };

mock.module('./cert-loader.mjs', {
  namedExports: {
    loadCrmCert: async () => ({ cert: 'FAKE_CERT_PEM', key: 'FAKE_KEY_PEM' }),
  },
});

mock.module('node:https', {
  defaultExport: {
    request: (_opts, callback) => {
      httpsCallCount += 1;
      // Defer the response slightly so the request callback is registered
      // before the response stream emits. Mirrors real-world async order.
      const handlers = {};
      const res = {
        statusCode: mockSsoResponse.statusCode,
        on: (event, fn) => { handlers[event] = fn; return res; },
      };
      setImmediate(() => {
        callback(res);
        if (handlers.data) handlers.data(Buffer.from(mockSsoResponse.body));
        if (handlers.end) handlers.end();
      });
      const req = {
        on: () => req,
        write: () => {},
        end: () => {},
        destroy: () => {},
      };
      return req;
    },
  },
});

const { mintCrmSsoJwt, _resetTokenCacheForTests } = await import('./crm-token.mjs');

/** Build a base64url-encoded JWT-shaped string with a given payload. The
 *  signature segment is irrelevant to our decoder; we just need three
 *  parts separated by dots. */
function fakeJwt(payload) {
  const header = Buffer.from('{"alg":"none"}').toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('mintCrmSsoJwt', () => {
  beforeEach(() => {
    _resetTokenCacheForTests();
    httpsCallCount = 0;
  });

  it('returns the SSO-issued token on cold start', async () => {
    mockSsoResponse = {
      statusCode: 200,
      body: JSON.stringify({ data: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }) }),
    };
    const token = await mintCrmSsoJwt();
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(httpsCallCount, 1);
  });

  it('caches across calls within JWT exp window — no second mint', async () => {
    const expSeconds = Math.floor(Date.now() / 1000) + 3600;
    mockSsoResponse = { statusCode: 200, body: JSON.stringify({ data: fakeJwt({ exp: expSeconds }) }) };
    await mintCrmSsoJwt();
    await mintCrmSsoJwt();
    await mintCrmSsoJwt();
    assert.equal(httpsCallCount, 1);
  });

  it('coalesces concurrent mint calls into a single SSO request', async () => {
    mockSsoResponse = {
      statusCode: 200,
      body: JSON.stringify({ data: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }) }),
    };
    const [a, b, c] = await Promise.all([mintCrmSsoJwt(), mintCrmSsoJwt(), mintCrmSsoJwt()]);
    assert.equal(a, b);
    assert.equal(b, c);
    assert.equal(httpsCallCount, 1);
  });

  it('falls back to FALLBACK_TTL_MS when JWT lacks exp claim', async () => {
    // Token has neither `exp` nor any decodable shape — decoder returns
    // null and the caller falls back to FALLBACK_TTL_MS (50 min). Should
    // still cache (no second mint on immediate re-call).
    mockSsoResponse = {
      statusCode: 200,
      body: JSON.stringify({ data: 'not.a.jwt' }),
    };
    await mintCrmSsoJwt();
    await mintCrmSsoJwt();
    assert.equal(httpsCallCount, 1);
  });

  it('rejects when SSO returns non-2xx status', async () => {
    mockSsoResponse = { statusCode: 500, body: 'gateway error' };
    await assert.rejects(mintCrmSsoJwt(), /SSO mint failed \(500\)/);
  });

  it('rejects when SSO returns non-JSON body', async () => {
    mockSsoResponse = { statusCode: 200, body: '<html>not json</html>' };
    await assert.rejects(mintCrmSsoJwt(), /SSO mint response not JSON/);
  });

  it('rejects when SSO returns null JSON', async () => {
    mockSsoResponse = { statusCode: 200, body: 'null' };
    await assert.rejects(mintCrmSsoJwt(), /SSO mint response was not a JSON object/);
  });

  it('rejects when SSO returns a non-object JSON value (string)', async () => {
    mockSsoResponse = { statusCode: 200, body: '"just-a-string"' };
    await assert.rejects(mintCrmSsoJwt(), /SSO mint response was not a JSON object/);
  });

  it('rejects when SSO response has no token field', async () => {
    mockSsoResponse = { statusCode: 200, body: JSON.stringify({ message: 'ok', other: 'value' }) };
    await assert.rejects(mintCrmSsoJwt(), /SSO mint returned no token/);
  });

  it('accepts access_token field as fallback to data', async () => {
    mockSsoResponse = {
      statusCode: 200,
      body: JSON.stringify({ access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }) }),
    };
    const token = await mintCrmSsoJwt();
    assert.ok(token);
  });
});
