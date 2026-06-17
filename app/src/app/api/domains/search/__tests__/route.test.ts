/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCheckSwitchboardFlag, customerCounter } = vi.hoisted(() => ({
  mockCheckSwitchboardFlag: vi.fn(),
  // Each test uses a unique customerId so the route's per-customer
  // in-memory rate limiter (30 req/min) does not fail later tests.
  customerCounter: { value: 0 },
}));

import { POST } from '../route';

const mockFindExact = vi.fn();
const mockFindSpins = vi.fn();

vi.mock('@site/domain-services', () => ({
  DomainServices: vi.fn(function () { return {
    findExact: mockFindExact,
    findSpins: mockFindSpins,
  }; }),
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return (request: NextRequest) => handler(request, {
      user: { customerId: `test-customer-${++customerCounter.value}` },
      isAuthenticated: true,
    });
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/translations', () => ({
  detectTranslationLocale: vi.fn(function () { return 'en-US'; }),
}));

vi.mock('@/lib/switchboard/server', () => ({
  checkSwitchboardFlag: mockCheckSwitchboardFlag,
}));

function createRequest(
  body: Record<string, unknown>,
  init?: { cookie?: string }
): NextRequest {
  return new NextRequest('http://test/api/domains/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.cookie ? { Cookie: init.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/domains/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_FIND_API_KEY = 'test-api-key-name';
    // Default the offers flag ON so existing non-ISC tests don't have to care.
    mockCheckSwitchboardFlag.mockResolvedValue(true);
  });

  describe('input validation', () => {
    it('should reject missing query', async () => {
      const response = await POST(createRequest({}));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Query parameter is required');
    });

    it('should reject non-string query', async () => {
      const response = await POST(createRequest({ query: 123 }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Query parameter is required');
    });

    it('should reject empty query after sanitization', async () => {
      const response = await POST(createRequest({ query: '!!!' }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid query');
    });

    it('should sanitize special characters from query', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      await POST(createRequest({ query: 'my<script>brand.com' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'myscriptbrand.com' })
      );
    });

    it('should collapse consecutive dots in query', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      await POST(createRequest({ query: 'my..brand.com' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'my.brand.com' })
      );
    });

    it('should trim leading and trailing dots', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      await POST(createRequest({ query: '.mybrand.com.' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'mybrand.com' })
      );
    });

    it('should clamp maxResults to upper bound of 25', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      await POST(createRequest({ query: 'mybrand', maxResults: 1000 }));

      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ extraParams: { pagesize: 25 } })
      );
    });

    it('should clamp maxResults to lower bound of 1', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      await POST(createRequest({ query: 'mybrand', maxResults: -5 }));

      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ extraParams: { pagesize: 1 } })
      );
    });

    it('should floor fractional maxResults', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      await POST(createRequest({ query: 'mybrand', maxResults: 7.9 }));

      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ extraParams: { pagesize: 7 } })
      );
    });

    it('should default maxResults to 10 for non-numeric values', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      await POST(createRequest({ query: 'mybrand', maxResults: 'all' }));

      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ extraParams: { pagesize: 10 } })
      );
    });
  });

  describe('successful search', () => {
    it('should return exact match domain', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          NameWithoutExtension: 'mybrand',
          Tld: 'com',
          AvailabilityStatus: 1000,
          ProductId: 42,
        },
        Products: [{
          ProductId: 42,
          PriceInfo: {
            ListPrice: 12.99,
            ListPriceDisplay: '$12.99',
            CurrentPrice: 9.99,
            CurrentPriceDisplay: '$9.99',
            RenewalPrice: 14.99,
            RenewalPriceDisplay: '$14.99',
          },
        }],
      });
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains).toHaveLength(1);
      expect(data.domains[0].fqdn).toBe('mybrand.com');
      expect(data.domains[0].isExactMatch).toBe(true);
      expect(data.products).toHaveLength(1);
      expect(data.products[0].priceInfo.currentPrice).toBe(9.99);
      expect(data.meta).toEqual({
        seedsUsed: 'fallback',
        seedsCount: 0,
        spinsFulfilled: 1,
        spinsRejected: 0,
        spinsResultCount: 0,
        exactMatchCount: 1,
        totalBeforeCap: 1,
      });
    });

    it('should return spins domains', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [
          { Fqdn: 'mybrand.net', NameWithoutExtension: 'mybrand', Extension: 'net', ProductId: 43 },
          { Fqdn: 'mybrand.org', NameWithoutExtension: 'mybrand', Extension: 'org', ProductId: 44 },
        ],
        Products: [],
      });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains).toHaveLength(2);
      expect(data.domains[0].fqdn).toBe('mybrand.net');
      expect(data.domains[1].fqdn).toBe('mybrand.org');
      expect(data.meta.spinsResultCount).toBe(2);
      expect(data.meta.exactMatchCount).toBe(0);
      expect(data.meta.seedsUsed).toBe('fallback');
    });

    it('should forward priceDisplay from exact match domain', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          NameWithoutExtension: 'mybrand',
          Tld: 'com',
          AvailabilityStatus: 1000,
          ProductId: 42,
          PriceDisplay: '$9.99/yr',
        },
        Products: [],
      });
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains[0].priceDisplay).toBe('$9.99/yr');
    });

    it('should forward priceDisplay from spin domains', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [
          { Fqdn: 'mybrand.net', NameWithoutExtension: 'mybrand', Extension: 'net', ProductId: 43, PriceDisplay: '$4.99/yr' },
          { Fqdn: 'mybrand.org', NameWithoutExtension: 'mybrand', Extension: 'org', ProductId: 44, PriceDisplay: '$11.99/yr' },
        ],
        Products: [],
      });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains[0].priceDisplay).toBe('$4.99/yr');
      expect(data.domains[1].priceDisplay).toBe('$11.99/yr');
    });

    it('should set priceDisplay to undefined when API omits PriceDisplay', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          AvailabilityStatus: 1000,
          ProductId: 42,
        },
        Products: [],
      });
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [
          { Fqdn: 'mybrand.net', ProductId: 43 },
        ],
        Products: [],
      });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(data.domains[0].priceDisplay).toBeUndefined();
      expect(data.domains[1].priceDisplay).toBeUndefined();
    });

    it('should not include duplicate domains', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          AvailabilityStatus: 1000,
          ProductId: 42,
        },
        Products: [],
      });
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [
          { Fqdn: 'mybrand.com', ProductId: 42 },
          { Fqdn: 'mybrand.net', ProductId: 43 },
        ],
        Products: [],
      });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(data.domains).toHaveLength(2);
      expect(data.domains.map((d: any) => d.fqdn)).toEqual(['mybrand.com', 'mybrand.net']);
    });

    it('should not return query in response body', async () => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(data.query).toBeUndefined();
    });
  });

  describe('exact match availability status filtering', () => {
    it('should include exact match with AvailabilityStatus 1000', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          NameWithoutExtension: 'mybrand',
          Tld: 'com',
          AvailabilityStatus: 1000,
          ProductId: 42,
        },
        Products: [],
      });
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains).toHaveLength(1);
      expect(data.domains[0].fqdn).toBe('mybrand.com');
      expect(data.domains[0].isExactMatch).toBe(true);
    });

    it('should exclude exact match with AvailabilityStatus 1001', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          NameWithoutExtension: 'mybrand',
          Tld: 'com',
          AvailabilityStatus: 1001,
          ProductId: 42,
        },
        Products: [],
      });
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains).toHaveLength(0);
    });

    it('should exclude exact match with other non-1000 status codes', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          NameWithoutExtension: 'mybrand',
          Tld: 'com',
          AvailabilityStatus: 2000,
          ProductId: 42,
        },
        Products: [],
      });
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains).toHaveLength(0);
    });

    it('should still return spins when exact match has status 1001', async () => {
      mockFindExact.mockResolvedValue({
        ExactMatchDomain: {
          Fqdn: 'mybrand.com',
          NameWithoutExtension: 'mybrand',
          Tld: 'com',
          AvailabilityStatus: 1001,
          ProductId: 42,
        },
        Products: [],
      });
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [
          { Fqdn: 'mybrand.net', NameWithoutExtension: 'mybrand', Extension: 'net', ProductId: 43 },
        ],
        Products: [],
      });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.domains).toHaveLength(1);
      expect(data.domains[0].fqdn).toBe('mybrand.net');
      expect(data.domains[0].isExactMatch).toBe(false);
    });
  });

  describe('long query ordering', () => {
    const exactDomain = {
      Fqdn: 'sandbaggersteakhouse.com',
      NameWithoutExtension: 'sandbaggersteakhouse',
      Tld: 'com',
      AvailabilityStatus: 1000,
      ProductId: 1,
    };
    const spinDomain = { Fqdn: 'sandbagger.com', NameWithoutExtension: 'sandbagger', Extension: 'com', ProductId: 2 };

    beforeEach(() => {
      mockFindExact.mockResolvedValue({ ExactMatchDomain: exactDomain, Products: [] });
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [spinDomain], Products: [] });
    });

    it('places exact match first for short queries (≤20 chars)', async () => {
      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();
      expect(data.domains[0].fqdn).toBe('sandbaggersteakhouse.com');
    });

    it('places spins before exact match for long queries (>20 chars)', async () => {
      const response = await POST(createRequest({ query: 'sandbagger steakhouse lounge' }));
      const data = await response.json();
      expect(data.domains[0].fqdn).toBe('sandbagger.com');
      const exactIndex = data.domains.findIndex((d: any) => d.fqdn === 'sandbaggersteakhouse.com');
      expect(exactIndex).toBeGreaterThan(0);
    });

    it('reserves the last cap slot for exact match when spins fill maxResults on a long query', async () => {
      // 3 spins + maxResults=3 → without fix, exact match is silently dropped
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [
          { Fqdn: 'sandbagger.net', Extension: 'net', ProductId: 2 },
          { Fqdn: 'sandbagger.io', Extension: 'io', ProductId: 3 },
          { Fqdn: 'sandbagger.co', Extension: 'co', ProductId: 4 },
        ],
        Products: [],
      });
      const response = await POST(createRequest({ query: 'sandbagger steakhouse lounge', maxResults: 3 }));
      const data = await response.json();
      const fqdns: string[] = data.domains.map((d: any) => d.fqdn);
      expect(fqdns).toContain('sandbaggersteakhouse.com');
      expect(data.domains).toHaveLength(3);
    });

    it('deduplicates when spin fqdn matches exact match fqdn in long query', async () => {
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [{ ...exactDomain, AvailabilityStatus: undefined, AvailabilityCode: 1000, Extension: 'com' }],
        Products: [],
      });
      const response = await POST(createRequest({ query: 'sandbagger steakhouse lounge' }));
      const data = await response.json();
      const fqdns: string[] = data.domains.map((d: any) => d.fqdn);
      expect(fqdns.filter((f: string) => f === 'sandbaggersteakhouse.com')).toHaveLength(1);
    });
  });

  describe('error handling', () => {
    it('should return 502 when both searches fail', async () => {
      mockFindExact.mockRejectedValue(new Error('Exact failed'));
      mockFindSpins.mockRejectedValue(new Error('Spins failed'));

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(502);
      expect(data.error).toBe('Failed to search domains');
    });

    it('should succeed when only exact search fails', async () => {
      mockFindExact.mockRejectedValue(new Error('Exact failed'));
      mockFindSpins.mockResolvedValue({
        RecommendedDomains: [{ Fqdn: 'mybrand.com', ProductId: 42 }],
        Products: [],
      });

      const response = await POST(createRequest({ query: 'mybrand' }));
      expect(response.status).toBe(200);
    });

    it('should return 500 for unexpected errors', async () => {
      mockFindExact.mockImplementation(function () { throw new Error('Unexpected boom'); });

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });

  describe('authentication', () => {
    it('should throw when DOMAIN_FIND_API_KEY is not configured', async () => {
      delete process.env.DOMAIN_FIND_API_KEY;

      const response = await POST(createRequest({ query: 'mybrand' }));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Internal server error');
    });
  });

  describe('entourage cookie forwarding', () => {
    beforeEach(() => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });
    });

    it('forwards allowlisted cookies to findExact and findSpins', async () => {
      await POST(createRequest(
        { query: 'mybrand' },
        {
          cookie: [
            'unrelated=drop',
            'market=en-US',
            'currency=USD',
            'visitor=vid123',
            'auth_idp=secret',
            'info_idp=info',
            'info_cust_idp=cust',
            'isc=GDWELCOME',
            'actpro=ENCRYPTED_BLOB',
            'mbr=1',
            'xpnes=exp',
          ].join('; '),
        }
      ));

      const upstreamOptions = {
        options: {
          headers: {
            Cookie: [
              'market=en-US',
              'currency=USD',
              'visitor=vid123',
              'auth_idp=secret',
              'info_idp=info',
              'info_cust_idp=cust',
              'isc=GDWELCOME',
              'actpro=ENCRYPTED_BLOB',
              'mbr=1',
              'xpnes=exp',
            ].join('; '),
          },
        },
      };
      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining(upstreamOptions)
      );
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining(upstreamOptions)
      );
    });

    it('omits options when no allowlisted cookies are present', async () => {
      await POST(createRequest(
        { query: 'mybrand' },
        { cookie: 'unrelated=drop; pathway=abc' }
      ));

      const exactArgs = mockFindExact.mock.calls[0][0];
      expect(exactArgs.options).toBeUndefined();
      const spinsArgs = mockFindSpins.mock.calls[0][0];
      expect(spinsArgs.options).toBeUndefined();
    });

    it('omits options when no cookies are present', async () => {
      await POST(createRequest({ query: 'mybrand' }));

      const exactArgs = mockFindExact.mock.calls[0][0];
      expect(exactArgs.options).toBeUndefined();
      const spinsArgs = mockFindSpins.mock.calls[0][0];
      expect(spinsArgs.options).toBeUndefined();
    });

    it('preserves = characters inside cookie values (e.g. base64 actpro blobs)', async () => {
      await POST(createRequest(
        { query: 'mybrand' },
        { cookie: 'actpro=base64+encoded==; unrelated=drop' }
      ));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { headers: { Cookie: 'actpro=base64+encoded==' } },
        })
      );
    });
  });

  describe('ISC forwarding', () => {
    beforeEach(() => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });
    });

    it('forwards a valid ISC into both findExact and findSpins extraParams', async () => {
      await POST(createRequest({ query: 'mybrand', isc: 'GDWELCOME' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({
          extraParams: expect.objectContaining({ isc: 'GDWELCOME' }),
        })
      );
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({
          extraParams: expect.objectContaining({
            isc: 'GDWELCOME',
            pagesize: expect.anything(),
          }),
        })
      );
    });

    it('uppercases a lowercase ISC against the allowlist', async () => {
      await POST(createRequest({ query: 'mybrand', isc: 'gdwelcome' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({
          extraParams: expect.objectContaining({ isc: 'GDWELCOME' }),
        })
      );
    });

    it('does NOT forward an ISC that is not on the allowlist', async () => {
      await POST(createRequest({ query: 'mybrand', isc: 'NOTREAL' }));

      const exactArgs = mockFindExact.mock.calls[0][0];
      expect(exactArgs.extraParams?.isc).toBeUndefined();
      const spinsArgs = mockFindSpins.mock.calls[0][0];
      expect(spinsArgs.extraParams?.isc).toBeUndefined();
    });

    it('does NOT forward ISC when the offer Switchboard flag is disabled', async () => {
      mockCheckSwitchboardFlag.mockResolvedValueOnce(false);

      await POST(createRequest({ query: 'mybrand', isc: 'GDWELCOME' }));

      const exactArgs = mockFindExact.mock.calls[0][0];
      expect(exactArgs.extraParams?.isc).toBeUndefined();
      const spinsArgs = mockFindSpins.mock.calls[0][0];
      expect(spinsArgs.extraParams?.isc).toBeUndefined();
    });

    it('still preserves other findSpins extraParams (pagesize) when ISC is dropped', async () => {
      mockCheckSwitchboardFlag.mockResolvedValueOnce(false);

      await POST(createRequest({ query: 'mybrand', isc: 'GDWELCOME', maxResults: 8 }));

      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({
          extraParams: { pagesize: 8 },
        })
      );
    });
  });

  describe('multi-word brandable seed for findSpins', () => {
    beforeEach(() => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });
    });

    it('condenses a 3-word business name to first two words for spins, but keeps full sanitized query for findExact', async () => {
      await POST(createRequest({ query: 'Sandbagger Steakhouse Lounge', seedPrompt: 'Sandbagger Steakhouse Lounge' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'sandbaggersteakhouselounge' })
      );
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'sandbaggersteakhouse' })
      );
    });

    it('uses the full sanitized query for both APIs when input is a single word', async () => {
      await POST(createRequest({ query: 'restaurantwebsite', seedPrompt: 'restaurantwebsite' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'restaurantwebsite' })
      );
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'restaurantwebsite' })
      );
    });

    it('joins two-word names without spaces for spins', async () => {
      await POST(createRequest({ query: 'My Coffee', seedPrompt: 'My Coffee' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'mycoffee' })
      );
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'mycoffee' })
      );
    });

    it('takes only the first two words when input has many words (falls back when seed < 3 chars)', async () => {
      await POST(createRequest({ query: 'A B C D E', seedPrompt: 'A B C D E' }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'abcde' })
      );
      // "A" + "B" → "ab" → length 2 < MIN_SEED_LENGTH (3) → falls back to sanitizedQuery
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'abcde' })
      );
    });

    it('caps the spins seed at 24 characters', async () => {
      // Two long words: each 20 chars → 40 char seed → must be capped to 24
      const longWord = 'a'.repeat(20);
      const longerWord = 'b'.repeat(20);

      await POST(createRequest({ query: `${longWord} ${longerWord}`, seedPrompt: `${longWord} ${longerWord}` }));

      const spinsArgs = mockFindSpins.mock.calls[0][0];
      expect(spinsArgs.query.length).toBeLessThanOrEqual(24);
      expect(spinsArgs.query).toBe(('a'.repeat(20) + 'bbbb'));
    });

    it('strips non-alphanumeric characters from the spins seed', async () => {
      await POST(createRequest({ query: "Joe's Pizza Place", seedPrompt: "Joe's Pizza Place" }));

      // findExact gets sanitizedQuery — apostrophe stripped by the existing sanitizer.
      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'joespizzaplace' })
      );
      // findSpins seed: first two words "Joe's" + "Pizza" → joespizza
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'joespizza' })
      );
    });

    it('falls back to sanitizedQuery when the first two words sanitize to empty', async () => {
      // First two words ("!!!" "###") strip to empty, so spins seed should fall back.
      await POST(createRequest({ query: '!!! ### realbrand', seedPrompt: '!!! ### realbrand' }));

      const spinsArgs = mockFindSpins.mock.calls[0][0];
      // Whatever the sanitized query is, spins must match findExact (no separate seed).
      const exactArgs = mockFindExact.mock.calls[0][0];
      expect(spinsArgs.query).toBe(exactArgs.query);
      expect(spinsArgs.query.length).toBeGreaterThan(0);
    });

    it('handles extra whitespace between words', async () => {
      await POST(createRequest({ query: '  Sandbagger    Steakhouse   Lounge  ', seedPrompt: 'Sandbagger Steakhouse Lounge' }));

      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'sandbaggersteakhouse' })
      );
    });

    it('does NOT apply buildSpinsQuery when seedPrompt is absent (non-seed-aware caller)', async () => {
      await POST(createRequest({ query: 'Sandbagger Steakhouse Lounge' }));

      // Without seedPrompt, the route uses sanitizedQuery directly for findSpins
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'sandbaggersteakhouselounge' })
      );
    });
  });

  describe('seeded fan-out via body.seeds', () => {
    beforeEach(() => {
      mockFindExact.mockResolvedValue(null);
      mockFindSpins.mockResolvedValue({ RecommendedDomains: [], Products: [] });
    });

    it('fans out one findSpins call per seed when seeds[] is provided', async () => {
      await POST(createRequest({
        query: 'My coffee shop',
        seeds: ['coffeeplace', 'morningbean', 'sipandgo', 'roastedhq'],
        maxResults: 12,
      }));

      expect(mockFindSpins).toHaveBeenCalledTimes(4);
      const queries = mockFindSpins.mock.calls.map(c => c[0].query).sort();
      expect(queries).toEqual(['coffeeplace', 'morningbean', 'roastedhq', 'sipandgo']);
    });

    it('passes the full maxResults to each seed call', async () => {
      await POST(createRequest({
        query: 'My coffee shop',
        seeds: ['aaa', 'bbb', 'ccc', 'ddd'],
        maxResults: 12,
      }));

      for (const call of mockFindSpins.mock.calls) {
        expect(call[0].extraParams.pagesize).toBe(12);
      }
    });

    it('still passes the full maxResults even when maxResults < seeds count', async () => {
      await POST(createRequest({
        query: 'My coffee shop',
        seeds: ['aaa', 'bbb', 'ccc', 'ddd'],
        maxResults: 2,
      }));
      for (const call of mockFindSpins.mock.calls) {
        expect(call[0].extraParams.pagesize).toBe(2);
      }
    });

    it('findExact still receives the full sanitized query (not a seed)', async () => {
      await POST(createRequest({
        query: 'My coffee shop',
        seeds: ['coffeeplace', 'morningbean'],
      }));

      expect(mockFindExact).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'mycoffeeshop' })
      );
    });

    it('drops malformed seeds (non-string, too long, non-alphanumeric, too short)', async () => {
      await POST(createRequest({
        query: 'My coffee shop',
        seeds: [
          'goodseed',
          123 as never,
          'a'.repeat(50),
          '!!!',
          'ab', // < 3 chars after sanitize
        ],
      }));

      const queries = mockFindSpins.mock.calls.map(c => c[0].query);
      expect(queries).toContain('goodseed');
      expect(queries).toContain('a'.repeat(24));
      expect(queries).not.toContain('!!!');
      expect(queries).not.toContain(123);
      expect(queries).not.toContain('ab');
    });

    it('caps seeds at first 4 when more than 4 provided', async () => {
      await POST(createRequest({
        query: 'My coffee shop',
        seeds: ['seed1', 'seed2', 'seed3', 'seed4', 'seed5', 'seed6'],
      }));

      expect(mockFindSpins).toHaveBeenCalledTimes(4);
    });

    it('falls back to buildSpinsQuery path when seeds is empty', async () => {
      await POST(createRequest({
        query: 'Sandbagger Steakhouse Lounge',
        seedPrompt: 'Sandbagger Steakhouse Lounge',
        seeds: [],
      }));

      expect(mockFindSpins).toHaveBeenCalledTimes(1);
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'sandbaggersteakhouse' })
      );
    });

    it('falls back to buildSpinsQuery path when all seeds are malformed or too short', async () => {
      await POST(createRequest({
        query: 'Sandbagger Steakhouse Lounge',
        seedPrompt: 'Sandbagger Steakhouse Lounge',
        seeds: ['!!!', 123 as never, '@@', 'ab'],
      }));

      expect(mockFindSpins).toHaveBeenCalledTimes(1);
      expect(mockFindSpins).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'sandbaggersteakhouse' })
      );
    });

    it('falls back to buildSpinsQuery path when seeds is not an array', async () => {
      await POST(createRequest({
        query: 'Sandbagger Steakhouse Lounge',
        seedPrompt: 'Sandbagger Steakhouse Lounge',
        seeds: 'not-an-array' as never,
      }));

      expect(mockFindSpins).toHaveBeenCalledTimes(1);
    });

    it('aggregates and dedupes domains from multiple findSpins responses', async () => {
      let callIndex = 0;
      mockFindSpins.mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) return { RecommendedDomains: [{ Fqdn: 'foo.com', ProductId: 1 }], Products: [] };
        if (callIndex === 2) return { RecommendedDomains: [{ Fqdn: 'foo.com', ProductId: 1 }, { Fqdn: 'bar.com', ProductId: 2 }], Products: [] };
        return { RecommendedDomains: [{ Fqdn: 'baz.com', ProductId: 3 }], Products: [] };
      });

      const response = await POST(createRequest({
        query: 'My coffee shop',
        seeds: ['seed1', 'seed2', 'seed3'],
      }));
      const data = await response.json();

      expect(data.domains.map((d: any) => d.fqdn).sort()).toEqual(['bar.com', 'baz.com', 'foo.com']);
      expect(data.meta.seedsUsed).toBe('llm');
      expect(data.meta.seedsCount).toBe(3);
      expect(data.meta.spinsFulfilled).toBe(3);
      expect(data.meta.spinsResultCount).toBe(3);
    });

    it('interleaves seed results so a tight maxResults cap includes domains from every seed', async () => {
      // Each seed returns 3 results. With maxResults=3 and flat-concat, seed1 fills
      // all 3 slots and seed2/seed3 contribute nothing. Interleaving fixes this.
      mockFindSpins.mockImplementation(async ({ query }: { query: string }) => ({
        RecommendedDomains: [
          { Fqdn: `${query}-a.com`, ProductId: 1 },
          { Fqdn: `${query}-b.com`, ProductId: 1 },
          { Fqdn: `${query}-c.com`, ProductId: 1 },
        ],
        Products: [],
      }));

      const response = await POST(createRequest({
        query: 'My coffee shop',
        seeds: ['seed1', 'seed2', 'seed3'],
        maxResults: 3,
      }));
      const data = await response.json();
      const fqdns: string[] = data.domains.map((d: any) => d.fqdn);

      expect(fqdns).toContain('seed1-a.com');
      expect(fqdns).toContain('seed2-a.com');
      expect(fqdns).toContain('seed3-a.com');
    });
  });
});
