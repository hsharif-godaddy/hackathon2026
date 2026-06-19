import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

import { createForWorkspace } from '../../../workspace/index.js';
import { DevSupervisorError } from '../../../services/DevSupervisorClient.js';
import { appsRouter } from '../apps.js';

const mockCreateForWorkspace = vi.mocked(createForWorkspace);

const createTestApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.agentContext = { siteId: 'local-dev-site' };
    next();
  });
  app.use('/apps', appsRouter);
  return app;
};

describe('GET /apps/:id/files/read', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('should return 400 when filePath is missing', async () => {
    const response = await request(app)
      .get('/apps/abc1234567/files/read')
      .expect(400);

    expect(response.body.error).toBe('File path is required');
  });

  it('should return 404 when workspace not found', async () => {
    mockCreateForWorkspace.mockReturnValue(null);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=src/app.tsx')
      .expect(404);

    expect(response.body.error).toBe('App not found');
    expect(mockCreateForWorkspace).toHaveBeenCalledWith('abc1234567', 'preview');
  });

  it('should return 422 for binary files', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: {
        view: vi.fn().mockResolvedValue({
          path: 'logo.png',
          content: 'iVBORw0KGgo=',
          encoding: 'base64',
          lines: 0,
          size: 1024,
          truncated: false,
        }),
      },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=logo.png')
      .expect(422);

    expect(response.body.error).toContain('Binary file');
    expect(response.body.encoding).toBe('base64');
  });

  it('should return file content with totalLines', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: {
        view: vi.fn().mockResolvedValue({
          path: 'src/app.tsx',
          content: 'import React from "react";\n\nexport default function App() {}',
          encoding: 'utf-8',
          lines: 3,
          size: 59,
          truncated: false,
        }),
      },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=src/app.tsx')
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.path).toBe('src/app.tsx');
    expect(response.body.totalLines).toBe(3);
    expect(response.body.content).toContain('import React');
    expect(response.body.truncated).toBe(false);
  });

  it('should propagate truncated flag', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: {
        view: vi.fn().mockResolvedValue({
          path: 'big-file.ts',
          content: 'line1\nline2',
          encoding: 'utf-8',
          lines: 5000,
          size: 50000,
          truncated: true,
        }),
      },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=big-file.ts')
      .expect(200);

    expect(response.body.truncated).toBe(true);
    expect(response.body.totalLines).toBe(5000);
    expect(response.body.linesRead).toEqual({ start: 1, end: 2 });
  });

  it('forwards a valid limit to view() so whole-file reads bypass the default cap', async () => {
    const view = vi.fn().mockResolvedValue({
      path: '.source-site/assets/manifest.json',
      content: '{}',
      encoding: 'utf-8',
      lines: 1,
      size: 2,
      truncated: false,
    });
    mockCreateForWorkspace.mockReturnValue({ files: { view } } as any);

    await request(app)
      .get('/apps/abc1234567/files/read?path=.source-site/assets/manifest.json&limit=1000000')
      .expect(200);

    expect(view).toHaveBeenCalledWith({ path: '.source-site/assets/manifest.json', limit: 1000000 });
  });

  it('omits limit (uses supervisor default) when the param is absent or invalid', async () => {
    const view = vi.fn().mockResolvedValue({
      path: 'src/app.tsx', content: 'x', encoding: 'utf-8', lines: 1, size: 1, truncated: false,
    });
    mockCreateForWorkspace.mockReturnValue({ files: { view } } as any);

    await request(app).get('/apps/abc1234567/files/read?path=src/app.tsx&limit=abc').expect(200);

    expect(view).toHaveBeenCalledWith({ path: 'src/app.tsx' });
  });

  it('maps a dev-supervisor not_found to 404 (benign absence, not a 500)', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { view: vi.fn().mockRejectedValue(new DevSupervisorError('not_found', 404, 'no such file')) },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=.source-site/pages/missing.json')
      .expect(404);

    expect(response.body.error).toBe('File not found');
  });

  it('maps a dev-supervisor permission_denied to 403', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { view: vi.fn().mockRejectedValue(new DevSupervisorError('permission_denied', 403, 'denied')) },
    } as any);

    await request(app).get('/apps/abc1234567/files/read?path=secret').expect(403);
  });

  it('returns 500 for a non-dev-supervisor error', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { view: vi.fn().mockRejectedValue(new Error('boom')) },
    } as any);

    await request(app).get('/apps/abc1234567/files/read?path=src/app.tsx').expect(500);
  });
});
