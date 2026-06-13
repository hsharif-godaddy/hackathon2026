// Companion to download.test.ts; archiver is intentionally NOT mocked so
// these tests exercise the real zip stream end-to-end via yauzl.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Express } from 'express';
import yauzl from 'yauzl';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';

const mockFindById = vi.fn();
const mockCreateForWorkspace = vi.fn();
const warnLog = vi.fn();
const infoLog = vi.fn();

vi.mock('../../database/index.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return { findById: mockFindById }; }),
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}));

vi.mock('../../logging/index.js', () => ({
  Logger: { create: vi.fn(() => ({ debug: vi.fn(), info: infoLog, warn: warnLog, error: vi.fn() })) },
  log: {
    forApp: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    forAgent: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    error: vi.fn(),
  },
}));

vi.mock('../../config/app-download.js', () => ({
  ALLOWED_DIRECTORIES: ['src', 'public'],
  ALLOWED_CONFIG_FILES: ['package.json'],
}));

const downloadRouter = await import('./download.js').then((m) => m.default);

interface ZipEntry { name: string; size: number }

function readZipEntries(buf: Buffer): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('no zipfile'));
      const out: ZipEntry[] = [];
      zipfile.on('entry', (entry: any) => {
        out.push({ name: entry.fileName, size: entry.uncompressedSize });
        zipfile.readEntry();
      });
      zipfile.on('end', () => resolve(out));
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

function strictWorkspace(opts: {
  tree: Record<string, Array<{ path: string; kind: 'file' | 'directory' }>>;
  files: Record<string, Buffer | Error>;
}) {
  const treeMap = new Map(Object.entries(opts.tree));
  const fileMap = new Map(Object.entries(opts.files));
  return {
    tree: vi.fn(async ({ path }: { path: string }) => {
      const entries = treeMap.get(path);
      if (!entries) {
        const { DevSupervisorError } = await import('../../services/DevSupervisorClient.js');
        throw new DevSupervisorError('not_found', 404, `${path}: not found`);
      }
      return { entries: entries.map((e) => ({ ...e, size: 1, modifiedAt: '' })), truncated: false };
    }),
    download: vi.fn(async ({ path }: { path: string }) => {
      const data = fileMap.get(path);
      if (data instanceof Error) throw data;
      if (!data) {
        const { DevSupervisorError } = await import('../../services/DevSupervisorClient.js');
        throw new DevSupervisorError('not_found', 404, `${path}: not found`);
      }
      return { data, contentType: 'application/octet-stream' };
    }),
  };
}

describe('download route — REAL archiver', () => {
  const appId = 'e0tbxfur4q';

  function permittedApp(): Express {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as AuthenticatedRequest).agentContext = {
        siteId: appId,
        canDownload: true,
        canPublish: false,
        isE2S: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      } as any;
      next();
    });
    app.use('/', downloadRouter);
    return app;
  }

  function fetchZipBytes(app: Express, url: string) {
    return request(app)
      .get(url)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindById.mockReturnValue({ id: appId, name: 'Email Capture', path: `/tmp/apps/${appId}/app` });
  });

  it('produces a structurally valid zip with all expected entries on the happy path', async () => {
    const ws = strictWorkspace({
      tree: {
        src: [
          { path: 'src/index.ts', kind: 'file' },
          { path: 'src/components/Foo.tsx', kind: 'file' },
        ],
        public: [{ path: 'public/logo.png', kind: 'file' }],
      },
      files: {
        'src/index.ts': Buffer.from('export {}\n'),
        'src/components/Foo.tsx': Buffer.from('export const Foo = () => null\n'),
        'public/logo.png': Buffer.from('PNG\n'),
        'package.json': Buffer.from('{ "name": "email-capture" }\n'),
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    const response = await fetchZipBytes(permittedApp(), `/apps/${appId}/zip?nameStyle=appId`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="appId_e0tbxfur4q_Email_Capture.zip"',
    );

    const entries = await readZipEntries(response.body as Buffer);
    expect(entries.map((e) => e.name).sort()).toEqual([
      'appId_e0tbxfur4q_Email_Capture/package.json',
      'appId_e0tbxfur4q_Email_Capture/public/logo.png',
      'appId_e0tbxfur4q_Email_Capture/src/components/Foo.tsx',
      'appId_e0tbxfur4q_Email_Capture/src/index.ts',
    ]);
    for (const e of entries) expect(e.size).toBeGreaterThan(0);
  });

  it('skips a single failing file and still produces a valid zip with the rest', async () => {
    const ws = strictWorkspace({
      tree: {
        src: [
          { path: 'src/index.ts', kind: 'file' },
          { path: 'src/broken.ts', kind: 'file' },
        ],
        public: [{ path: 'public/logo.png', kind: 'file' }],
      },
      files: {
        'src/index.ts': Buffer.from('export {}\n'),
        'src/broken.ts': new Error('upstream blew up'),
        'public/logo.png': Buffer.from('PNG\n'),
        'package.json': Buffer.from('{}\n'),
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    const response = await fetchZipBytes(permittedApp(), `/apps/${appId}/zip?nameStyle=appId`);

    expect(response.status).toBe(200);

    const entries = await readZipEntries(response.body as Buffer);
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain('appId_e0tbxfur4q_Email_Capture/src/index.ts');
    expect(names).toContain('appId_e0tbxfur4q_Email_Capture/public/logo.png');
    expect(names).toContain('appId_e0tbxfur4q_Email_Capture/package.json');
    expect(names).not.toContain('appId_e0tbxfur4q_Email_Capture/src/broken.ts');

    expect(warnLog).toHaveBeenCalledWith(
      'route.apps.zip.file.failed',
      expect.objectContaining({ appId, filePath: 'src/broken.ts' }),
    );
    expect(infoLog).toHaveBeenCalledWith(
      'route.apps.zip.success',
      expect.objectContaining({ appId, fileCount: 3, failedCount: 1 }),
    );
  });

  it('reports failedCount: 0 in the success log when all files download cleanly', async () => {
    const ws = strictWorkspace({
      tree: { src: [{ path: 'src/index.ts', kind: 'file' }], public: [] },
      files: {
        'src/index.ts': Buffer.from('export {}\n'),
        'package.json': Buffer.from('{}\n'),
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    const response = await fetchZipBytes(permittedApp(), `/apps/${appId}/zip?nameStyle=appId`);
    expect(response.status).toBe(200);
    expect(infoLog).toHaveBeenCalledWith(
      'route.apps.zip.success',
      expect.objectContaining({ appId, fileCount: 2, failedCount: 0 }),
    );
    expect(warnLog).not.toHaveBeenCalledWith('route.apps.zip.file.failed', expect.anything());
  });

  it('silently skips DevSupervisor not_found errors without warn or failedCount', async () => {
    const ws = strictWorkspace({
      tree: {
        src: [
          { path: 'src/index.ts', kind: 'file' },
          { path: 'src/missing.ts', kind: 'file' },
        ],
        public: [],
      },
      files: {
        'src/index.ts': Buffer.from('export {}\n'),
        // src/missing.ts intentionally absent → strictWorkspace throws
        // DevSupervisorError(not_found), which is the expected steady-state
        // for files that vanish between tree() and download().
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    const response = await fetchZipBytes(permittedApp(), `/apps/${appId}/zip?nameStyle=appId`);
    expect(response.status).toBe(200);

    expect(warnLog).not.toHaveBeenCalledWith('route.apps.zip.file.failed', expect.anything());
    expect(infoLog).toHaveBeenCalledWith(
      'route.apps.zip.success',
      expect.objectContaining({ appId, fileCount: 1, failedCount: 0 }),
    );
  });

  it('counts every failure when multiple files throw non-NotFound', async () => {
    const ws = strictWorkspace({
      tree: {
        src: [
          { path: 'src/a.ts', kind: 'file' },
          { path: 'src/b.ts', kind: 'file' },
          { path: 'src/c.ts', kind: 'file' },
        ],
        public: [],
      },
      files: {
        'src/a.ts': Buffer.from('export const a = 1\n'),
        'src/b.ts': new Error('upstream a blew up'),
        'src/c.ts': new Error('upstream c blew up'),
        'package.json': Buffer.from('{}\n'),
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    const response = await fetchZipBytes(permittedApp(), `/apps/${appId}/zip?nameStyle=appId`);
    expect(response.status).toBe(200);

    const failedCalls = warnLog.mock.calls
      .filter((c) => c[0] === 'route.apps.zip.file.failed')
      .map((c) => c[1].filePath)
      .sort();
    expect(failedCalls).toEqual(['src/b.ts', 'src/c.ts']);
    expect(infoLog).toHaveBeenCalledWith(
      'route.apps.zip.success',
      expect.objectContaining({ appId, fileCount: 2, failedCount: 2 }),
    );
  });

  it('throws (not a 200 + empty zip) when every file fails to download', async () => {
    // tree() succeeds so the outer try doesn't short-circuit, but every
    // download() throws non-NotFound. Without the floor guard, the route
    // would emit HTTP 200 + a valid empty zip + a misleading success log.
    const ws = strictWorkspace({
      tree: {
        src: [
          { path: 'src/a.ts', kind: 'file' },
          { path: 'src/b.ts', kind: 'file' },
        ],
        public: [],
      },
      files: {
        'src/a.ts': new Error('all downloads down'),
        'src/b.ts': new Error('all downloads down'),
        // no successful file — package.json is also absent → NotFound,
        // which the silent-skip branch eats; net appendedCount === 0.
      },
    });
    mockCreateForWorkspace.mockReturnValue({ files: ws });

    const response = await fetchZipBytes(permittedApp(), `/apps/${appId}/zip?nameStyle=appId`);

    // res.destroy() after headers were sent surfaces as a truncated
    // transfer, not a structurally-valid 200 zip body. We assert:
    //   1. success was NEVER logged (gate fired before finalize)
    //   2. all per-file failures were warn-logged so operators can see them
    expect(infoLog).not.toHaveBeenCalledWith('route.apps.zip.success', expect.anything());
    const failedCalls = warnLog.mock.calls
      .filter((c) => c[0] === 'route.apps.zip.file.failed')
      .map((c) => c[1].filePath);
    expect(failedCalls.sort()).toEqual(['src/a.ts', 'src/b.ts']);

    // The body must NOT parse as a non-empty zip: either the response was
    // truncated mid-stream (yauzl rejects EOCD) or the test environment
    // delivered an empty body. Either way it's not a valid 200 zip with
    // entries.
    if ((response.body as Buffer).length > 0) {
      await expect(readZipEntries(response.body as Buffer)).rejects.toBeDefined();
    }
  });
});
