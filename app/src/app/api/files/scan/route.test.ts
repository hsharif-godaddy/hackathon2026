import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

const { mockLogger, mockFetch } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockFetch: vi.fn(),
}));

vi.mock('@/lib/apm-context', () => ({
  withApmRoute: (handler: (req: NextRequest) => unknown) => handler,
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

vi.mock('../../../../../gasket.ts', () => ({
  default: {
    config: {
      onDemandScanner: {
        api: { baseUrl: 'https://on-demand-scanner.int.test-godaddy.com' },
      },
    },
  },
}));

vi.stubGlobal('fetch', mockFetch);

function createScanRequest(body: unknown, contentLength?: number): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (contentLength !== undefined) headers['content-length'] = String(contentLength);
  return new NextRequest('http://localhost:3000/api/files/scan', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function mockUpstreamResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

describe('POST /api/files/scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('request validation', () => {
    it('returns 400 when request has no body', async () => {
      const request = new NextRequest('http://localhost:3000/api/files/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    it('returns 400 when body is invalid JSON', async () => {
      const request = new NextRequest('http://localhost:3000/api/files/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      });
      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing required fields: file, fileName');
    });

    it('returns 400 when file field is missing', async () => {
      const response = await POST(createScanRequest({ fileName: 'photo.png' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when fileName field is missing', async () => {
      const response = await POST(createScanRequest({ file: 'base64data' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when file is not a string', async () => {
      const response = await POST(createScanRequest({ file: 123, fileName: 'photo.png' }));
      expect(response.status).toBe(400);
    });

    it('returns 413 when content-length exceeds 30 MB', async () => {
      const response = await POST(
        createScanRequest({ file: 'base64data', fileName: 'photo.png' }, 31 * 1024 * 1024),
      );
      expect(response.status).toBe(413);
      const data = await response.json();
      expect(data.error).toContain('30 MB');
    });

    it('returns 413 when body stream exceeds 30 MB with no content-length header', async () => {
      const overLimit = 'x'.repeat(31 * 1024 * 1024);
      const request = new NextRequest('http://localhost:3000/api/files/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: overLimit,
      });
      const response = await POST(request);
      expect(response.status).toBe(413);
      const data = await response.json();
      expect(data.error).toContain('30 MB');
    });
  });

  describe('scanner proxying', () => {
    it('returns 200 with pass:true when scanner reports clean', async () => {
      mockFetch.mockResolvedValueOnce(mockUpstreamResponse(200, {
        pass: true,
        fileHash: 'abc123',
        fileSize: 1024,
        fileType: 'png',
      }));

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'photo.png' }));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.pass).toBe(true);
      expect(data.fileHash).toBe('abc123');
    });

    it('returns 422 with message when scanner detects malware', async () => {
      mockFetch.mockResolvedValueOnce(mockUpstreamResponse(422, {
        pass: false,
        message: 'Malware found: Eicar-Test-File',
      }));

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'malware.exe' }));
      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.pass).toBe(false);
      expect(data.message).toBe('Malware found: Eicar-Test-File');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'files.scan.malware.detected',
        expect.objectContaining({ fileName: 'malware.exe', message: 'Malware found: Eicar-Test-File' }),
      );
    });

    it('uses default malware message when scanner 422 body omits the message field', async () => {
      mockFetch.mockResolvedValueOnce(mockUpstreamResponse(422, { pass: false }));

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'malware.exe' }));
      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.message).toBe('Malware found in file');
    });

    it('returns 503 with detail:connection refused when scanner fetch throws (network error)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('connection refused'));

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'photo.png' }));
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.detail).toBe('connection refused');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'files.scan.upstream.failed',
        expect.objectContaining({ fileName: 'photo.png' }),
      );
    });

    it('returns 503 with detail:abort message when scanner fetch throws a timeout (AbortError)', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'photo.png' }));
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.detail).toBe('The operation was aborted');
    });

    it('returns 503 with stringified detail for non-Error throws', async () => {
      mockFetch.mockRejectedValueOnce('plain string error');

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'photo.png' }));
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.detail).toBe('plain string error');
    });

    it('returns 400 when scanner returns 400', async () => {
      mockFetch.mockResolvedValueOnce(mockUpstreamResponse(400, { message: 'bad scan request' }));

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'photo.png' }));
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid scan request');
    });

    it('returns 503 with detail mentioning the status for unexpected scanner status codes', async () => {
      mockFetch.mockResolvedValueOnce(mockUpstreamResponse(500, { message: 'internal error' }));

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'photo.png' }));
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.detail).toContain('500');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'files.scan.upstream.unexpected',
        expect.objectContaining({ fileName: 'photo.png', status: 500 }),
      );
    });

    it('forwards file and fileName to the on-demand-scanner', async () => {
      mockFetch.mockResolvedValueOnce(mockUpstreamResponse(200, { pass: true }));

      await POST(createScanRequest({ file: 'mybase64==', fileName: 'design.png' }));

      expect(mockFetch).toHaveBeenCalledWith(
        'https://on-demand-scanner.int.test-godaddy.com/v1/perform-scan',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ file: 'mybase64==', fileName: 'design.png' }),
        }),
      );
    });
  });

  describe('missing config', () => {
    it('returns 503 with detail:config_missing when onDemandScanner baseUrl is not configured', async () => {
      const gasketMock = await import('../../../../../gasket.ts');
      const saved = (gasketMock.default.config as any).onDemandScanner;
      delete (gasketMock.default.config as any).onDemandScanner;

      const response = await POST(createScanRequest({ file: 'base64data', fileName: 'photo.png' }));
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.detail).toBe('config_missing');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'files.scan.config.missing',
        expect.any(Object),
      );

      (gasketMock.default.config as any).onDemandScanner = saved;
    });
  });
});
