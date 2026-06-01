import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logging/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../logging/index.js')>(
    '../../logging/index.js',
  );
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('@airo/ai-lib', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@airo/ai-lib');
  return {
    ...actual,
    getS2STokenV2: vi.fn().mockResolvedValue('mock-s2s-token'),
    refreshS2STokenV2: vi.fn().mockResolvedValue('refreshed-s2s-token'),
  };
});

import * as aiLib from '@airo/ai-lib';
import { GettyUploadService } from '../GettyUploadService.js';
import { logger } from '../../logging/index.js';

describe('GettyUploadService', () => {
  let originalEnv: NodeJS.ProcessEnv;
  const mockFetch = vi.fn();

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GETTY_IMAGE_PROXY_URL = 'https://proxy.test.example.com';
    process.env.USE_S2S_AUTH = 'true';
    delete process.env.SSO_JWT;
    delete process.env.GETTY_TOKEN;
    delete process.env.GETTY_APP_KEY;

    vi.mocked(aiLib.getS2STokenV2).mockResolvedValue('mock-s2s-token');
    vi.mocked(aiLib.refreshS2STokenV2).mockResolvedValue('refreshed-s2s-token');

    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  describe('uploadAndReport', () => {
    it('should return empty array for empty input', async () => {
      const service = new GettyUploadService();
      const result = await service.uploadAndReport([]);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty array when api base URL is unset', async () => {
      delete process.env.GETTY_IMAGE_PROXY_URL;
      const service = new GettyUploadService();
      (service as any).apiBaseUrl = '';

      const result = await service.uploadAndReport(['id-1']);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('getty_upload.missing_config', expect.objectContaining({
        baseUrlConfigured: false,
      }));
    });

    it('should return empty array when neither auth var is set', async () => {
      delete process.env.USE_S2S_AUTH;

      const service = new GettyUploadService();

      const result = await service.uploadAndReport(['id-1']);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('getty_upload.missing_config', expect.objectContaining({
        configured: false,
      }));
    });

    it('should mint and use S2S token and make correct POST request', async () => {
      vi.mocked(aiLib.getS2STokenV2).mockResolvedValue('iam-jwt-token');

      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await service.uploadAndReport(['img-1', 'img-2']);

      expect(aiLib.getS2STokenV2).toHaveBeenCalledTimes(1);
      expect(aiLib.getS2STokenV2).toHaveBeenCalledWith(
        expect.objectContaining({ ssoHost: 'sso.test-godaddy.com' }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://proxy.test.example.com/v1/upload?reportUsage=true');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        'Authorization': 'sso-jwt iam-jwt-token',
        'x-app-key': 'airo-app-builder',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });
      expect(JSON.parse(options.body)).toEqual({ ids: ['img-1', 'img-2'] });
    });

    it('should cache the S2S token across multiple uploadAndReport calls', async () => {
      vi.mocked(aiLib.getS2STokenV2).mockResolvedValue('iam-jwt-token');

      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await service.uploadAndReport(['img-1']);
      await service.uploadAndReport(['img-2']);
      await service.uploadAndReport(['img-3']);

      expect(aiLib.getS2STokenV2).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should warn when GETTY_TOKEN is set (legacy env var)', async () => {
      process.env.GETTY_TOKEN = 'legacy-bearer';

      new GettyUploadService();

      expect(logger.warn).toHaveBeenCalledWith(
        'getty_upload.config.getty_token_ignored',
        expect.objectContaining({
          message: expect.stringContaining('GETTY_TOKEN is no longer used'),
        }),
      );
    });

    it('should use custom GETTY_APP_KEY when set', async () => {
      process.env.GETTY_APP_KEY = 'custom-app';
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await service.uploadAndReport(['img-1']);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['x-app-key']).toBe('custom-app');
    });

    it('should return upload results on success', async () => {
      const service = new GettyUploadService();

      const mockResults = [
        { id: 'img-1', url: 'https://cdn.example.com/img-1.jpg', dimensions: { height: 600, width: 800 } },
        { id: 'img-2', url: 'https://cdn.example.com/img-2.jpg' },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResults,
      });

      const result = await service.uploadAndReport(['img-1', 'img-2']);

      expect(result).toEqual(mockResults);
    });

    it('should return empty array on non-ok response', async () => {
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        text: async () => 'Bad Gateway',
      });

      const result = await service.uploadAndReport(['img-1']);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('getty_upload.upstream_error', expect.objectContaining({
        status: 502,
        error: 'Bad Gateway',
        ids: ['img-1'],
      }));
    });

    it('should return empty array on fetch error', async () => {
      const service = new GettyUploadService();

      mockFetch.mockRejectedValue(new Error('Network failure'));

      const result = await service.uploadAndReport(['img-1']);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('getty_upload.error', expect.objectContaining({
        ids: ['img-1'],
        error: 'Network failure',
      }));
    });

    it('should return empty array and log error when S2S token mint fails', async () => {
      vi.mocked(aiLib.getS2STokenV2).mockRejectedValue(new Error('SSO down'));

      const service = new GettyUploadService();

      const result = await service.uploadAndReport(['img-1']);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'getty_upload.error',
        expect.objectContaining({ error: 'SSO down' }),
      );
    });

    it('does not hammer getS2STokenV2 after init failure (BaseDriverV2)', async () => {
      delete process.env.SSO_JWT;
      vi.mocked(aiLib.getS2STokenV2).mockRejectedValue(new Error('SSO down'));

      const service = new GettyUploadService();

      const r1 = await service.uploadAndReport(['img-1']);
      const r2 = await service.uploadAndReport(['img-2']);

      expect(r1).toEqual([]);
      expect(r2).toEqual([]);
      expect(aiLib.getS2STokenV2).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('retries once on 401 using refreshS2STokenV2 to bypass ai-lib cache', async () => {
      delete process.env.SSO_JWT;
      vi.mocked(aiLib.getS2STokenV2).mockResolvedValue('first-token');
      vi.mocked(aiLib.refreshS2STokenV2).mockResolvedValue('force-refreshed-token');

      const service = new GettyUploadService();

      let callCount = 0;
      mockFetch.mockImplementation(async function fetchImpl() {
        callCount++;
        if (callCount === 1) return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'expired' };
        return { ok: true, json: async () => [{ id: 'img-1', url: 'https://cdn/img-1' }] };
      });

      const result = await service.uploadAndReport(['img-1']);

      expect(result).toEqual([{ id: 'img-1', url: 'https://cdn/img-1' }]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(aiLib.refreshS2STokenV2).toHaveBeenCalledTimes(1);
      expect(aiLib.refreshS2STokenV2).toHaveBeenCalledWith(
        expect.objectContaining({ ssoHost: 'sso.test-godaddy.com' }),
      );
    });

    it('preserves trailing slash on proxy URL (BaseDriverV2 joins path as-is)', async function trailingSlashJoin() {
      process.env.GETTY_IMAGE_PROXY_URL = 'https://proxy.test.example.com/';
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await service.uploadAndReport(['img-1']);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://proxy.test.example.com//v1/upload?reportUsage=true');
    });

    it('defaults base URL to the dev direct proxy when GETTY_IMAGE_PROXY_URL is unset', () => {
      delete process.env.GETTY_IMAGE_PROXY_URL;

      const service = new GettyUploadService();

      expect((service as any).apiBaseUrl).toBe('https://getty-images-proxy.api.dev-godaddy.com');
    });
  });

  describe('reportUsage', () => {
    it('should not call fetch when no IDs provided', () => {
      const service = new GettyUploadService();
      service.reportUsage([]);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not call fetch when neither auth var is set', () => {
      delete process.env.USE_S2S_AUTH;
      const service = new GettyUploadService();
      service.reportUsage(['img-1']);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should make correct PUT request with S2S token', async () => {
      vi.mocked(aiLib.getS2STokenV2).mockResolvedValue('iam-jwt-token');
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({ ok: true });

      service.reportUsage(['img-1', 'img-2']);

      // reportUsage is fire-and-forget; wait for the microtask chain to settle
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://proxy.test.example.com/v1/usage');
      expect(options.method).toBe('PUT');
      expect(options.headers).toEqual({
        'Authorization': 'sso-jwt iam-jwt-token',
        'x-app-key': 'airo-app-builder',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });
      expect(JSON.parse(options.body)).toEqual({ ids: ['img-1', 'img-2'] });
    });

    it('should log warning on fetch error without throwing', async () => {
      const service = new GettyUploadService();

      mockFetch.mockRejectedValue(new Error('Connection refused'));

      service.reportUsage(['img-1']);

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith('getty_usage_report.error', expect.objectContaining({
          ids: ['img-1'],
          error: 'Connection refused',
        }));
      });
    });
  });

  describe('uploadVideo', () => {
    it('should return null for empty input', async () => {
      const service = new GettyUploadService();
      const result = await service.uploadVideo('');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null when auth is not configured', async () => {
      delete process.env.USE_S2S_AUTH;
      delete process.env.SSO_JWT;
      const service = new GettyUploadService();

      const result = await service.uploadVideo('video-1');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('getty_video_upload.missing_config', expect.anything());
    });

    it('should POST to /v1/videos/upload and return videoUrl on success', async () => {
      vi.mocked(aiLib.getS2STokenV2).mockResolvedValue('iam-jwt-token');
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'video-1', videoUrl: 'https://cdn.example.com/video-1.mp4' }),
      });

      const result = await service.uploadVideo('video-1');

      expect(result).toBe('https://cdn.example.com/video-1.mp4');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://proxy.test.example.com/v1/videos/upload?reportUsage=false');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ id: 'video-1' });
    });

    it('should return null and log error on non-ok response', async () => {
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
      });

      const result = await service.uploadVideo('video-1');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('getty_video_upload.upstream_error', expect.objectContaining({
        status: 502,
        videoId: 'video-1',
      }));
    });

    it('should return null when response has no videoUrl', async () => {
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'video-1' }), // missing videoUrl
      });

      const result = await service.uploadVideo('video-1');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('getty_video_upload.no_video_url', expect.objectContaining({
        videoId: 'video-1',
      }));
    });

    it('should return null and log error on network failure', async () => {
      const service = new GettyUploadService();

      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.uploadVideo('video-1');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('getty_video_upload.error', expect.objectContaining({
        videoId: 'video-1',
        error: 'ECONNREFUSED',
      }));
    });
  });
});
