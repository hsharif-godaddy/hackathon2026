import { describe, it, expect, beforeEach, beforeAll, vi, afterEach } from 'vitest';
import { generateKeyPairSync, createPublicKey, type JsonWebKey } from 'node:crypto';
import { SignJWT, importPKCS8, type KeyObject } from 'jose';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const testJwk = createPublicKey(publicKey).export({ format: 'jwk' }) as JsonWebKey & { kid: string; alg?: string };
testJwk.kid = 'test-kid-1';
testJwk.alg = 'RS256';

const rotatedJwk = { ...testJwk, kid: 'rotated-kid-2' };

const TEST_CONFIG = {
  jwksUrl: 'https://example.com/.well-known/jwks.json',
  issuer: 'airo-app',
  audience: 'agents-service',
  algorithms: ['RS256'],
};

const { mockGetFeatures, mockGetJWTAgentConfig } = vi.hoisted(() => ({
  mockGetFeatures: vi.fn().mockReturnValue({ nodeEnv: 'production' }),
  mockGetJWTAgentConfig: vi.fn(),
}));

vi.mock('../../services/features.js', () => ({
  getFeatures: mockGetFeatures,
  BYPASS_SITE_IDS: ['bypass-site', 'default-site', 'local-dev-site', 'mock-site-id', 'unknown-site'],
  auth: {
    getJWKSUrl: () => 'https://example.com/.well-known/jwks.json',
    getSiteId: () => 'bypass-site',
  },
}));

vi.mock('../jwks-config.js', () => ({
  getJWTAgentConfig: mockGetJWTAgentConfig,
  validateJWTAgentConfig: () => ({ valid: true, errors: [] }),
}));

import { JWTValidator } from '../jwt-validator.js';

let originalDispatcher: Dispatcher;
let mockAgent: MockAgent;
let signingKey: KeyObject;

beforeAll(async () => {
  signingKey = await importPKCS8(privateKey, 'RS256') as KeyObject;
});

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);

  mockGetFeatures.mockReturnValue({ nodeEnv: 'production' });
  mockGetJWTAgentConfig.mockReturnValue(TEST_CONFIG);
});

afterEach(async () => {
  await mockAgent.close();
  setGlobalDispatcher(originalDispatcher);
  vi.clearAllMocks();
});

async function signTestToken(
  kid: string,
  claims: Record<string, unknown> = {},
  overrides: { issuer?: string; audience?: string; iat?: number; exp?: number | string } = {},
): Promise<string> {
  const jwt = new SignJWT({ siteId: 'bypass-site', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(overrides.issuer ?? 'airo-app')
    .setAudience(overrides.audience ?? 'agents-service')
    .setIssuedAt(overrides.iat)
    .setExpirationTime(overrides.exp ?? '1h');
  return jwt.sign(signingKey);
}

function mockJwksResponse(keys: Array<Record<string, unknown>>, times: number = 1) {
  const pool = mockAgent.get('https://example.com');
  pool
    .intercept({ path: '/.well-known/jwks.json', method: 'GET' })
    .reply(200, { keys }, { headers: { 'content-type': 'application/json' } })
    .times(times);
}

describe('JWTValidator JWKS fetching', () => {
  it('fetches key and validates token on cache miss', async () => {
    mockJwksResponse([testJwk]);

    const validator = new JWTValidator();
    const token = await signTestToken('test-kid-1');
    const result = await validator.validateToken(token);

    expect(result.valid).toBe(true);
    expect(result.claims?.siteId).toBe('bypass-site');
  });

  it('uses cached key on subsequent requests within cacheMaxAge', async () => {
    mockJwksResponse([testJwk], 1);

    const validator = new JWTValidator();
    const token = await signTestToken('test-kid-1');

    const first = await validator.validateToken(token);
    const second = await validator.validateToken(token);

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    mockAgent.assertNoPendingInterceptors();
  });

  it('refetches JWKS on kid miss (key rotation) after cooldown elapses', async () => {
    const pool = mockAgent.get('https://example.com');
    pool.intercept({ path: '/.well-known/jwks.json', method: 'GET' })
      .reply(200, { keys: [testJwk] });
    pool.intercept({ path: '/.well-known/jwks.json', method: 'GET' })
      .reply(200, { keys: [testJwk, rotatedJwk] });

    const validator = new JWTValidator();
    const oldToken = await signTestToken('test-kid-1');
    const newToken = await signTestToken('rotated-kid-2');

    expect((await validator.validateToken(oldToken)).valid).toBe(true);

    // jose's cooldownDuration gates refetch. Wait past the 30s window so the
    // kid miss triggers a refresh instead of immediately throwing.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 31_000);

    try {
      expect((await validator.validateToken(newToken)).valid).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    mockAgent.assertNoPendingInterceptors();
  });

  it('fails with signature error when kid still missing after refetch', async () => {
    mockJwksResponse([testJwk], 2);

    const validator = new JWTValidator();
    const token = await signTestToken('unknown-kid');

    const firstAttempt = await validator.validateToken(token);
    expect(firstAttempt.valid).toBe(false);
    expect(firstAttempt.reason).toBe('Invalid token signature');

    // Force jose past its 30s cooldown so the second attempt triggers a fresh JWKS fetch.
    // Asserting no pending interceptors proves both interceptors were consumed.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 31_000);
    try {
      const secondAttempt = await validator.validateToken(token);
      expect(secondAttempt.valid).toBe(false);
      expect(secondAttempt.reason).toBe('Invalid token signature');
    } finally {
      vi.useRealTimers();
    }
    mockAgent.assertNoPendingInterceptors();
  });

  it('fails with Token expired when exp has passed', async () => {
    mockJwksResponse([testJwk]);
    const now = Math.floor(Date.now() / 1000);
    const expired = await signTestToken('test-kid-1', {}, { iat: now - 7200, exp: now - 3600 });

    const result = await new JWTValidator().validateToken(expired);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Token expired');
  });

  it('fails with Invalid token audience on wrong aud', async () => {
    mockJwksResponse([testJwk]);
    const token = await signTestToken('test-kid-1', {}, { audience: 'wrong-audience' });

    const result = await new JWTValidator().validateToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid token audience');
  });

  it('returns No token provided for empty token', async () => {
    const result = await new JWTValidator().validateToken('');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('No token provided');
  });
});

describe('JWTValidator model override claims', () => {
  beforeEach(() => {
    mockJwksResponse([testJwk], 4);
  });

  it('extracts modelOverride claim from signed token', async () => {
    const token = await signTestToken('test-kid-1', { modelOverride: 'claude-sonnet-4-5' });
    const result = await new JWTValidator().validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.claims?.modelOverride).toBe('claude-sonnet-4-5');
  });

  it('extracts modelSelectorEnabled claim from signed token', async () => {
    const token = await signTestToken('test-kid-1', { modelSelectorEnabled: true });
    const result = await new JWTValidator().validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.claims?.modelSelectorEnabled).toBe(true);
  });

  it('leaves modelOverride undefined when missing', async () => {
    const token = await signTestToken('test-kid-1');
    const result = await new JWTValidator().validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.claims?.modelOverride).toBeUndefined();
  });

  it('leaves modelSelectorEnabled undefined when missing', async () => {
    const token = await signTestToken('test-kid-1');
    const result = await new JWTValidator().validateToken(token);
    expect(result.valid).toBe(true);
    expect(result.claims?.modelSelectorEnabled).toBeUndefined();
  });
});
