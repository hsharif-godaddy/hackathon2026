import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import { filesRouter, filesPublicRouter } from './files.js';
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
    FileUploadService: vi.fn(function () { return mockService; })
  };
});

// Mock AppRepository so route can look up app.path without a real SQLite db.
// vi.mock() factories are hoisted above top-level vars, so use vi.hoisted() to
// share the mock fn between the factory and individual tests.
const { appRepoFindByIdMock } = vi.hoisted(() => ({ appRepoFindByIdMock: vi.fn() }));
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn(function () { return {
    findById: appRepoFindByIdMock
  }; })
}));

// Mock file URL signer for signed URL tests
vi.mock('../../utils/file-url-signer.js', () => ({
  signFileUrl: (appId: string, filename: string) => {
    const exp = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
    return `/files/uploads/${appId}/${filename}?sig=mock-sig&exp=${exp}`;
  },
  verifyFileSignature: (appId: string, filename: string, sig: string, exp: number) => {
    // Check expiration first
    if (exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    // Only accept a specific valid signature for testing
    return sig === 'valid-test-signature';
  }
}));

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

    // Public router for signed URL file serving (no auth required)
    app.use('/files', filesPublicRouter);
    // Protected router for file operations
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

      // Should be sanitized and result in 404 (file doesn't exist) or 500 (server error handling malformed input)
      expect([403, 404, 500]).toContain(response.status);
    });

    it('should reject encoded traversal sequences', async () => {
      const response = await request(app)
        .get('/files/uploads/test-app/%2e%2e%2f%2e%2e%2fetc%2fpasswd')
        .set('Authorization', 'Bearer valid-token');

      expect([403, 404, 500]).toContain(response.status);
    });

    it('should reject Windows device names', async () => {
      const deviceNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1'];

      for (const deviceName of deviceNames) {
        const response = await request(app)
          .get(`/files/uploads/test-app/${deviceName}`)
          .set('Authorization', 'Bearer valid-token');

        // Should be rejected, sanitized, or return server error
        expect([403, 404, 500]).toContain(response.status);
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

      // Express normalizes paths with ".." before route matching, so this may
      // result in 404 (no matching route) or 403 (caught by validation middleware)
      expect([403, 404]).toContain(response.status);
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

      // Express normalizes paths with ".." before route matching, so this may
      // result in 404 (no matching route) or 403 (caught by validation middleware)
      expect([403, 404]).toContain(response.status);
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
        failedFiles: [],
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

  describe('GET /files/uploads/:appId/:filename - Signed URL Authentication', () => {
    it('should reject expired signed URL', async () => {
      const expiredExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

      const response = await request(app)
        .get(`/files/uploads/test-app/test.jpg?sig=fake-sig&exp=${expiredExp}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should reject invalid signature', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;

      const response = await request(app)
        .get(`/files/uploads/test-app/test.jpg?sig=invalid-signature&exp=${futureExp}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid or expired');
    });

    it('should accept valid signed URL without JWT and serve file', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const { fileUploadService } = await import('../../services/FileUploadService.js');

      // Mock file exists in listing
      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        {
          id: 'file_abc123',
          originalName: 'test.jpg',
          filename: 'test.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          uploadedAt: new Date().toISOString()
        }
      ]);

      // Mock file path resolution
      vi.mocked(fileUploadService.getAppUploadsDir).mockReturnValue(testUploadDir);
      vi.mocked(fileUploadService.getFilePath).mockReturnValue(`${testUploadDir}/upload_123/test.jpg`);

      // Create the test file on disk
      const { writeFile } = await import('fs/promises');
      await mkdir(`${testUploadDir}/upload_123`, { recursive: true });
      await writeFile(`${testUploadDir}/upload_123/test.jpg`, Buffer.from('test image data'));

      // Request WITHOUT JWT but WITH valid signature
      const response = await request(app)
        .get(`/files/uploads/test-app/test.jpg?sig=valid-test-signature&exp=${futureExp}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    });

    it('should reject array values for sig parameter', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;

      const response = await request(app)
        .get(`/files/uploads/test-app/test.jpg?sig=sig1&sig=sig2&exp=${futureExp}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid signature');
    });
  });

  describe('GET /files/uploads/:appId/:filename - HTML/XML Force Download', () => {
    const cases: Array<{ filename: string; mimeType: string }> = [
      { filename: 'reference.html', mimeType: 'text/html' },
      { filename: 'page.htm', mimeType: 'text/html' },
      { filename: 'doc.xhtml', mimeType: 'application/xhtml+xml' },
      { filename: 'sitemap.xml', mimeType: 'application/xml' },
      { filename: 'feed.xml', mimeType: 'text/xml' },
      { filename: 'transform.xsl', mimeType: 'application/xml' },
      { filename: 'transform.xslt', mimeType: 'application/xml' }
    ];

    it.each(cases)(
      'serves $filename as a non-renderable attachment',
      async ({ filename, mimeType }) => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        const { fileUploadService } = await import('../../services/FileUploadService.js');

        vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
          {
            id: 'file_html',
            originalName: filename,
            filename,
            size: 50,
            mimeType,
            uploadedAt: new Date().toISOString()
          }
        ]);

        vi.mocked(fileUploadService.getAppUploadsDir).mockReturnValue(testUploadDir);
        vi.mocked(fileUploadService.getFilePath).mockReturnValue(
          `${testUploadDir}/upload_html/${filename}`
        );

        const { writeFile } = await import('fs/promises');
        await mkdir(`${testUploadDir}/upload_html`, { recursive: true });
        await writeFile(
          `${testUploadDir}/upload_html/${filename}`,
          Buffer.from('<script>alert(1)</script>')
        );

        const response = await request(app).get(
          `/files/uploads/test-app/${filename}?sig=valid-test-signature&exp=${futureExp}`
        );

        expect(response.status).toBe(200);
        // Browser must not render this as HTML/XML
        expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
        // Must be downloaded, not rendered inline
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename="${filename}"`
        );
        expect(response.headers['x-content-type-options']).toBe('nosniff');
      }
    );

    it('still serves images inline with their declared content-type', async () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const { fileUploadService } = await import('../../services/FileUploadService.js');

      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        {
          id: 'file_jpg',
          originalName: 'photo.jpg',
          filename: 'photo.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          uploadedAt: new Date().toISOString()
        }
      ]);

      vi.mocked(fileUploadService.getAppUploadsDir).mockReturnValue(testUploadDir);
      vi.mocked(fileUploadService.getFilePath).mockReturnValue(
        `${testUploadDir}/upload_jpg/photo.jpg`
      );

      const { writeFile } = await import('fs/promises');
      await mkdir(`${testUploadDir}/upload_jpg`, { recursive: true });
      await writeFile(`${testUploadDir}/upload_jpg/photo.jpg`, Buffer.from('jpg-data'));

      const response = await request(app).get(
        `/files/uploads/test-app/photo.jpg?sig=valid-test-signature&exp=${futureExp}`
      );

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.headers['content-disposition']).toBeUndefined();
    });
  });

  describe('GET /files/:appId/list - Signed URLs in Response', () => {
    it('should include signedUrl for each file in list response', async () => {
      const { fileUploadService } = await import('../../services/FileUploadService.js');

      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        {
          id: 'file_abc123',
          originalName: 'test1.jpg',
          filename: 'test1.jpg',
          size: 100,
          mimeType: 'image/jpeg',
          uploadedAt: new Date().toISOString()
        },
        {
          id: 'file_def456',
          originalName: 'test2.png',
          filename: 'test2.png',
          size: 200,
          mimeType: 'image/png',
          uploadedAt: new Date().toISOString()
        }
      ]);

      const response = await request(app)
        .get('/files/test-app/list')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.files).toHaveLength(2);

      // Each file should have a signedUrl
      for (const file of response.body.files) {
        expect(file.signedUrl).toBeDefined();
        expect(file.signedUrl).toMatch(/^\/files\/uploads\/test-app\/.+\?sig=.+&exp=\d+$/);
      }
    });

    it('should return empty list when no files exist', async () => {
      const { fileUploadService } = await import('../../services/FileUploadService.js');

      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([]);

      const response = await request(app)
        .get('/files/test-app/list')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.files).toHaveLength(0);
    });
  });

  describe('POST /files/upload - Persist to project docs/', () => {
    const projectRoot = '/tmp/test-uploads-docs-project';
    const uploadsRoot = '/tmp/test-uploads-docs-source';

    beforeEach(async () => {
      for (const dir of [projectRoot, uploadsRoot]) {
        if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
      }
      await mkdir(projectRoot, { recursive: true });
      await mkdir(`${uploadsRoot}/upload_docs`, { recursive: true });
      appRepoFindByIdMock.mockReset();
    });

    afterEach(async () => {
      for (const dir of [projectRoot, uploadsRoot]) {
        if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
      }
    });

    // FileUploadService stores files under a sanitized `filename` (not originalName),
    // so the source on disk uses a safe name regardless of what the user named the file.
    async function runUpload(originalName: string, mimeType: string, body: string) {
      const { fileUploadService } = await import('../../services/FileUploadService.js');
      const storedFilename = `stored_${Math.random().toString(36).slice(2, 10)}.bin`;
      const sourcePath = `${uploadsRoot}/upload_docs/${storedFilename}`;
      const { writeFile } = await import('fs/promises');
      await writeFile(sourcePath, body);

      vi.mocked(fileUploadService.processUpload).mockResolvedValue({
        uploadId: 'upload_docs',
        appId: 'test-app',
        files: [{
          id: 'file_1',
          originalName,
          filename: storedFilename,
          size: body.length,
          mimeType,
          uploadedAt: new Date().toISOString()
        }],
        failedFiles: [],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
      vi.mocked(fileUploadService.getFilePath).mockImplementation(
        function (_appId: string, uploadId: string, filename: string) { return `${uploadsRoot}/${uploadId}/${filename}`; }
      );

      return request(app)
        .post('/files/upload')
        .field('appId', 'test-app')
        .attach('files', Buffer.from(body), originalName)
        .set('Authorization', 'Bearer valid-token');
    }

    it('copies non-image uploads into <app.path>/docs/', async () => {
      appRepoFindByIdMock.mockReturnValue({ id: 'test-app', path: projectRoot });

      const response = await runUpload(
        'bakery-products.xml',
        'application/xml',
        '<bakery><name>Sunrise</name></bakery>'
      );

      expect(response.status).toBe(200);
      expect(existsSync(`${projectRoot}/docs/bakery-products.xml`)).toBe(true);
    });

    it('does not copy images into docs/ (auto-resolve handles those)', async () => {
      appRepoFindByIdMock.mockReturnValue({ id: 'test-app', path: projectRoot });

      const response = await runUpload('photo.png', 'image/png', 'fake-png-bytes');

      expect(response.status).toBe(200);
      expect(existsSync(`${projectRoot}/docs/photo.png`)).toBe(false);
    });

    it('skips docs/ copy when no app record (PaaS / unregistered app)', async () => {
      appRepoFindByIdMock.mockReturnValue(null);

      const response = await runUpload('reference.html', 'text/html', '<p>hi</p>');

      expect(response.status).toBe(200);
      expect(existsSync(`${projectRoot}/docs/reference.html`)).toBe(false);
    });

    it('rejects path-escape attempts in originalName via basename()', async () => {
      appRepoFindByIdMock.mockReturnValue({ id: 'test-app', path: projectRoot });

      // basename() reduces "../../etc/passwd" to "passwd" — file lands as docs/passwd, not above projectRoot.
      const response = await runUpload('../../etc/passwd', 'text/plain', 'malicious');

      expect(response.status).toBe(200);
      expect(existsSync(`${projectRoot}/docs/passwd`)).toBe(true);
      // No file outside the docs dir was written.
      expect(existsSync(`${projectRoot}/../etc/passwd`)).toBe(false);
    });

    it('does not fail the upload if docs/ copy fails', async () => {
      // Point app.path at a path that does not exist and cannot be created (file collision).
      const blockingFile = `/tmp/test-uploads-docs-blocking-${Date.now()}`;
      const { writeFile } = await import('fs/promises');
      await writeFile(blockingFile, 'i am a file, not a directory');
      try {
        appRepoFindByIdMock.mockReturnValue({ id: 'test-app', path: blockingFile });

        const response = await runUpload('note.txt', 'text/plain', 'hello');

        // Upload still succeeds even when the docs/ copy cannot be performed.
        expect(response.status).toBe(200);
      } finally {
        await rm(blockingFile, { force: true });
      }
    });
  });

  describe('POST /files/upload - Multer Error Handling', () => {
    it('should return 400 when file exceeds 25MB size limit', async () => {
      const largeBuffer = Buffer.alloc(26 * 1024 * 1024);

      const response = await request(app)
        .post('/files/upload')
        .field('appId', 'test-app')
        .attach('files', largeBuffer, 'huge-file.png')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('25MB');
    });

    it('should return 400 when more than 5 files are uploaded', async () => {
      const req = request(app)
        .post('/files/upload')
        .field('appId', 'test-app')
        .set('Authorization', 'Bearer valid-token');

      for (let i = 0; i < 6; i++) {
        req.attach('files', Buffer.from('content'), `file${i}.png`);
      }

      const response = await req;

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('5 files');
    });

    it('should return 400 with descriptive error for sanitization failures', async () => {
      const { SVGSanitizationError } = await import('../../services/errors/file-upload-errors.js');
      const { fileUploadService } = await import('../../services/FileUploadService.js');
      vi.mocked(fileUploadService.processUpload).mockRejectedValue(
        new SVGSanitizationError('icon.svg')
      );

      const response = await request(app)
        .post('/files/upload')
        .field('appId', 'test-app')
        .attach('files', Buffer.from('<svg>test</svg>'), 'icon.svg')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Failed to sanitize');
    });
  });
});
