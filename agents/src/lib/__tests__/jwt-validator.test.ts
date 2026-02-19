import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateKeyPairSync, createPublicKey, type JsonWebKey } from 'node:crypto';

// Generate RSA key pair for testing
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const testJwk = createPublicKey(publicKey).export({ format: 'jwk' }) as JsonWebKey & { kid: string };
testJwk.kid = 'test-kid-1';

const rotatedJwk = { ...testJwk, kid: 'rotated-kid-2' };

// Hoist mocks
const { mockFetch, mockLoggerInfo, mockLoggerError } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../services/features.js', () => ({
  getFeatures: () => ({ nodeEnv: 'production' }),
  auth: {
    getJWKSUrl: () => 'https://example.com/.well-known/jwks.json',
    getSiteId: () => 'bypass-site',
  },
}));

vi.mock('../jwks-config.js', () => ({
  getJWTAgentConfig: () => ({
    jwksUrl: 'https://example.com/.well-known/jwks.json',
    issuer: 'airo-app',
    audience: 'agents-service',
    algorithms: ['RS256'],
  }),
  validateJWTAgentConfig: () => ({ valid: true, errors: [] }),
}));

vi.mock('../../logging/index.js', () => ({
  logger: {
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock global fetch
vi.stubGlobal('fetch', mockFetch);

// Use real jsonwebtoken for creating test tokens
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');

import { JWTValidator } from '../jwt-validator.js';

function createTestToken(kid: string): string {
  return jwt.sign(
    {
      iss: 'airo-app',
      aud: 'agents-service',
      siteId: 'bypass-site',
    },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '1h',
      header: { kid },
    }
  );
}

function mockFetchResponse(keys: Array<JsonWebKey & { kid: string }>) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ keys }),
  });
}

describe('JWTValidator JWKS cache-busting', () => {
  let validator: JWTValidator;

  beforeEach(() => {
    vi.clearAllMocks();
    validator = new JWTValidator();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch key on cache miss and cache it', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse([testJwk]));

    const token = createTestToken('test-kid-1');
    const result = await validator.validateToken(token);

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockLoggerInfo).toHaveBeenCalledWith('jwks.key.fetched', expect.objectContaining({ kid: 'test-kid-1' }));
  });

  it('should use cached key on subsequent requests', async () => {
    mockFetch.mockReturnValueOnce(mockFetchResponse([testJwk]));

    const token = createTestToken('test-kid-1');
    await validator.validateToken(token);
    await validator.validateToken(token);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should retry with cache-busting headers when kid not found on first fetch', async () => {
    // First fetch returns old key only; cache-bust retry returns rotated key
    mockFetch
      .mockReturnValueOnce(mockFetchResponse([testJwk]))
      .mockReturnValueOnce(mockFetchResponse([testJwk, rotatedJwk]));

    const token = createTestToken('rotated-kid-2');
    const result = await validator.validateToken(token);

    expect(result.valid).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify cache-bust headers on retry
    const retryCall = mockFetch.mock.calls[1];
    expect(retryCall[1].headers).toHaveProperty('Cache-Control', 'no-cache, no-store');
    expect(retryCall[1].headers).toHaveProperty('Pragma', 'no-cache');

    // First call should NOT have cache-bust headers
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[1].headers).not.toHaveProperty('Cache-Control');
  });

  it('should log jwks.key.miss when kid not found on first fetch', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse([testJwk]))
      .mockReturnValueOnce(mockFetchResponse([testJwk, rotatedJwk]));

    const token = createTestToken('rotated-kid-2');
    await validator.validateToken(token);

    expect(mockLoggerInfo).toHaveBeenCalledWith('jwks.key.miss', expect.objectContaining({
      kid: 'rotated-kid-2',
      availableKids: ['test-kid-1'],
    }));
  });

  it('should fail when kid not found even after cache-bust retry', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse([testJwk]))
      .mockReturnValueOnce(mockFetchResponse([testJwk]));

    const token = createTestToken('unknown-kid');
    const result = await validator.validateToken(token);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Failed to fetch public key');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockLoggerError).toHaveBeenCalledWith('jwks.fetch.error', expect.objectContaining({ kid: 'unknown-kid' }));
  });

  it('should cache key after successful cache-bust retry', async () => {
    mockFetch
      .mockReturnValueOnce(mockFetchResponse([testJwk]))
      .mockReturnValueOnce(mockFetchResponse([testJwk, rotatedJwk]));

    const token = createTestToken('rotated-kid-2');
    await validator.validateToken(token);

    // Second call should use cache, no additional fetch
    await validator.validateToken(token);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
