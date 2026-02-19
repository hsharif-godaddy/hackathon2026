import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GettyUploadService } from '../GettyUploadService.js';
import { logger } from '../../logging/index.js';

describe('GettyUploadService', () => {
  let originalEnv: NodeJS.ProcessEnv;
  const mockFetch = vi.fn();

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GETTY_API_URL = 'https://proxy.test.example.com';
    process.env.GETTY_TOKEN = 'test-token';
    delete process.env.GETTY_APP_KEY;

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

    it('should return empty array when GETTY_API_URL is missing', async () => {
      delete process.env.GETTY_API_URL;
      const service = new GettyUploadService();

      const result = await service.uploadAndReport(['id-1']);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('getty_upload.missing_config', expect.objectContaining({
        hasBaseUrl: false,
      }));
    });

    it('should return empty array when GETTY_TOKEN is missing', async () => {
      delete process.env.GETTY_TOKEN;
      const service = new GettyUploadService();

      const result = await service.uploadAndReport(['id-1']);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('getty_upload.missing_config', expect.objectContaining({
        hasAuth: false,
      }));
    });

    it('should make correct POST request with correct URL, headers, and body', async () => {
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await service.uploadAndReport(['img-1', 'img-2']);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://proxy.test.example.com/v1/upload?reportUsage=true');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({
        'Authorization': 'Bearer test-token',
        'x-app-key': 'airo-app-builder',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      });
      expect(JSON.parse(options.body)).toEqual({ ids: ['img-1', 'img-2'] });
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
        text: async () => 'Bad Gateway',
      });

      const result = await service.uploadAndReport(['img-1']);

      expect(result).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith('getty_upload.upstream_error', expect.objectContaining({
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
      expect(logger.warn).toHaveBeenCalledWith('getty_upload.error', expect.objectContaining({
        ids: ['img-1'],
        error: 'Network failure',
      }));
    });

    it('should parse base URL correctly from URL with path', async () => {
      process.env.GETTY_API_URL = 'https://proxy.test.example.com/some/path';
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      await service.uploadAndReport(['img-1']);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://proxy.test.example.com/v1/upload?reportUsage=true');
    });
  });

  describe('reportUsage', () => {
    it('should not call fetch when no IDs provided', () => {
      const service = new GettyUploadService();
      service.reportUsage([]);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not call fetch when GETTY_API_URL is missing', () => {
      delete process.env.GETTY_API_URL;
      const service = new GettyUploadService();
      service.reportUsage(['img-1']);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not call fetch when GETTY_TOKEN is missing', () => {
      delete process.env.GETTY_TOKEN;
      const service = new GettyUploadService();
      service.reportUsage(['img-1']);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should make correct PUT request', () => {
      const service = new GettyUploadService();

      mockFetch.mockResolvedValue({ ok: true });

      service.reportUsage(['img-1', 'img-2']);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://proxy.test.example.com/v1/usage');
      expect(options.method).toBe('PUT');
      expect(options.headers).toEqual({
        'Authorization': 'Bearer test-token',
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

      // Wait for the fire-and-forget promise to settle
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith('getty_usage_report.error', expect.objectContaining({
          ids: ['img-1'],
          error: 'Connection refused',
        }));
      });
    });
  });
});
