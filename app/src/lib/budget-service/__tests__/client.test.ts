import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BudgetNotFoundError,
  BudgetServiceAuthError,
  BudgetServiceError,
  BudgetServiceTimeoutError,
  BudgetServiceUnavailableError,
} from '@airo/shared/budget';

import {
  BudgetServiceBffClient,
  type BudgetServiceBffClientConfig,
  getBudgetServiceClient,
  getBudgetServiceUrl,
} from '../client';

vi.mock('@/lib/iam-token', () => ({
  getIamToken: vi.fn().mockResolvedValue('default-iam-token'),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/utils/getRootDomain', () => ({
  getRootDomainFromHeaders: vi.fn(),
}));

import { getRootDomainFromHeaders } from '@/utils/getRootDomain';
const mockGetRootDomain = vi.mocked(getRootDomainFromHeaders);

const TEST_CONFIG: BudgetServiceBffClientConfig = {
  baseUrl: 'https://budget.example.com',
  getToken: async () => 'test-s2s-token',
};

const VALID_BUDGET_RESPONSE = JSON.stringify({
  budgetId: 'b-1',
  productKey: 'airo-builder',
  creditsTotal: '150.000000',
  creditsUsed: '50.000000',
  creditsPending: '0.000000',
  items: [
    {
      budgetItemId: 'bi-1',
      creditsTotal: '150.000000',
      creditsUsed: '50.000000',
      costToCreditRatio: '0.100000',
      startsAt: null,
      expiresAt: null,
      resetInterval: null,
    },
  ],
});

function mockFetch(ok: boolean, status: number, text: string) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    text: vi.fn().mockResolvedValue(text),
  }) as unknown as typeof globalThis.fetch;
}

function clientWith(fetchImpl: typeof globalThis.fetch) {
  return new BudgetServiceBffClient({ ...TEST_CONFIG, fetch: fetchImpl });
}

describe('BudgetServiceBffClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BUDGET_SERVICE_URL;
  });

  // ── Construction ──

  describe('constructor', () => {
    it('rejects non-HTTPS URLs', () => {
      expect(
        () => new BudgetServiceBffClient({ ...TEST_CONFIG, baseUrl: 'http://budget.example.com' })
      ).toThrow('BUDGET_SERVICE_URL must use HTTPS');
    });

    it('allows http://localhost for local dev', () => {
      expect(
        () => new BudgetServiceBffClient({ ...TEST_CONFIG, baseUrl: 'http://localhost:4200' })
      ).not.toThrow();
    });

    it('rejects http://localhost.evil.com', () => {
      expect(
        () => new BudgetServiceBffClient({ ...TEST_CONFIG, baseUrl: 'http://localhost.evil.com' })
      ).toThrow('BUDGET_SERVICE_URL must use HTTPS');
    });

    it('rejects invalid URLs', () => {
      expect(
        () => new BudgetServiceBffClient({ ...TEST_CONFIG, baseUrl: 'not-a-url' })
      ).toThrow('BUDGET_SERVICE_URL must be a valid URL');
    });

    it('strips trailing slashes', async () => {
      const fetch = mockFetch(true, 200, VALID_BUDGET_RESPONSE);
      const client = new BudgetServiceBffClient({
        ...TEST_CONFIG,
        baseUrl: 'https://budget.example.com/',
        fetch,
      });
      await client.getBudget('b-1');
      expect(fetch).toHaveBeenCalledWith(
        'https://budget.example.com/api/v1/budgets/b-1',
        expect.any(Object)
      );
    });
  });

  // ── Auth header ──

  describe('auth', () => {
    it('sends Authorization: Bearer header (not sso-jwt)', async () => {
      const fetch = mockFetch(true, 200, VALID_BUDGET_RESPONSE);
      const client = new BudgetServiceBffClient({
        ...TEST_CONFIG,
        getToken: async () => 'my-iam-token',
        fetch,
      });
      await client.getBudget('b-1');
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-iam-token',
          }),
        })
      );
    });
  });

  // ── getBudget ──

  describe('getBudget', () => {
    it('returns parsed BudgetResponse on success', async () => {
      const client = clientWith(mockFetch(true, 200, VALID_BUDGET_RESPONSE));
      const result = await client.getBudget('b-1');
      expect(result.budgetId).toBe('b-1');
      expect(result.creditsTotal).toBe('150.000000');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].budgetItemId).toBe('bi-1');
    });

    it('encodes budgetId in URL', async () => {
      const fetch = mockFetch(true, 200, VALID_BUDGET_RESPONSE);
      const client = new BudgetServiceBffClient({ ...TEST_CONFIG, fetch });
      await client.getBudget('id/with/slashes');
      expect(fetch).toHaveBeenCalledWith(
        'https://budget.example.com/api/v1/budgets/id%2Fwith%2Fslashes',
        expect.any(Object)
      );
    });

    it('tolerates extra fields from BMS (passthrough)', async () => {
      const response = JSON.stringify({
        ...JSON.parse(VALID_BUDGET_RESPONSE),
        newField: 'unexpected',
      });
      const client = clientWith(mockFetch(true, 200, response));
      const result = await client.getBudget('b-1');
      expect(result.budgetId).toBe('b-1');
    });
  });

  // ── Validation errors ──

  describe('validation', () => {
    it('throws BudgetServiceError on missing required fields', async () => {
      const badResponse = JSON.stringify({ budgetId: 'b-1' });
      const client = clientWith(mockFetch(true, 200, badResponse));
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceError);
    });

    it('throws on empty response body', async () => {
      const client = clientWith(mockFetch(true, 200, ''));
      await expect(client.getBudget('b-1')).rejects.toThrow('empty response');
    });

    it('throws on invalid JSON', async () => {
      const client = clientWith(mockFetch(true, 200, 'not json'));
      await expect(client.getBudget('b-1')).rejects.toThrow('invalid JSON');
    });
  });

  // ── HTTP errors ──

  describe('HTTP errors', () => {
    it('throws BudgetServiceAuthError on 401', async () => {
      const client = clientWith(mockFetch(false, 401, 'Unauthorized'));
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceAuthError);
    });

    it('throws BudgetServiceAuthError on 403', async () => {
      const client = clientWith(mockFetch(false, 403, 'Forbidden'));
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceAuthError);
    });

    it('throws BudgetNotFoundError on 404', async () => {
      const client = clientWith(mockFetch(false, 404, 'Not Found'));
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetNotFoundError);
      await expect(client.getBudget('b-1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('throws BudgetServiceError on 500', async () => {
      const client = clientWith(mockFetch(false, 500, 'Internal Error'));
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceError);
      await expect(client.getBudget('b-1')).rejects.toMatchObject({ statusCode: 500 });
    });
  });

  // ── Network errors ──

  describe('network errors', () => {
    it('throws BudgetServiceTimeoutError on fetch abort', async () => {
      const fetch = vi.fn().mockRejectedValue(
        Object.assign(new DOMException('signal timed out', 'TimeoutError'))
      ) as unknown as typeof globalThis.fetch;
      const client = new BudgetServiceBffClient({ ...TEST_CONFIG, fetch });
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceTimeoutError);
    });

    it('throws BudgetServiceUnavailableError on network failure', async () => {
      const fetch = vi.fn().mockRejectedValue(
        new TypeError('fetch failed')
      ) as unknown as typeof globalThis.fetch;
      const client = new BudgetServiceBffClient({ ...TEST_CONFIG, fetch });
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceUnavailableError);
    });

    it('throws BudgetServiceTimeoutError on token retrieval timeout', async () => {
      const fetchSpy = mockFetch(true, 200, VALID_BUDGET_RESPONSE);
      const client = new BudgetServiceBffClient({
        ...TEST_CONFIG,
        getToken: () => new Promise(() => {}), // never resolves
        tokenTimeoutMs: 10,
        fetch: fetchSpy,
      });
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceTimeoutError);
      await expect(client.getBudget('b-1')).rejects.toThrow('token retrieval timed out');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('wraps token retrieval errors as BudgetServiceUnavailableError', async () => {
      const fetchSpy = mockFetch(true, 200, VALID_BUDGET_RESPONSE);
      const client = new BudgetServiceBffClient({
        ...TEST_CONFIG,
        getToken: () => Promise.reject(new Error('IAM down')),
        fetch: fetchSpy,
      });
      await expect(client.getBudget('b-1')).rejects.toThrow(BudgetServiceUnavailableError);
      await expect(client.getBudget('b-1')).rejects.toThrow('token retrieval failed');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── URL Builder ──

  describe('getBudgetServiceUrl', () => {
    const mockHeaders = new Headers({ host: 'airo-builder.test-godaddy.com' });

    beforeEach(() => {
      mockGetRootDomain.mockReset();
    });

    it('builds URL from root domain', () => {
      mockGetRootDomain.mockReturnValue('test-godaddy.com');

      const url = getBudgetServiceUrl(mockHeaders);

      expect(url).toBe('https://budget-service.api.int.test-godaddy.com');
    });

    it('returns null when root domain cannot be determined', () => {
      mockGetRootDomain.mockReturnValue(null);

      const url = getBudgetServiceUrl(mockHeaders);

      expect(url).toBeNull();
    });

    it('handles production domain', () => {
      mockGetRootDomain.mockReturnValue('godaddy.com');

      const url = getBudgetServiceUrl(mockHeaders);

      expect(url).toBe('https://budget-service.api.int.godaddy.com');
    });
  });

  // ── Factory ──

  describe('getBudgetServiceClient', () => {
    const mockHeaders = new Headers({ host: 'airo-builder.test-godaddy.com' });

    beforeEach(() => {
      mockGetRootDomain.mockReset();
    });

    it('returns null when URL cannot be determined', () => {
      mockGetRootDomain.mockReturnValue(null);

      const client = getBudgetServiceClient(mockHeaders);

      expect(client).toBeNull();
    });

    it('returns client when URL can be determined', () => {
      mockGetRootDomain.mockReturnValue('test-godaddy.com');

      const client = getBudgetServiceClient(mockHeaders);

      expect(client).toBeInstanceOf(BudgetServiceBffClient);
    });

    it('creates new client for each call (not singleton)', () => {
      mockGetRootDomain.mockReturnValue('test-godaddy.com');

      const a = getBudgetServiceClient(mockHeaders);
      const b = getBudgetServiceClient(mockHeaders);

      expect(a).not.toBe(b);
      expect(a).toBeInstanceOf(BudgetServiceBffClient);
      expect(b).toBeInstanceOf(BudgetServiceBffClient);
    });
  });
});
