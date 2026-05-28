import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@airo/ai-lib');
  return {
    ...actual,
    getS2STokenV2: vi.fn().mockResolvedValue('mock-s2s-token'),
    refreshS2STokenV2: vi.fn().mockResolvedValue('refreshed-s2s-token'),
  };
});

import * as aiLib from '@airo/ai-lib';
import { GettyMediaDriver } from '../getty-media-driver.js';

describe('GettyMediaDriver filter expansion', () => {
  let driver: GettyMediaDriver;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(aiLib.getS2STokenV2).mockReset().mockResolvedValue('mock-s2s-token');
    process.env.USE_S2S_AUTH = 'true';
    process.env.GETTY_IMAGE_PROXY_URL = 'https://test-getty.example.com';

    driver = new GettyMediaDriver();

    // Override the get method
    fetchSpy = vi.fn().mockImplementation(async (_endpoint: string, _params: URLSearchParams) => {
      return {
        ok: true,
        json: async () => ({
          result_count: 1,
          images: [{
            id: '123',
            display_sizes: [
              { name: 'comp', uri: 'https://example.com/comp.jpg', is_watermarked: false },
              { name: 'preview', uri: 'https://example.com/preview.jpg', is_watermarked: false },
            ],
            title: 'Test Image',
            max_dimensions: { width: 1024, height: 768 }
          }]
        }),
        text: async () => ''
      };
    });

    (driver as any).get = fetchSpy;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.USE_S2S_AUTH;
    delete process.env.GETTY_IMAGE_PROXY_URL;
  });

  it('should pass multiple orientation values as separate query params', async () => {
    await driver.search({
      query: 'sunset',
      orientations: ['horizontal', 'square'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('orientations=horizontal');
    expect(paramsStr).toContain('orientations=square');
  });

  it('should pass new Getty filter params', async () => {
    await driver.search({
      query: 'business meeting',
      moods: ['warm'],
      numberOfPeople: ['two', 'group'],
      ethnicity: ['east_asian'],
      ageOfPeople: ['adult'],
      minimumSize: 'large',
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('moods=warm');
    expect(paramsStr).toContain('number_of_people=two');
    expect(paramsStr).toContain('number_of_people=group');
    expect(paramsStr).toContain('ethnicity=east_asian');
    expect(paramsStr).toContain('age_of_people=adult');
    expect(paramsStr).toContain('minimum_size=large');
  });

  it('should pass graphical_styles as array', async () => {
    await driver.search({
      query: 'abstract art',
      graphicalStyles: ['illustration', 'vector'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('graphical_styles=illustration');
    expect(paramsStr).toContain('graphical_styles=vector');
  });

  it('should not pass image-only filters for video search', async () => {
    fetchSpy.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        result_count: 1,
        videos: [{
          id: '456',
          display_sizes: [
            { name: 'comp', uri: 'https://example.com/comp.mp4', is_watermarked: false },
            { name: 'preview', uri: 'https://example.com/preview.mp4', is_watermarked: false },
          ],
          title: 'Test Video',
          max_dimensions: { width: 1920, height: 1080 }
        }]
      }),
      text: async () => ''
    }));

    // Also mock uploadVideo to avoid secondary call
    (driver as any).uploadVideo = vi.fn().mockResolvedValue('https://example.com/video.mp4');

    await driver.search({
      query: 'sunset',
      mediaType: 'video',
      orientations: ['horizontal'],
      moods: ['warm'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).not.toContain('orientations=');
    expect(paramsStr).not.toContain('moods=');
  });

  it('should use query as phrase in Getty API params', async () => {
    await driver.search({
      query: 'sunset beach',
      orientations: ['horizontal'],
      graphicalStyles: ['photography'],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const [, params] = fetchSpy.mock.calls[0];
    const paramsStr = params.toString();
    expect(paramsStr).toContain('phrase=sunset+beach');
    expect(paramsStr).toContain('orientations=horizontal');
    expect(paramsStr).toContain('graphical_styles=photography');
  });
});

describe('GettyMediaDriver filter relaxation retries', () => {
  let driver: GettyMediaDriver;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const emptyResponse = {
    ok: true,
    json: async () => ({ result_count: 0, images: [] }),
    text: async () => '',
  };

  const successResponse = {
    ok: true,
    json: async () => ({
      result_count: 5,
      images: [{
        id: '123',
        display_sizes: [
          { name: 'comp', uri: 'https://example.com/comp.jpg', is_watermarked: false },
        ],
        title: 'Test Image',
        max_dimensions: { width: 1024, height: 768 },
      }],
    }),
    text: async () => '',
  };

  beforeEach(() => {
    vi.mocked(aiLib.getS2STokenV2).mockReset().mockResolvedValue('mock-s2s-token');
    process.env.USE_S2S_AUTH = 'true';
    process.env.GETTY_IMAGE_PROXY_URL = 'https://test-getty.example.com';
    driver = new GettyMediaDriver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.USE_S2S_AUTH;
    delete process.env.GETTY_IMAGE_PROXY_URL;
  });

  it('should not retry when first attempt returns results', async () => {
    fetchSpy = vi.fn().mockResolvedValue(successResponse);
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'fashion model',
      orientations: ['vertical'],
      moods: ['bold'],
      graphicalStyles: ['photography'],
      numberOfPeople: ['one'],
      minimumSize: 'large',
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // First call should have all filters
    const paramsStr = fetchSpy.mock.calls[0][1].toString();
    expect(paramsStr).toContain('moods=bold');
    expect(paramsStr).toContain('orientations=vertical');
  });

  it('should drop moods first when no results', async () => {
    fetchSpy = vi.fn()
      .mockResolvedValueOnce(emptyResponse)   // all filters -> 0
      .mockResolvedValueOnce(successResponse); // drop moods -> results
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'fashion model',
      orientations: ['vertical'],
      moods: ['bold', 'dramatic'],
      graphicalStyles: ['photography'],
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Second call should not have moods
    const retryParams = fetchSpy.mock.calls[1][1].toString();
    expect(retryParams).not.toContain('moods=');
    // But should still have other filters
    expect(retryParams).toContain('orientations=vertical');
    expect(retryParams).toContain('graphical_styles=photography');
  });

  it('should drop moods+orientations on third attempt', async () => {
    fetchSpy = vi.fn()
      .mockResolvedValueOnce(emptyResponse)   // all filters -> 0
      .mockResolvedValueOnce(emptyResponse)   // drop moods -> 0
      .mockResolvedValueOnce(successResponse); // drop moods+orientations -> results
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'fashion model',
      orientations: ['vertical'],
      moods: ['bold'],
      graphicalStyles: ['photography'],
      numberOfPeople: ['one'],
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const retryParams = fetchSpy.mock.calls[2][1].toString();
    expect(retryParams).not.toContain('moods=');
    expect(retryParams).not.toContain('orientations=');
    // Should still have non-dropped filters
    expect(retryParams).toContain('graphical_styles=photography');
    expect(retryParams).toContain('number_of_people=one');
  });

  it('should drop all advanced filters on fourth attempt', async () => {
    fetchSpy = vi.fn()
      .mockResolvedValueOnce(emptyResponse)   // all filters -> 0
      .mockResolvedValueOnce(emptyResponse)   // drop moods -> 0
      .mockResolvedValueOnce(emptyResponse)   // drop moods+orientations -> 0
      .mockResolvedValueOnce(successResponse); // drop advanced -> results
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'fashion model',
      orientations: ['vertical'],
      moods: ['bold'],
      graphicalStyles: ['photography'],
      numberOfPeople: ['one'],
      minimumSize: 'large',
      ethnicity: ['east_asian'],
      ageOfPeople: ['adult'],
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const retryParams = fetchSpy.mock.calls[3][1].toString();
    expect(retryParams).not.toContain('moods=');
    expect(retryParams).not.toContain('orientations=');
    expect(retryParams).not.toContain('number_of_people=');
    expect(retryParams).not.toContain('minimum_size=');
    expect(retryParams).not.toContain('ethnicity=');
    expect(retryParams).not.toContain('age_of_people=');
    // Should still have graphicalStyles
    expect(retryParams).toContain('graphical_styles=photography');
  });

  it('should fall back to query-only on fifth attempt', async () => {
    fetchSpy = vi.fn()
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(emptyResponse)
      .mockResolvedValueOnce(successResponse); // query only -> results
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'fashion model',
      orientations: ['vertical'],
      moods: ['bold'],
      graphicalStyles: ['photography'],
      numberOfPeople: ['one'],
      minimumSize: 'large',
    });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(5);

    const retryParams = fetchSpy.mock.calls[4][1].toString();
    // Should only have phrase, page, page_size, sort_order
    expect(retryParams).toContain('phrase=fashion+model');
    expect(retryParams).not.toContain('moods=');
    expect(retryParams).not.toContain('orientations=');
    expect(retryParams).not.toContain('graphical_styles=');
    expect(retryParams).not.toContain('number_of_people=');
    expect(retryParams).not.toContain('minimum_size=');
  });

  it('should return failure when all relaxation levels return no results', async () => {
    fetchSpy = vi.fn().mockResolvedValue(emptyResponse);
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'impossible query xyz123',
      orientations: ['vertical'],
      moods: ['bold'],
      graphicalStyles: ['photography'],
      numberOfPeople: ['one'],
      minimumSize: 'large',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No images found');
    // Should have tried all 5 relaxation levels (all produce distinct params)
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('should not retry on API errors (non-ok response)', async () => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'Server Error',
    });
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'fashion model',
      moods: ['bold'],
    });

    expect(result.success).toBe(false);
    // Should stop on the first error, not retry
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('should skip relaxation levels that produce identical query params', async () => {
    // With only graphicalStyles and minimumSize set, levels all-filters/drop-moods/drop-moods-orientations
    // are identical, so only 3 distinct API calls should be made:
    // 1. all-filters (= drop-moods = drop-moods-orientations)
    // 2. drop-advanced (drops minimumSize)
    // 3. query-only (drops graphicalStyles too)
    fetchSpy = vi.fn()
      .mockResolvedValueOnce(emptyResponse)   // all-filters (levels 1-3 collapsed)
      .mockResolvedValueOnce(emptyResponse)   // drop-advanced
      .mockResolvedValueOnce(successResponse); // query-only
    (driver as any).get = fetchSpy;

    const result = await driver.search({
      query: 'test',
      graphicalStyles: ['photography'],
      minimumSize: 'large',
    });

    expect(result.success).toBe(true);
    // Should only make 3 API calls, not 5
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe('GettyMediaDriver S2S auth wiring', () => {
  const successResponse = {
    ok: true,
    json: async () => ({
      result_count: 1,
      images: [{
        id: 'img-1',
        display_sizes: [
          { name: 'comp', uri: 'https://example.com/comp.jpg', is_watermarked: false },
        ],
      }],
    }),
    text: async () => '',
  };

  beforeEach(() => {
    vi.mocked(aiLib.getS2STokenV2).mockReset().mockResolvedValue('mock-s2s-token');
    vi.mocked(aiLib.refreshS2STokenV2).mockReset().mockResolvedValue('refreshed-s2s-token');
    process.env.USE_S2S_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    delete process.env.GETTY_IMAGE_PROXY_URL;
    delete process.env.SSO_JWT;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successResponse));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.USE_S2S_AUTH;
    delete process.env.GETTY_IMAGE_PROXY_URL;
  });

  it('mints an S2S token on first search via USE_S2S_AUTH', async () => {
    const driver = new GettyMediaDriver();

    const result = await driver.search({ query: 'sunset' });

    expect(result.success).toBe(true);
    expect(aiLib.getS2STokenV2).toHaveBeenCalledTimes(1);
    expect(aiLib.getS2STokenV2).toHaveBeenCalledWith(
      expect.objectContaining({ ssoHost: 'sso.test-godaddy.com' }),
    );
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('caches the S2S token across multiple searches', async () => {
    const driver = new GettyMediaDriver();

    await driver.search({ query: 'sunset' });
    await driver.search({ query: 'beach' });
    await driver.search({ query: 'mountain' });

    expect(aiLib.getS2STokenV2).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(3);
  });

  it('returns auth-not-configured error when neither auth var is set', async () => {
    delete process.env.USE_S2S_AUTH;

    const driver = new GettyMediaDriver();

    const result = await driver.search({ query: 'sunset' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('USE_S2S_AUTH is not set');
  });

  it('does not retry token mint after S2S init failure until token is cleared (BaseDriverV2)', async () => {
    vi.mocked(aiLib.getS2STokenV2).mockRejectedValue(new Error('SSO down'));

    const driver = new GettyMediaDriver();

    const r1 = await driver.search({ query: 'sunset' });
    const r2 = await driver.search({ query: 'beach' });

    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    expect(aiLib.getS2STokenV2).toHaveBeenCalledTimes(1);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('retries once on 401 using refreshS2STokenV2 to bypass ai-lib cache', async () => {
    vi.mocked(aiLib.getS2STokenV2).mockResolvedValue('first-token');
    vi.mocked(aiLib.refreshS2STokenV2).mockResolvedValue('force-refreshed-token');

    const unauthorizedResponse = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'token expired',
    };

    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async function fetchImpl() {
        callCount++;
        if (callCount === 1) return unauthorizedResponse;
        return successResponse;
      }),
    );

    const driver = new GettyMediaDriver();

    const result = await driver.search({ query: 'sunset' });

    expect(result.success).toBe(true);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
    expect(aiLib.refreshS2STokenV2).toHaveBeenCalledTimes(1);
    expect(aiLib.refreshS2STokenV2).toHaveBeenCalledWith(
      expect.objectContaining({ ssoHost: 'sso.test-godaddy.com' }),
    );
  });

  it('defaults the base URL to the dev direct proxy when NODE_ENV is development', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.GETTY_IMAGE_PROXY_URL;

    const driver = new GettyMediaDriver();

    expect((driver as any).apiBaseUrl).toBe('https://getty-images-proxy.api.dev-godaddy.com');
  });

  it('defaults the base URL to the dev direct proxy when GETTY_IMAGE_PROXY_URL is unset', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.GETTY_IMAGE_PROXY_URL;

    const driver = new GettyMediaDriver();

    expect((driver as any).apiBaseUrl).toBe('https://getty-images-proxy.api.dev-godaddy.com');
  });

  it('uses GETTY_IMAGE_PROXY_URL when set to the dev direct proxy', async () => {
    process.env.GETTY_IMAGE_PROXY_URL = 'https://getty-images-proxy.api.dev-godaddy.com';

    const driver = new GettyMediaDriver();

    expect((driver as any).apiBaseUrl).toBe('https://getty-images-proxy.api.dev-godaddy.com');
  });

  it('mints S2S token using SSO_HOST when set (GASKET local.dev)', async () => {
    process.env.SSO_HOST = 'sso.dev-godaddy.com';
    process.env.GETTY_IMAGE_PROXY_URL = 'https://getty-images-proxy.api.dev-godaddy.com';

    const driver = new GettyMediaDriver();

    await driver.search({ query: 'sunset' });

    expect(aiLib.getS2STokenV2).toHaveBeenCalledWith(
      expect.objectContaining({ ssoHost: 'sso.dev-godaddy.com' }),
    );
  });
});
