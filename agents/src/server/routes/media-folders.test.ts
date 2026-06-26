import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

// Mock AppRepository
const appRepoFindByIdMock = vi.fn();
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function () {
    return { findById: appRepoFindByIdMock };
  }),
}));

// Mock middleware
vi.mock('../middleware/app-ownership.js', () => ({
  validateAppOwnership: (_req: any, _res: any, next: any) => next(),
}));

// Mock services that other parts of media.ts depend on
vi.mock('../../services/MediaManifestService.js', () => ({
  getMediaManifestService: vi.fn(() => ({
    getSlot: vi.fn(),
    updateSlot: vi.fn(),
    updateSlotOrFork: vi.fn(),
  })),
  MediaManifestService: vi.fn(),
}));

vi.mock('../../services/FileUploadService.js', () => ({
  fileUploadService: {
    processUpload: vi.fn(),
    deleteUploadedFile: vi.fn(),
    listUploadedFiles: vi.fn(),
  },
}));

vi.mock('../../services/media-upload-video.js', () => ({
  VIDEO_MIME_TYPE: {},
  processVideoUpload: vi.fn(),
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn(),
}));

vi.mock('../middleware/jwt-auth.js', () => ({}));

vi.mock('../../lib/jwt-validator.js', () => ({
  JwtValidator: vi.fn(),
}));

vi.mock('../../logging/index.js', () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    Logger: { create: () => mockLogger },
    logger: mockLogger,
  };
});

vi.mock('../../config/index.js', () => ({
  config: { dataDir: '/tmp', port: 4000, env: 'test' },
}));

describe('Media Folder Routes', () => {
  let app: express.Application;
  let testAppPath: string;

  beforeEach(async () => {
    testAppPath = path.join(tmpdir(), `media-folder-test-${Date.now()}`);
    await mkdir(testAppPath, { recursive: true });

    appRepoFindByIdMock.mockReturnValue({ id: 'test-app', path: testAppPath, name: 'Test App' });

    // Dynamically import after mocks are set
    const mediaModule = await import('./media.js');
    app = express();
    app.use(express.json());
    app.use('/media', mediaModule.default);
  });

  afterEach(async () => {
    if (existsSync(testAppPath)) {
      await rm(testAppPath, { recursive: true, force: true });
    }
  });

  describe('GET /media/:appId/folders', () => {
    it('returns empty array when no folders file exists', async () => {
      const res = await request(app).get('/media/test-app/folders');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.folders).toEqual([]);
    });

    it('returns 404 when app not found', async () => {
      appRepoFindByIdMock.mockReturnValue(null);
      const res = await request(app).get('/media/unknown-app/folders');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /media/:appId/folders', () => {
    it('creates a folder', async () => {
      const res = await request(app)
        .post('/media/test-app/folders')
        .send({ name: 'My Folder' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.folder.name).toBe('My Folder');
      expect(res.body.folder.id).toBeDefined();
    });

    it('rejects empty name', async () => {
      const res = await request(app)
        .post('/media/test-app/folders')
        .send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects duplicate folder name', async () => {
      await request(app).post('/media/test-app/folders').send({ name: 'Dup' });
      const res = await request(app).post('/media/test-app/folders').send({ name: 'Dup' });
      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /media/:appId/folders/:folderId', () => {
    it('deletes an existing folder', async () => {
      const createRes = await request(app)
        .post('/media/test-app/folders')
        .send({ name: 'ToDelete' });
      const folderId = createRes.body.folder.id;

      const res = await request(app).delete(`/media/test-app/folders/${folderId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for unknown folder', async () => {
      const res = await request(app).delete('/media/test-app/folders/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /media/:appId/folders/:folderId/move', () => {
    it('moves a slot into a folder', async () => {
      const createRes = await request(app)
        .post('/media/test-app/folders')
        .send({ name: 'Target' });
      const folderId = createRes.body.folder.id;

      const res = await request(app)
        .post(`/media/test-app/folders/${folderId}/move`)
        .send({ slotName: 'hero/image-1' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.folder.slots).toContain('hero/image-1');
    });

    it('rejects missing slotName', async () => {
      const createRes = await request(app)
        .post('/media/test-app/folders')
        .send({ name: 'Target2' });
      const folderId = createRes.body.folder.id;

      const res = await request(app)
        .post(`/media/test-app/folders/${folderId}/move`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('removes slot from previous folder when moved to a new one', async () => {
      const folderA = await request(app).post('/media/test-app/folders').send({ name: 'FolderA' });
      const folderB = await request(app).post('/media/test-app/folders').send({ name: 'FolderB' });

      // Move slot to folder A first
      await request(app)
        .post(`/media/test-app/folders/${folderA.body.folder.id}/move`)
        .send({ slotName: 'hero/banner' });

      // Now move same slot to folder B
      const res = await request(app)
        .post(`/media/test-app/folders/${folderB.body.folder.id}/move`)
        .send({ slotName: 'hero/banner' });

      expect(res.status).toBe(200);
      expect(res.body.folder.slots).toContain('hero/banner');

      // Verify folder A no longer has the slot
      const foldersRes = await request(app).get('/media/test-app/folders');
      const updatedA = foldersRes.body.folders.find((f: any) => f.id === folderA.body.folder.id);
      expect(updatedA.slots).not.toContain('hero/banner');
    });
  });

  describe('POST /media/:appId/folders/:folderId/remove', () => {
    it('removes a slot from a folder', async () => {
      const createRes = await request(app).post('/media/test-app/folders').send({ name: 'RemSlot' });
      const folderId = createRes.body.folder.id;
      await request(app).post(`/media/test-app/folders/${folderId}/move`).send({ slotName: 'hero/img' });

      const res = await request(app)
        .post(`/media/test-app/folders/${folderId}/remove`)
        .send({ slotName: 'hero/img' });
      expect(res.status).toBe(200);

      const foldersRes = await request(app).get('/media/test-app/folders');
      const updated = foldersRes.body.folders.find((f: any) => f.id === folderId);
      expect(updated.slots).not.toContain('hero/img');
    });

    it('rejects missing slotName', async () => {
      const createRes = await request(app).post('/media/test-app/folders').send({ name: 'RemBad' });
      const res = await request(app)
        .post(`/media/test-app/folders/${createRes.body.folder.id}/remove`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown folder', async () => {
      const res = await request(app)
        .post('/media/test-app/folders/nonexistent/remove')
        .send({ slotName: 'x' });
      expect(res.status).toBe(404);
    });
  });
});
