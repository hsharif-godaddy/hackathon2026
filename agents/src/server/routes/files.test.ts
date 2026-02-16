import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { filesRouter } from './files.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { existsSync } from 'fs';
import { rm, mkdir } from 'fs/promises';

// Mock authentication middleware
vi.mock('../middleware/jwt-auth.js', () => ({
  AuthenticatedRequest: {}
}));

// Mock app ownership validation
vi.mock('../middleware/app-ownership.js', () => ({
  validateAppOwnershipFromBody: (field: string) => (req: any, res: any, next: any) => {
    // For tests, allow 'test-app' only
    const appId = req.body[field];
    if (appId === 'test-app') {
      req.agentContext = { siteId: 'test-app' };
      return next();
    }
    return res.status(403).json({ error: 'Access denied' });
  },
  validateAppIdParam: (req: any, res: any, next: any) => {
    const authenticatedSiteId = req.agentContext?.siteId;
    const requestedAppId = req.params.appId;

    if (!authenticatedSiteId || authenticatedSiteId !== requestedAppId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  }
}));

// Mock file upload service
vi.mock('../../services/FileUploadService.js', () => {
  const mockService = {
    processUpload: vi.fn(),
    getUpload: vi.fn(),
    deleteUpload: vi.fn(),
    listUploadedFiles: vi.fn(),
    getAppUploadsDir: vi.fn(),
    getFilePath: vi.fn()
  };

  return {
    fileUploadService: mockService,
    FileUploadService: vi.fn(() => mockService)
  };
});

describe('Files Router - Path Traversal Security', () => {
  let app: Application;
  const testUploadDir = '/tmp/test-uploads-security';

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(testUploadDir)) {
      await rm(testUploadDir, { recursive: true, force: true });
    }
    await mkdir(testUploadDir, { recursive: true });

    // Setup express app
    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Add authentication middleware mock
    app.use((req: any, res, next) => {
      req.agentContext = { siteId: 'test-app' };
      next();
    });

    app.use('/files', filesRouter);

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (existsSync(testUploadDir)) {
      await rm(testUploadDir, { recursive: true, force: true });
    }
  });

  describe('GET /files/uploads/:appId/:filename - Path Traversal Protection', () => {
    it('should reject path traversal with .. sequences', async () => {
      const response = await request(app)
        .get('/files/uploads/test-app/../../etc/passwd')
        .set('Authorization', 'Bearer valid-token');

      // Should either be 403 (caught by validation) or 404 (path sanitized, file not found)
      expect([403, 404]).toContain(response.status);
    });

    it('should reject absolute path in filename', async () => {
      const response = await request(app)
        .get('/files/uploads/test-app//etc/passwd')
        .set('Authorization', 'Bearer valid-token');

      expect([403, 404]).toContain(response.status);
    });

    it('should reject null byte injection', async () => {
      const response = await request(app)
        .get('/files/uploads/test-app/file%00.txt')
        .set('Authorization', 'Bearer valid-token');

      // Should be sanitized and result in 404 (file doesn't exist)
      expect([403, 404]).toContain(response.status);
    });

    it('should reject encoded traversal sequences', async () => {
      const response = await request(app)
        .get('/files/uploads/test-app/%2e%2e%2f%2e%2e%2fetc%2fpasswd')
        .set('Authorization', 'Bearer valid-token');

      expect([403, 404]).toContain(response.status);
    });

    it('should reject Windows device names', async () => {
      const deviceNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];

      for (const deviceName of deviceNames) {
        const response = await request(app)
          .get(`/files/uploads/test-app/${deviceName}`)
          .set('Authorization', 'Bearer valid-token');

        // Should be rejected or sanitized
        expect([403, 404]).toContain(response.status);
      }
    });

    it('should reject cross-tenant access attempts', async () => {
      const response = await request(app)
        .get('/files/uploads/other-app/legitimate-file.txt')
        .set('Authorization', 'Bearer valid-token');

      // Should be rejected by ownership validation
      expect(response.status).toBe(403);
    });

    it('should allow legitimate file requests within app directory', async () => {
      // Mock the file upload service to return a valid file
      const { fileUploadService } = await import('../../services/FileUploadService.js');
      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        {
          id: 'file_abc123',
          originalName: 'legitimate-file.png',
          filename: 'test-app_1234567890_file_abc123.png',
          size: 1024,
          mimeType: 'image/png',
          uploadedAt: new Date().toISOString()
        }
      ]);

      const response = await request(app)
        .get('/files/uploads/test-app/test-app_1234567890_file_abc123.png')
        .set('Authorization', 'Bearer valid-token');

      // File doesn't exist on disk but should pass validation
      // Real implementation would return 404 or 200 depending on file existence
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('GET /files/:appId/:uploadId - Path Traversal Protection', () => {
    it('should reject path traversal in appId parameter', async () => {
      const response = await request(app)
        .get('/files/../../../etc/upload_123')
        .set('Authorization', 'Bearer valid-token');

      // Should be caught by validation middleware
      expect(response.status).toBe(403);
    });

    it('should reject path traversal in uploadId parameter', async () => {
      const response = await request(app)
        .get('/files/test-app/../../etc/passwd')
        .set('Authorization', 'Bearer valid-token');

      // Should be sanitized or rejected
      expect([403, 404]).toContain(response.status);
    });
  });

  describe('DELETE /files/:appId/:uploadId - Path Traversal Protection', () => {
    it('should reject path traversal in appId parameter', async () => {
      const response = await request(app)
        .delete('/files/../../../etc/upload_123')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(403);
    });

    it('should reject path traversal in uploadId parameter', async () => {
      const response = await request(app)
        .delete('/files/test-app/../../etc/passwd')
        .set('Authorization', 'Bearer valid-token');

      expect([403, 404]).toContain(response.status);
    });

    it('should reject cross-tenant deletion attempts', async () => {
      const response = await request(app)
        .delete('/files/other-app/upload_123')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(403);
    });
  });

  describe('POST /files/upload - Path Traversal Protection', () => {
    it('should reject path traversal in appId field', async () => {
      const response = await request(app)
        .post('/files/upload')
        .field('appId', '../../etc')
        .attach('files', Buffer.from('test'), 'passwd')
        .set('Authorization', 'Bearer valid-token');

      // Should be caught by ownership validation
      expect(response.status).toBe(403);
    });

    it('should accept valid appId and sanitize filename', async () => {
      const { fileUploadService } = await import('../../services/FileUploadService.js');
      vi.mocked(fileUploadService.processUpload).mockResolvedValue({
        uploadId: 'upload_abc123',
        appId: 'test-app',
        files: [{
          id: 'file_xyz789',
          originalName: 'test.png',
          filename: 'test-app_1234567890_file_xyz789.png',
          size: 1024,
          mimeType: 'image/png',
          uploadedAt: new Date().toISOString()
        }],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });

      const response = await request(app)
        .post('/files/upload')
        .field('appId', 'test-app')
        .attach('files', Buffer.from('test'), 'test.png')
        .set('Authorization', 'Bearer valid-token');

      // Should succeed
      expect(response.status).toBe(200);
    });
  });
});
