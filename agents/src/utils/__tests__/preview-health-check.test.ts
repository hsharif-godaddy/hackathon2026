import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkPreviewHealth } from '../preview-health-check.js';

describe('preview-health-check', function packageTests() {
  const fetchMock = vi.fn();

  beforeEach(function setup() {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      status: 200,
      body: { cancel: vi.fn() },
    });
  });

  afterEach(function teardown() {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  describe('#checkPreviewHealth', function checkTests() {
    it('accepts legacy numeric port and probes 127.0.0.1', async function legacyPort() {
      await checkPreviewHealth(4321);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:4321/',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('probes appBaseUrl when provided', async function appBaseUrl() {
      await checkPreviewHealth({
        appBaseUrl: 'https://abc.preview.c39.airoapp.ai/?airoShareToken=abc',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://abc.preview.c39.airoapp.ai/?airoShareToken=abc',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it('normalizes localhost in appBaseUrl to 127.0.0.1', async function localhostNorm() {
      await checkPreviewHealth({ appBaseUrl: 'http://localhost:3000/' });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/',
        expect.any(Object)
      );
    });

    it('returns false on 5xx', async function serverError() {
      fetchMock.mockResolvedValueOnce({ status: 503, body: { cancel: vi.fn() } });

      expect(await checkPreviewHealth({ port: 3000 })).toBe(false);
    });

    it('returns false when fetch throws', async function networkError() {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      expect(await checkPreviewHealth({ port: 3000 })).toBe(false);
    });

    it('fails open when appBaseUrl is invalid and no port is available', async function invalidUrlFailOpen() {
      const onUnparseable = vi.fn();

      expect(await checkPreviewHealth({
        appBaseUrl: 'not a url!!!',
        onUnparseableAppBaseUrl: onUnparseable,
      })).toBe(true);
      expect(onUnparseable).toHaveBeenCalledWith('not a url!!!');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to port when appBaseUrl is invalid', async function invalidUrlPortFallback() {
      const onUnparseable = vi.fn();

      expect(await checkPreviewHealth({
        appBaseUrl: 'not a url!!!',
        port: 3000,
        onUnparseableAppBaseUrl: onUnparseable,
      })).toBe(true);
      expect(onUnparseable).toHaveBeenCalledWith('not a url!!!');
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/',
        expect.any(Object)
      );
    });

    it('attaches tls skip dispatcher for local https hosts', async function localTls() {
      await checkPreviewHealth({ appBaseUrl: 'https://local.gasket.dev-godaddy.com/' });

      expect(fetchMock.mock.calls[0]![1]).toHaveProperty('dispatcher');
    });

    it('does not attach tls skip dispatcher for production preview hosts', async function prodTls() {
      await checkPreviewHealth({
        appBaseUrl: 'https://abc.preview.c39.airoapp.ai/?airoShareToken=abc',
      });

      expect(fetchMock.mock.calls[0]![1]?.dispatcher).toBeUndefined();
    });
  });
});
