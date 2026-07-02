import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomainFromHeaders: vi.fn(),
}));

import { logger } from '@/lib/request-context';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';
import { clearWorkersServiceCache, resolveCareAgentWorkerId } from '../client';

const mockGetRootDomain = vi.mocked(getRootDomainFromHeaders);
const mockLogger = vi.mocked(logger);

const ACCOUNT_NAME = 'fgoodwrk';
const HEADERS = new Headers({ host: 'builder.test-godaddy.com' });

function mockFetchResolve(ok: boolean, status: number, json: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: vi.fn().mockResolvedValue(json),
    }),
  );
}

/** Assert the raw username never appears in any logged field (PII guard). */
function assertNoRawUsernameLogged(): void {
  const allCalls: unknown[][] = [
    ...mockLogger.info.mock.calls,
    ...mockLogger.warn.mock.calls,
    ...mockLogger.error.mock.calls,
  ];
  expect(JSON.stringify(allCalls)).not.toContain(ACCOUNT_NAME);
}

describe('resolveCareAgentWorkerId', () => {
  beforeEach(() => {
    clearWorkersServiceCache();
    vi.clearAllMocks();
    mockGetRootDomain.mockReturnValue('test-godaddy.com');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the worker GUID on success and never logs the raw username', async () => {
    mockFetchResolve(true, 200, [{ id: 'worker-guid-123', isActive: true }]);

    const result = await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toBe('worker-guid-123');
    expect(mockLogger.debug).toHaveBeenCalledWith('workers-service.search.resolved', { workerId: 'worker-guid-123' });
    assertNoRawUsernameLogged();
  });

  it('POSTs to the environment-derived URL with the sso-jwt scheme and no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue([{ id: 'worker-guid-123' }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.int.test-godaddy.com/v2/human-resources/search-workers');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('sso-jwt jwt-token');
  });

  it('returns undefined when the worker list is empty', async () => {
    mockFetchResolve(true, 200, []);

    const result = await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toBeUndefined();
    expect(mockLogger.info).toHaveBeenCalledWith('workers-service.search.not-found', {});
    assertNoRawUsernameLogged();
  });

  it('returns undefined on a non-200 response', async () => {
    mockFetchResolve(false, 503, {});

    const result = await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'workers-service.search.failed',
      expect.objectContaining({ status: 503 }),
    );
    assertNoRawUsernameLogged();
  });

  it('returns undefined when the request throws (timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('The operation was aborted')));

    const result = await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toBeUndefined();
    assertNoRawUsernameLogged();
  });

  it('returns undefined without fetching when the root domain cannot be derived', async () => {
    mockGetRootDomain.mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a cached GUID without a second fetch for the same accountName', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue([{ id: 'worker-guid-123' }]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });
    const second = await resolveCareAgentWorkerId({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(first).toBe('worker-guid-123');
    expect(second).toBe('worker-guid-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
