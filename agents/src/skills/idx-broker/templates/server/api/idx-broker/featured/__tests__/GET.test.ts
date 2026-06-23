/**
 * Unit tests for GET /api/idx-broker/featured
 *
 * Critical tests for SSRF (Server-Side Request Forgery) prevention.
 * The URL validation logic protects against attackers tricking the server
 * into making requests to unintended destinations.
 *
 * NOTE: This test file is in templates/ and excluded from vitest collection
 * (see agents/vitest.config.ts). When this skill is installed into a user's app,
 * these tests become part of the app's test suite and will run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

// Mock the secrets module
vi.mock('#airo/secrets', () => ({
  getSecret: vi.fn(),
}));

import handler from '../GET';
import { getSecret } from '#airo/secrets';

const mockGetSecret = vi.mocked(getSecret);

describe('GET /api/idx-broker/featured - SSRF Protection', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    jsonSpy = vi.fn();
    statusSpy = vi.fn(() => ({ json: jsonSpy }));

    mockReq = {
      query: {},
    };
    mockRes = {
      json: jsonSpy,
      status: statusSpy as any,
    };

    global.fetch = vi.fn();
    mockGetSecret.mockReturnValue('test-api-key');
  });

  describe('URL Validation - SSRF Prevention', () => {
    it('should reject URLs with non-IDX Broker hostname', async () => {
      mockReq.query = { url: 'https://evil.com/clients/featured' };

      await handler(mockReq as Request, mockRes as Response);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Invalid pagination URL. Must be an IDX Broker API URL.',
      });
    });

    it('should reject URLs with wrong pathname', async () => {
      mockReq.query = { url: 'https://api.idxbroker.com/other/endpoint' };

      await handler(mockReq as Request, mockRes as Response);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Invalid pagination URL. Must be a featured listings endpoint.',
      });
    });

    it('should reject malformed URLs', async () => {
      mockReq.query = { url: 'not-a-valid-url' };

      await handler(mockReq as Request, mockRes as Response);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        error: 'Invalid URL format.',
      });
    });

    it('should accept valid IDX Broker pagination URL', async () => {
      const validUrl = 'https://api.idxbroker.com/clients/featured?offset=50';
      mockReq.query = { url: validUrl };

      const mockApiResponse = {
        total: 0,
        first: '',
        last: '',
        next: null,
        previous: null,
        data: {},
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      });

      await handler(mockReq as Request, mockRes as Response);

      // Should call fetch with the provided URL
      expect(global.fetch).toHaveBeenCalledWith(
        validUrl,
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            accesskey: 'test-api-key',
          }),
        })
      );

      // Should return success (not 400 error)
      expect(statusSpy).not.toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          listings: [],
          pagination: expect.any(Object),
        })
      );
    });

    it('should use default URL when url parameter is absent', async () => {
      mockReq.query = {}; // No url parameter

      const mockApiResponse = {
        total: 0,
        first: '',
        last: '',
        next: null,
        previous: null,
        data: {},
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      });

      await handler(mockReq as Request, mockRes as Response);

      // Should call fetch with default base URL
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.idxbroker.com/clients/featured',
        expect.any(Object)
      );
    });

    it('should accept valid IDX Broker URL with query parameters', async () => {
      const validUrl = 'https://api.idxbroker.com/clients/featured?offset=100&limit=50';
      mockReq.query = { url: validUrl };

      const mockApiResponse = {
        total: 0,
        first: '',
        last: '',
        next: null,
        previous: null,
        data: {},
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      });

      await handler(mockReq as Request, mockRes as Response);

      expect(global.fetch).toHaveBeenCalledWith(validUrl, expect.any(Object));
      expect(statusSpy).not.toHaveBeenCalledWith(400);
    });
  });

  describe('Empty Response Handling', () => {
    it('should return empty listings with pagination stub for empty response', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(''),
      });

      await handler(mockReq as Request, mockRes as Response);

      expect(jsonSpy).toHaveBeenCalledWith({
        listings: [],
        pagination: {
          total: 0,
          first: 'https://api.idxbroker.com/clients/featured',
          last: 'https://api.idxbroker.com/clients/featured',
          next: null,
          previous: null,
        },
      });
    });
  });

  describe('parseIDXListings Integration', () => {
    it('should use parseIDXListings to unwrap data and filter nulls', async () => {
      const mockApiResponse = {
        total: 2,
        first: 'https://api.idxbroker.com/clients/featured?offset=0',
        last: 'https://api.idxbroker.com/clients/featured?offset=0',
        next: null,
        previous: null,
        data: {
          'a000!%M1': {
            listingID: 'M1',
            address: '123 Main St',
            cityName: 'Miami',
            listingPrice: '$500,000',
          },
          'null-entry': null,
        },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockApiResponse)),
      });

      await handler(mockReq as Request, mockRes as Response);

      const response = jsonSpy.mock.calls[0][0];

      // Should have filtered out null entry
      expect(response.listings).toHaveLength(1);
      expect(response.listings[0].listingID).toBe('M1');

      // Should include pagination metadata
      expect(response.pagination).toEqual({
        total: 2,
        first: 'https://api.idxbroker.com/clients/featured?offset=0',
        last: 'https://api.idxbroker.com/clients/featured?offset=0',
        next: null,
        previous: null,
      });
    });
  });
});
