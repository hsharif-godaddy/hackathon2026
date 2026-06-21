import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAuthzFgaConfig, isAuthzFgaLocalMock } from '@/lib/authz-fga/config';

/**
 * AUTHZ_FGA_LOCAL_MOCK is an auth bypass (check → true, enforce → allow,
 * write → skip). These tests lock in that it is honored ONLY in local
 * development and is silently ignored in any deployed environment, so a leaked
 * env var can never disable authorization in test/prod.
 */
describe('isAuthzFgaLocalMock', () => {
  const ENV_KEYS = ['AUTHZ_FGA_LOCAL_MOCK', 'NODE_ENV'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
    vi.restoreAllMocks();
  });

  it('is false when the env var is unset', () => {
    delete process.env.AUTHZ_FGA_LOCAL_MOCK;
    expect(isAuthzFgaLocalMock()).toBe(false);
  });

  it('is true for local dev (NODE_ENV=development)', () => {
    process.env.AUTHZ_FGA_LOCAL_MOCK = 'true';
    process.env.NODE_ENV = 'development';
    expect(isAuthzFgaLocalMock()).toBe(true);
  });

  it('is true for unit tests (NODE_ENV=test)', () => {
    process.env.AUTHZ_FGA_LOCAL_MOCK = 'true';
    process.env.NODE_ENV = 'test';
    expect(isAuthzFgaLocalMock()).toBe(true);
  });

  it('is ignored in any deployed (production) build', () => {
    process.env.AUTHZ_FGA_LOCAL_MOCK = 'true';
    process.env.NODE_ENV = 'production';
    expect(isAuthzFgaLocalMock()).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('getAuthzFgaConfig', () => {
  const ENV_KEYS = [
    'AUTHZ_FGA_LOCAL_MOCK',
    'NODE_ENV',
    'AUTHZ_FGA_BASE_URL',
    'AUTHZ_FGA_STORE_ID',
    'AUTHZ_FGA_OAUTH_TOKEN_URL',
    'AUTHZ_FGA_CLIENT_ID',
    'AUTHZ_FGA_CLIENT_SECRET',
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) {
      delete process.env[k];
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
    vi.restoreAllMocks();
  });

  it('returns a mock config in local dev', () => {
    process.env.AUTHZ_FGA_LOCAL_MOCK = 'true';
    // NODE_ENV is deleted in beforeEach (not 'production'), so the mock is honored.
    expect(getAuthzFgaConfig()).toMatchObject({ storeId: 'local-mock' });
  });

  it('returns null when not configured and not mocked', () => {
    expect(getAuthzFgaConfig()).toBeNull();
  });

  it('returns real config when all env vars are present', () => {
    process.env.AUTHZ_FGA_BASE_URL = 'https://fga.example.com/';
    process.env.AUTHZ_FGA_STORE_ID = 'store-1';
    process.env.AUTHZ_FGA_OAUTH_TOKEN_URL = 'https://oauth.example.com/token';
    process.env.AUTHZ_FGA_CLIENT_ID = 'client';
    process.env.AUTHZ_FGA_CLIENT_SECRET = 'secret';
    expect(getAuthzFgaConfig()).toEqual({
      baseUrl: 'https://fga.example.com',
      storeId: 'store-1',
      oauthTokenUrl: 'https://oauth.example.com/token',
      clientId: 'client',
      clientSecret: 'secret',
      modelId: undefined,
    });
  });
});
