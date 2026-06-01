import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Readable } from 'stream';

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  log: { error: vi.fn() },
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../../../services/FileUploadService.js', () => ({
  fileUploadService: {
    listUploadedFiles: vi.fn(),
    getAppUploadsDir: vi.fn().mockReturnValue('/tmp/uploads/test-app'),
    getFilePath: vi.fn((_appId: string, uploadId: string, filename: string) =>
      `/tmp/uploads/test-app/${uploadId}/${filename}`
    ),
  },
}));

vi.mock('../../../utils/file-url-signer.js', () => ({
  signFileUrl: vi.fn(),
  verifyFileSignature: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../services/features.js', () => ({
  BYPASS_SITE_IDS: ['test-app'],
}));

// Mock fs and fs/promises
const mockStat = vi.fn();
const mockCreateReadStream = vi.fn();
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock('fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: vi.fn().mockResolvedValue(Buffer.from('file content')),
}));

vi.mock('fs', () => ({
  createReadStream: (...args: unknown[]) => mockCreateReadStream(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
}));

import { fileUploadService } from '../../../services/FileUploadService.js';

const { filesPublicRouter } = await import('../files.js');

function createApp(): express.Express {
  const app = express();
  // Simulate JWT-authenticated request via agentContext (Path 2 — no sig/exp needed)
  app.use((req, _res, next) => {
    (req as any).agentContext = { siteId: 'test-app' };
    next();
  });
  app.use('/files', filesPublicRouter);
  return app;
}

describe('GET /files/uploads/:appId/:filename — video Range requests', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();

    // Setup: file exists
    vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
      {
        uploadId: 'u1',
        filename: 'clip.mp4',
        originalName: 'clip.mp4',
        mimeType: 'video/mp4',
        size: 1000,
      },
    ] as any);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['u1']);
    mockStat.mockResolvedValue({ size: 1000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves full video with 200 and Content-Length when no Range header', async () => {
    const stream = new Readable({ read() { this.push(Buffer.alloc(1000)); this.push(null); } });
    mockCreateReadStream.mockReturnValue(stream);

    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .expect(200);

    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe('1000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves partial content with 206 for valid Range header', async () => {
    const chunk = Buffer.alloc(500);
    const stream = new Readable({ read() { this.push(chunk); this.push(null); } });
    mockCreateReadStream.mockReturnValue(stream);

    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .set('Range', 'bytes=0-499')
      .expect(206);

    expect(res.headers['content-range']).toBe('bytes 0-499/1000');
    expect(res.headers['content-length']).toBe('500');
    expect(mockCreateReadStream).toHaveBeenCalledWith(
      expect.any(String),
      { start: 0, end: 499 }
    );
  });

  it('returns 416 for start >= fileSize', async () => {
    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .set('Range', 'bytes=1000-')
      .expect(416);

    expect(res.headers['content-range']).toBe('bytes */1000');
  });

  it('returns 416 for negative start', async () => {
    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .set('Range', 'bytes=-1-100')
      .expect(416);

    expect(res.headers['content-range']).toBe('bytes */1000');
  });

  it('returns 416 when end < start', async () => {
    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .set('Range', 'bytes=500-100')
      .expect(416);

    expect(res.headers['content-range']).toBe('bytes */1000');
  });

  it('clamps end to fileSize-1 when end exceeds file size', async () => {
    const chunk = Buffer.alloc(500);
    const stream = new Readable({ read() { this.push(chunk); this.push(null); } });
    mockCreateReadStream.mockReturnValue(stream);

    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .set('Range', 'bytes=500-9999')
      .expect(206);

    expect(res.headers['content-range']).toBe('bytes 500-999/1000');
    expect(res.headers['content-length']).toBe('500');
    expect(mockCreateReadStream).toHaveBeenCalledWith(
      expect.any(String),
      { start: 500, end: 999 }
    );
  });

  it('returns 416 for non-numeric range value (NaN)', async () => {
    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .set('Range', 'bytes=abc-def')
      .expect(416);

    expect(res.headers['content-range']).toBe('bytes */1000');
  });

  it('treats non-numeric end as open-ended (bytes=0-abc → full file from start)', async () => {
    const stream = new Readable({ read() { this.push(Buffer.alloc(1000)); this.push(null); } });
    mockCreateReadStream.mockReturnValue(stream);

    const res = await request(app)
      .get('/files/uploads/test-app/clip.mp4')
      .set('Range', 'bytes=0-abc')
      .expect(206);

    expect(res.headers['content-range']).toBe('bytes 0-999/1000');
    expect(res.headers['content-length']).toBe('1000');
  });
});
