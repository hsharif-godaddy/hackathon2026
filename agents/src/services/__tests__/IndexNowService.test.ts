import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildIndexNowUrlList,
  getOrCreateIndexNowKey,
  isIndexNowEligibleHost,
  pingIndexNow,
} from '../IndexNowService.js';

// ---------------------------------------------------------------------------
// isIndexNowEligibleHost
// ---------------------------------------------------------------------------

describe('isIndexNowEligibleHost', () => {
  it('rejects empty string', () => {
    expect(isIndexNowEligibleHost('')).toBe(false);
  });

  it('rejects localhost', () => {
    expect(isIndexNowEligibleHost('localhost')).toBe(false);
  });

  it('rejects 127.0.0.1', () => {
    expect(isIndexNowEligibleHost('127.0.0.1')).toBe(false);
  });

  it.each([
    'myapp.airoapp.ai',
    'myapp.test-airoapp.ai',
    'myapp.dev-airoapp.ai',
    'local.gasket.dev-godaddy.com',
  ])('rejects system host %s', (host) => {
    expect(isIndexNowEligibleHost(host)).toBe(false);
  });

  it('accepts a custom domain', () => {
    expect(isIndexNowEligibleHost('mybusiness.com')).toBe(true);
  });

  it('accepts a custom domain with port (local dev publish URL)', () => {
    expect(isIndexNowEligibleHost('local.gasket.dev-godaddy.com:5505')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isIndexNowEligibleHost('MyApp.AiroApp.AI')).toBe(false);
    expect(isIndexNowEligibleHost('MyBusiness.COM')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildIndexNowUrlList
// ---------------------------------------------------------------------------

vi.mock('../seo-audit.js', () => ({
  discoverSeoRoutes: vi.fn(() => ['/', '/about', '/contact']),
}));

describe('buildIndexNowUrlList', () => {
  it('prefixes each route with https://host', async () => {
    const { discoverSeoRoutes } = await import('../seo-audit.js');
    vi.mocked(discoverSeoRoutes).mockReturnValue(['/', '/about']);
    const urls = buildIndexNowUrlList('/app/path', 'example.com');
    expect(urls).toEqual(['https://example.com/', 'https://example.com/about']);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateIndexNowKey
// ---------------------------------------------------------------------------

describe('getOrCreateIndexNowKey', () => {
  const mockRepo = {
    findById: vi.fn(),
    setIndexNowKey: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing key without writing', () => {
    mockRepo.findById.mockReturnValue({ indexnowKey: 'existingkey123' });
    const key = getOrCreateIndexNowKey('app1', mockRepo as any);
    expect(key).toBe('existingkey123');
    expect(mockRepo.setIndexNowKey).not.toHaveBeenCalled();
  });

  it('generates and stores a new 32-char hex key when none exists', () => {
    mockRepo.findById.mockReturnValue({ indexnowKey: undefined });
    const key = getOrCreateIndexNowKey('app1', mockRepo as any);
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(mockRepo.setIndexNowKey).toHaveBeenCalledWith('app1', key);
  });

  it('generates and stores a new key when app record is null', () => {
    mockRepo.findById.mockReturnValue(null);
    const key = getOrCreateIndexNowKey('app1', mockRepo as any);
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(mockRepo.setIndexNowKey).toHaveBeenCalledWith('app1', key);
  });
});

// ---------------------------------------------------------------------------
// pingIndexNow
// ---------------------------------------------------------------------------

describe('pingIndexNow', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips and logs info when urlList is empty', async () => {
    await pingIndexNow('ping-empty', 'empty.com', 'key123', [], logger);
    expect(logger.info).toHaveBeenCalledWith('indexnow.ping.skipped', expect.objectContaining({ reason: 'empty url list' }));
  });

  it('logs info on 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 }));
    await pingIndexNow('ping-2xx', '2xx.com', 'key123', ['https://2xx.com/'], logger);
    expect(logger.info).toHaveBeenCalledWith('indexnow.ping.result', expect.objectContaining({ status: 202 }));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs warn on non-2xx response (403 invalid key)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await pingIndexNow('ping-403', '403.com', 'key123', ['https://403.com/'], logger);
    expect(logger.warn).toHaveBeenCalledWith('indexnow.ping.rejected', expect.objectContaining({ status: 403 }));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs warn on non-2xx response (429 rate-limited)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await pingIndexNow('ping-429', '429.com', 'key123', ['https://429.com/'], logger);
    expect(logger.warn).toHaveBeenCalledWith('indexnow.ping.rejected', expect.objectContaining({ status: 429 }));
  });

  it('throws on network error so callers can catch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network failure')));
    await expect(
      pingIndexNow('ping-err', 'err.com', 'key123', ['https://err.com/']),
    ).rejects.toThrow('network failure');
  });

  it('skips and logs throttled when called again within 5 minutes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);
    await pingIndexNow('ping-throttle', 'throttle.com', 'key123', ['https://throttle.com/'], logger);
    vi.clearAllMocks();
    await pingIndexNow('ping-throttle', 'throttle.com', 'key123', ['https://throttle.com/'], logger);
    expect(logger.info).toHaveBeenCalledWith('indexnow.ping.skipped', expect.objectContaining({ reason: 'throttled' }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows ping for different host on same app within 5 minutes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 202 }));
    await pingIndexNow('ping-multi', 'domain-a.com', 'key123', ['https://domain-a.com/'], logger);
    vi.clearAllMocks();
    await pingIndexNow('ping-multi', 'domain-b.com', 'key123', ['https://domain-b.com/'], logger);
    expect(logger.info).toHaveBeenCalledWith('indexnow.ping.result', expect.objectContaining({ status: 202 }));
  });
});
