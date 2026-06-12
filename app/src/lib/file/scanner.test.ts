import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scanFile } from './scanner';

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

function makeBuffer(bytes: number[] = [1, 2, 3]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('scanFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns pass:true when BFF responds 200', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { pass: true }));

    const result = await scanFile(makeBuffer(), 'photo.png');

    expect(result).toEqual({ pass: true, status: 'okay' });
  });

  it('returns malicious with message when BFF responds 422', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(422, { pass: false, message: 'Malware found in file' }));

    const result = await scanFile(makeBuffer(), 'malware.zip');

    expect(result).toEqual({ pass: false, status: 'malicious', message: 'Malware found in file' });
  });

  it('returns malicious with default message when 422 body has no message field', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(422, {}));

    const result = await scanFile(makeBuffer(), 'malware.zip');

    expect(result).toEqual({ pass: false, status: 'malicious', message: 'Malware found in file' });
  });

  it('returns unavailable when BFF responds 503', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(503, { error: 'unavailable' }));

    const result = await scanFile(makeBuffer(), 'photo.png');

    expect(result).toEqual({ pass: false, status: 'unavailable' });
  });

  it('returns unavailable when BFF responds 400', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400, { error: 'bad request' }));

    const result = await scanFile(makeBuffer(), 'photo.png');

    expect(result).toEqual({ pass: false, status: 'unavailable' });
  });

  it('returns unavailable when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'));

    const result = await scanFile(makeBuffer(), 'photo.png');

    expect(result).toEqual({ pass: false, status: 'unavailable' });
  });

  it('sends POST to /api/files/scan with base64-encoded file and fileName', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { pass: true }));

    const bytes = [72, 101, 108, 108, 111]; // "Hello"
    await scanFile(new Uint8Array(bytes).buffer, 'hello.txt');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/files/scan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ file: btoa('Hello'), fileName: 'hello.txt' }),
      }),
    );
  });
});
