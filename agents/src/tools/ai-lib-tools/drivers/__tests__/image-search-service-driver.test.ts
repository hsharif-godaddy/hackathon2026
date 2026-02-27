import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageSearchServiceDriver } from '../image-search-service-driver.js';

describe('ImageSearchServiceDriver', () => {
  let driver: ImageSearchServiceDriver;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.IMAGE_SEARCH_SERVICE_URL = 'https://test-service.example.com';
    driver = new ImageSearchServiceDriver();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.IMAGE_SEARCH_SERVICE_URL;
    vi.restoreAllMocks();
  });

  it('should call image search service API with correct body', async () => {
    const mockResponse = {
      results: [
        {
          gettyId: '123',
          urls: {
            preview: 'https://example.com/preview.jpg',
            thumbnail: 'https://example.com/thumb.jpg',
          },
          relevanceScore: 0.9,
          analysis: { primarySubject: 'sunset' },
          fromCache: true,
        },
      ],
      meta: {
        total: 1,
        cached: 1,
        analyzed: 0,
        filtered: 0,
        complete: true,
        pendingAnalysis: 0,
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await driver.search({
      query: 'sunset beach',
      count: 5,
      orientations: ['horizontal'],
      moods: ['warm'],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://test-service.example.com/api/v1/search',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'sunset beach',
          count: 5,
          filters: {
            orientations: ['horizontal'],
            moods: ['warm'],
          },
        }),
      })
    );

    expect(result.success).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items![0].id).toBe('123');
  });

  it('should map service response to MediaItem format', async () => {
    const mockResponse = {
      results: [
        {
          gettyId: '456',
          urls: {
            preview: 'https://example.com/prev.jpg',
            thumbnail: 'https://example.com/thumb.jpg',
            highRes: '',
          },
          relevanceScore: 0.85,
          analysis: {
            primarySubject: 'mountain landscape',
            subjectCategory: 'nature',
            composition: 'wide_shot',
          },
          fromCache: true,
        },
      ],
      meta: {
        total: 1,
        cached: 1,
        analyzed: 0,
        filtered: 0,
        complete: true,
        pendingAnalysis: 0,
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await driver.search({ query: 'mountains' });

    expect(result.success).toBe(true);
    expect(result.items![0]).toEqual(
      expect.objectContaining({
        id: '456',
        title: 'mountain landscape',
        urls: expect.objectContaining({
          preview: 'https://example.com/prev.jpg',
          thumbnail: 'https://example.com/thumb.jpg',
        }),
      })
    );
  });

  it('should use IMAGE_SEARCH_SERVICE_URL env var', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        meta: {
          total: 0,
          cached: 0,
          analyzed: 0,
          filtered: 0,
          complete: true,
          pendingAnalysis: 0,
        },
      }),
    });

    await driver.search({ query: 'test' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://test-service.example.com/api/v1/search',
      expect.anything()
    );
  });

  it('should return error on HTTP failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await driver.search({ query: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  it('should return error when no results found', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [],
        meta: {
          total: 0,
          cached: 0,
          analyzed: 0,
          filtered: 0,
          complete: true,
          pendingAnalysis: 0,
        },
      }),
    });

    const result = await driver.search({ query: 'nonexistent' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No images found');
  });

  it('should handle fetch errors gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await driver.search({ query: 'test' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('should return error for empty query', async () => {
    const result = await driver.search({ query: '' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('valid search query');
  });

  it('should produce correct caption when both analysis fields present', async () => {
    const mockResponse = {
      results: [
        {
          gettyId: '789',
          urls: { preview: 'https://example.com/prev.jpg' },
          relevanceScore: 0.8,
          analysis: { primarySubject: 'office', subjectCategory: 'workspace', composition: 'center' },
          fromCache: true,
        },
      ],
      meta: { total: 1, cached: 1, analyzed: 0, filtered: 0, complete: true, pendingAnalysis: 0 },
    };

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResponse });

    const result = await driver.search({ query: 'office' });
    expect(result.items![0].caption).toBe('workspace - center');
  });

  it('should produce undefined caption when both analysis fields missing', async () => {
    const mockResponse = {
      results: [
        {
          gettyId: '101',
          urls: { preview: 'https://example.com/prev.jpg' },
          relevanceScore: 0.8,
          analysis: { primarySubject: 'sunset' },
          fromCache: true,
        },
      ],
      meta: { total: 1, cached: 1, analyzed: 0, filtered: 0, complete: true, pendingAnalysis: 0 },
    };

    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockResponse });

    const result = await driver.search({ query: 'sunset' });
    expect(result.items![0].caption).toBeUndefined();
  });

  it('should send service-only filters in the filters object', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            gettyId: '999',
            urls: { preview: 'https://example.com/prev.jpg' },
            relevanceScore: 0.9,
            analysis: { primarySubject: 'test' },
            fromCache: true,
          },
        ],
        meta: { total: 1, cached: 1, analyzed: 0, filtered: 0, complete: true, pendingAnalysis: 0 },
      }),
    });

    await driver.search({
      query: 'office workspace',
      count: 3,
      subjectCategory: ['workspace'],
      usageContext: ['hero'],
    });

    const fetchCall = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.filters.subjectCategory).toEqual(['workspace']);
    expect(body.filters.usageContext).toEqual(['hero']);
  });
});
