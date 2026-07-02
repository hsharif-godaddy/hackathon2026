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

  it('should return 422 for binary files based on extension', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn() },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=public/assets/logo.png')
      .expect(422);

    expect(response.body.error).toContain('Binary file');
  });

  it('should return file content with totalLines', async () => {
    const content = 'import React from "react";\n\nexport default function App() {}';
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockResolvedValue(content) },
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

  it('reads .ts files as text (not video/mp2t)', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockResolvedValue('const x: number = 1;') },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=src/utils.ts')
      .expect(200);

    expect(response.body.content).toBe('const x: number = 1;');
  });

  it('reads .svg files as text (XML, not binary)', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockResolvedValue(svg) },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=public/assets/logo.svg')
      .expect(200);

    expect(response.body.content).toBe(svg);
  });

  it('reads extensionless files as text', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockResolvedValue('FROM node:20') },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=Dockerfile')
      .expect(200);

    expect(response.body.content).toBe('FROM node:20');
  });

  it('maps a dev-supervisor not_found to 404 (benign absence, not a 500)', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockRejectedValue(new DevSupervisorError('not_found', 404, 'no such file')) },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=.source-site/pages/missing.json')
      .expect(404);

    expect(response.body.error).toBe('File not found');
  });

  it('maps a dev-supervisor permission_denied to 403', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockRejectedValue(new DevSupervisorError('permission_denied', 403, 'denied')) },
    } as any);

    await request(app).get('/apps/abc1234567/files/read?path=secret').expect(403);
  });

  it('returns 500 for a non-dev-supervisor error', async () => {
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockRejectedValue(new Error('boom')) },
    } as any);

    await request(app).get('/apps/abc1234567/files/read?path=src/app.tsx').expect(500);
  });

  it('returns raw content suitable for JSON.parse (no line-number prefixes)', async () => {
    const jsonContent = '{"skills":["stripe","google-analytics"],"version":1}';
    mockCreateForWorkspace.mockReturnValue({
      files: { readText: vi.fn().mockResolvedValue(jsonContent) },
    } as any);

    const response = await request(app)
      .get('/apps/abc1234567/files/read?path=.airo/skills/applied.json')
      .expect(200);

    const parsed: unknown = JSON.parse(response.body.content);
    expect(parsed).toEqual({ skills: ['stripe', 'google-analytics'], version: 1 });
  });
});
