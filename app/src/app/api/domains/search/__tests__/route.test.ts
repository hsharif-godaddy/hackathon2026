import '@testing-library/jest-dom';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../route';

const mockFindExact = vi.fn();
const mockFindSpins = vi.fn();

vi.mock('@site/domain-services', () => ({
  DomainServices: vi.fn(() => ({
    findExact: mockFindExact,
    findSpins: mockFindSpins,
  })),
}));

vi.mock('@/lib/customer-auth', () => ({
  withCustomerAuth: (handler: any) => {
    return (request: NextRequest) => handler(request, {
      user: { customerId: 'test-customer-123' },
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
  detectLocale: vi.fn(() => 'en-US'),
}));

function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://test/api/domains/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/domains/search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DOMAIN_FIND_API_KEY = 'test-api-key-name';
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
      mockFindExact.mockImplementation(() => { throw new Error('Unexpected boom'); });

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
});
