import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: vi.fn().mockImplementation(function () { return {
    send: vi.fn(),
  }; }),
  GetSecretValueCommand: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/jwt-config', () => ({
  getJWTConfig: () => ({
    awsRegion: 'us-west-2',
    secretName: 'test-secret',
  }),
  getJWTConstants: () => ({
    issuer: 'test-issuer',
    audience: 'test-audience',
    algorithm: 'RS256',
  }),
}));

import { JWTService } from '@/lib/jwt-service';

describe('JWTService cache key separation', function cacheKeySuite() {
  let service: JWTService;
  let createTokenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(function setup() {
    vi.clearAllMocks();
    service = new JWTService();

    createTokenSpy = vi.spyOn(service, 'createToken').mockResolvedValue({
      token: 'mock-token',
      expires: new Date(Date.now() + 3600000),
    });
  });

  const baseOptions = {
    siteId: 'site-1',
    canDownload: true,
    canPublish: true,
    isE2S: false,
  };

  it('produces different cache entries for different modelOverride values', async function separatesModelOverride() {
    await service.getToken({ ...baseOptions, modelOverride: 'claude-sonnet-4-5' });
    await service.getToken({ ...baseOptions, modelOverride: 'claude-sonnet-4-6' });

    expect(createTokenSpy).toHaveBeenCalledTimes(2);
  });

  it('reuses cached token when modelOverride is the same', async function reusesSameModelOverride() {
    await service.getToken({ ...baseOptions, modelOverride: 'claude-sonnet-4-5' });
    await service.getToken({ ...baseOptions, modelOverride: 'claude-sonnet-4-5' });

    expect(createTokenSpy).toHaveBeenCalledTimes(1);
  });

  it('produces different cache entries for different modelSelectorEnabled values', async function separatesModelSelector() {
    await service.getToken({ ...baseOptions, modelSelectorEnabled: true });
    await service.getToken({ ...baseOptions, modelSelectorEnabled: false });

    expect(createTokenSpy).toHaveBeenCalledTimes(2);
  });

  it('treats undefined modelOverride as empty string in cache key', async function undefinedVsEmpty() {
    await service.getToken({ ...baseOptions });
    await service.getToken({ ...baseOptions, modelOverride: undefined });

    expect(createTokenSpy).toHaveBeenCalledTimes(1);
  });

  it('produces different cache entries for different useAtlasCrawler values', async function separatesUseAtlasCrawler() {
    await service.getToken({ ...baseOptions, useAtlasCrawler: true });
    await service.getToken({ ...baseOptions, useAtlasCrawler: false });

    expect(createTokenSpy).toHaveBeenCalledTimes(2);
  });
});
