import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Import the pure helpers directly so this test runs without the
// AWS SDK / gd-auth-client deps that handler.mjs pulls in. The handler
// re-exports the same symbols, but importing handler.mjs requires
// `npm install` against GoDaddy's private Artifactory.
import { decodeJwtExpMs, buildChildEnv } from './auth.mjs';

// Build a JWT with the given payload, signed with a stub HS256 placeholder.
// Tests never verify the signature so the stub is harmless.
function makeJwt(payloadObj) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  return `${header}.${payload}.stub-signature`;
}

describe('decodeJwtExpMs', () => {
  it('returns exp converted from seconds to milliseconds', () => {
    const exp = 1_700_000_000;
    const ms = decodeJwtExpMs(makeJwt({ exp }));
    assert.equal(ms, exp * 1000);
  });

  it('decodes payloads with base64url-only chars (- and _)', () => {
    // Force a payload that contains characters which differ between
    // base64 and base64url. We do this by stuffing the iss claim with
    // bytes that, when JSON+base64url-encoded, produce `-` or `_` chars
    // in the segment. The presence of those chars in the encoded form
    // is what would have tripped the old `Buffer.from(_, 'base64')`.
    const iss = 'gocode-sso?>>'; // produces base64url-distinct chars
    const exp = 1_800_000_000;
    const jwt = makeJwt({ iss, exp });
    const segment = jwt.split('.')[1];
    assert.ok(
      segment.includes('-') || segment.includes('_'),
      `expected base64url-specific chars in segment for regression value (got ${segment})`,
    );
    const ms = decodeJwtExpMs(jwt);
    assert.equal(ms, exp * 1000);
  });

  it('falls back to iat + 30min when exp is missing (GoCode S2S shape)', () => {
    const iat = 1_700_000_000;
    const ms = decodeJwtExpMs(makeJwt({ iat, iss: 'sso.godaddy.com' }));
    assert.equal(ms, iat * 1000 + 30 * 60 * 1000);
  });

  it('prefers exp over iat fallback when both are present', () => {
    const iat = 1_700_000_000;
    const exp = iat + 60; // earlier than iat+30min
    const ms = decodeJwtExpMs(makeJwt({ iat, exp }));
    assert.equal(ms, exp * 1000);
  });

  it('throws when both exp and iat are missing', () => {
    assert.throws(
      () => decodeJwtExpMs(makeJwt({ iss: 'sso.godaddy.com' })),
      /JWT has neither 'exp' nor 'iat' claim.*iss=sso.godaddy.com/,
    );
  });

  it('throws on malformed JWT (wrong segment count)', () => {
    assert.throws(() => decodeJwtExpMs('only.two'), /Invalid JWT format/);
  });

  it('throws on empty payload segment', () => {
    assert.throws(() => decodeJwtExpMs('header..signature'), /Invalid JWT format/);
  });
});

describe('buildChildEnv', () => {
  // Stash + restore process.env around each test so cases can't pollute
  // each other or the rest of the suite.
  const savedEnv = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, savedEnv);
  });

  it('forwards the documented allowlist when set', () => {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/tmp';
    process.env.CLAUDE_CONFIG_DIR = '/tmp/.claude';
    process.env.ANTHROPIC_AUTH_TOKEN = 'tok-123';
    process.env.ANTHROPIC_BASE_URL = 'https://api.gocode.example';
    process.env.JOMAX_TOKEN = 'jom-456';
    process.env.REPORT_DIR = '/tmp/inv';
    process.env.CONSOLE_BASE = 'https://console.example';
    process.env.NODE_OPTIONS = '--enable-source-maps';
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
    process.env.LANG = 'en_US.UTF-8';
    process.env.LC_ALL = 'en_US.UTF-8';
    process.env.TZ = 'UTC';

    const env = buildChildEnv();

    for (const k of [
      'PATH', 'HOME', 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL', 'JOMAX_TOKEN', 'REPORT_DIR', 'CONSOLE_BASE',
      'NODE_OPTIONS', 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
      'LANG', 'LC_ALL', 'TZ',
    ]) {
      assert.equal(env[k], process.env[k], `missing or wrong: ${k}`);
    }
  });

  it('drops AWS_* execution-role credentials and other secrets', () => {
    // The whole point of buildChildEnv is to keep these out of the child.
    process.env.AWS_ACCESS_KEY_ID = 'AKIA...';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.AWS_SESSION_TOKEN = 'sess';
    process.env.AWS_LAMBDA_RUNTIME_API = '127.0.0.1:9001';
    process.env.STATE_BUCKET = 'airo-investigations-dev';
    process.env.SSO_HOST = 'sso.test-godaddy.com';
    process.env.GOCODE_USE_S2S_AUTH = 'true';
    // And one allowed var so we can sanity-check the result isn't empty.
    process.env.PATH = '/usr/bin';

    const env = buildChildEnv();

    for (const k of [
      'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
      'AWS_LAMBDA_RUNTIME_API', 'STATE_BUCKET', 'SSO_HOST',
      'GOCODE_USE_S2S_AUTH',
    ]) {
      assert.equal(env[k], undefined, `should not forward: ${k}`);
    }
    assert.equal(env.PATH, '/usr/bin');
  });

  it('omits allowlisted keys that are unset (no undefined values)', () => {
    // PATH only — every other allowlist entry is unset. The result should
    // contain PATH and nothing else; entries should be omitted, not
    // present-with-undefined.
    process.env.PATH = '/usr/bin';

    const env = buildChildEnv();

    assert.deepEqual(Object.keys(env), ['PATH']);
  });

  it('returns a null-prototype object so child cannot inherit prototype pollution', () => {
    process.env.PATH = '/usr/bin';
    const env = buildChildEnv();
    assert.equal(Object.getPrototypeOf(env), null);
  });
});
