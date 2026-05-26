import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import sharp from 'sharp';

// Mock the app-ownership middleware to bypass authentication
vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: vi.fn((req, res, next) => next()),
}));

// Mock persistent assets helper to use test paths
vi.mock('../../../utils/persistent-assets.js', () => ({
  getPersistentPublicDir: vi.fn((appPath: string) => `${appPath}/public`),
}));

// Mock dependencies
vi.mock('../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    getSlot: vi.fn(),
    updateSlotWithUpload: vi.fn(),
    getManifest: vi.fn(),
    updateSlot: vi.fn(),
    removeUploadedUrls: vi.fn(),
    removeUploadedUrlsFromSlot: vi.fn(),
  },
}));

vi.mock('../../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
  })),
}));

vi.mock('../../../services/FileUploadService.js', () => ({
  fileUploadService: {
    findUploadedFilePath: vi.fn().mockResolvedValue(null),
    processUpload: vi.fn().mockResolvedValue({ files: [] }),
    deleteUploadedFile: vi.fn().mockResolvedValue({ deleted: false }),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

describe('POST /media/:appId/slots/:slotName/upload', () => {
  let app: express.Application;

  beforeAll(async () => {
    // Import after mocks are set up
    const { default: mediaRouter } = await import('../media.js');
    app = express();
    app.use('/media', mediaRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject non-image files', async () => {
    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', Buffer.from('not an image'), {
        filename: 'test.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Only JPEG, PNG, WebP, and GIF images are supported');
  });

  it('should reject files larger than 10MB', async () => {
    // Create a buffer larger than 10MB
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', largeBuffer, {
        filename: 'large.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('10MB');
  });

  it('should reject files with valid MIME type but invalid magic bytes', async () => {
    // Send random bytes claiming to be JPEG
    const fakeImage = Buffer.from('This is not a real image file at all');

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', fakeImage, {
        filename: 'fake.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('does not match');
  });

  it('should accept valid image upload', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: 'https://media.gettyimages.com/old.jpg',
        searchQuery: 'hero image',
        alternatives: [],
        userModified: false,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    });
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: '/airo-assets/uploads/hero-abc123.jpg',
        searchQuery: 'hero image',
        alternatives: ['https://media.gettyimages.com/old.jpg'],
        userModified: true,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    });

    // Create a valid test image
    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .attach('image', testImage, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.uploadedUrl).toContain('/airo-assets/uploads/');
  });

  it('should return 400 when no file is provided', async () => {
    const response = await request(app).post('/media/test-app/slots/hero/upload');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('No image file provided');
  });

  it('should return 404 when slot does not exist', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: false,
      error: 'Slot not found: nonexistent',
    });

    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const response = await request(app)
      .post('/media/test-app/slots/nonexistent/upload')
      .attach('image', testImage, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toContain('Slot not found');
  });

  it('should handle nested slot names with slashes', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: 'https://example.com/old.jpg',
        searchQuery: 'test',
        alternatives: [],
        userModified: false,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    });
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'image',
        currentUrl: '/airo-assets/uploads/components-hero-section-abc123.jpg',
        searchQuery: 'test',
        alternatives: ['https://example.com/old.jpg'],
        userModified: true,
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      },
    });

    const testImage = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 0, g: 255, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    const response = await request(app)
      .post('/media/test-app/slots/components/hero/section/upload')
      .attach('image', testImage, {
        filename: 'test.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mediaManifestService.getSlot).toHaveBeenCalledWith(
      'test-app',
      'components/hero/section'
    );
  });
});

// Helper to build a minimal valid JPEG buffer
async function makeJpeg() {
  return sharp({
    create: { width: 10, height: 10, channels: 3, background: { r: 100, g: 100, b: 100 } },
  })
    .jpeg()
    .toBuffer();
}

// Minimal slot fixture
function makeSlot(currentUrl: string, uploadSources?: Record<string, string>) {
  return {
    mediaType: 'image' as const,
    currentUrl,
    searchQuery: '',
    alternatives: [],
    userModified: true,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    ...(uploadSources ? { uploadSources } : {}),
  };
}

describe('POST /media/:appId/slots/:slotName/upload — overwriteFilename', () => {
  let app: express.Application;

  beforeAll(async () => {
    const { default: mediaRouter } = await import('../media.js');
    app = express();
    app.use('/media', mediaRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('overwrites file in place and skips manifest update', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const overwriteFilename = 'hero-abc12345.jpg';
    const uploadedUrl = `/airo-assets/uploads/${overwriteFilename}`;

    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot(uploadedUrl),
    });
    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: { hero: makeSlot(uploadedUrl) },
    });

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .field('overwriteFilename', overwriteFilename)
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.uploadedUrl).toBe(uploadedUrl);
    expect(response.body.affectedSlots).toEqual([]);
    // Manifest must NOT be updated for an in-place overwrite
    expect(mediaManifestService.updateSlotWithUpload).not.toHaveBeenCalled();
  });

  it('also updates the chat copy when uploadSources maps the overwritten URL', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');
    const fs = await import('fs/promises');

    const overwriteFilename = 'hero-abc12345.jpg';
    const uploadedUrl = `/airo-assets/uploads/${overwriteFilename}`;
    const chatFilename = 'original-chat-upload.jpg';
    const chatFilePath = '/tmp/test-app/uploads/u1/original-chat-upload.jpg';

    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot(uploadedUrl, { [uploadedUrl]: chatFilename }),
    });
    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: { hero: makeSlot(uploadedUrl, { [uploadedUrl]: chatFilename }) },
    });
    vi.mocked(fileUploadService.findUploadedFilePath).mockResolvedValue(chatFilePath);

    await request(app)
      .post('/media/test-app/slots/hero/upload')
      .field('overwriteFilename', overwriteFilename)
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    // Should have written to the chat file path
    expect(fileUploadService.findUploadedFilePath).toHaveBeenCalledWith('test-app', chatFilename);
    expect(fs.default.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(chatFilePath),
      expect.any(Buffer)
    );
  });

  it('returns affectedSlots for slots sharing the same persistent URL (Case A)', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');

    const overwriteFilename = 'espresso-abc12345.jpg';
    const uploadedUrl = `/airo-assets/uploads/${overwriteFilename}`;

    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot(uploadedUrl),
    });
    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: {
        'menu/espresso': makeSlot(uploadedUrl),
        'menu/latte': makeSlot(uploadedUrl), // same URL — Case A
      },
    });

    const response = await request(app)
      .post('/media/test-app/slots/menu/espresso/upload')
      .field('overwriteFilename', overwriteFilename)
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.body.affectedSlots).toEqual(['menu/latte']);
  });

  it('overwrites sibling files and returns affectedSlots for same-source slots (Case B)', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');
    const fs = await import('fs/promises');

    const espressoFilename = 'menu-espresso-abc12345.jpg';
    const latteFilename = 'menu-latte-def67890.jpg';
    const espressoUrl = `/airo-assets/uploads/${espressoFilename}`;
    const latteUrl = `/airo-assets/uploads/${latteFilename}`;
    const sharedChatSource = 'original-chat-upload.jpg';

    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot(espressoUrl, { [espressoUrl]: sharedChatSource }),
    });
    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: {
        'menu/espresso': makeSlot(espressoUrl, { [espressoUrl]: sharedChatSource }),
        // Different URL, but same original chat source — Case B
        'menu/latte': makeSlot(latteUrl, { [latteUrl]: sharedChatSource }),
      },
    });
    vi.mocked(fileUploadService.findUploadedFilePath).mockResolvedValue(null); // no chat file

    const response = await request(app)
      .post('/media/test-app/slots/menu/espresso/upload')
      .field('overwriteFilename', espressoFilename)
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.body.affectedSlots).toEqual(['menu/latte']);

    // Should have written the sibling file (menu-latte-def67890.jpg) too
    const writeFileCalls = vi.mocked(fs.default.writeFile).mock.calls.map(([p]) => p as string);
    expect(writeFileCalls.some((p) => p.includes(latteFilename))).toBe(true);
  });

  it('rejects overwriteFilename containing a path separator', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');

    // When overwriteFilename is invalid, the request falls through to the normal
    // new-upload path, which requires getSlot to succeed and updateSlotWithUpload to run.
    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot('https://example.com/old.jpg'),
    });
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: makeSlot('/airo-assets/uploads/hero-new.jpg'),
    });

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .field('overwriteFilename', '../escape/hero.jpg') // path traversal attempt
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    // Falls through to normal upload (not overwrite) — manifest IS updated
    expect(response.status).toBe(200);
    expect(mediaManifestService.updateSlotWithUpload).toHaveBeenCalled();
  });
});

describe('POST /media/:appId/slots/:slotName/upload — chatFilenameOverwrite', () => {
  let app: express.Application;

  beforeAll(async () => {
    const { default: mediaRouter } = await import('../media.js');
    app = express();
    app.use('/media', mediaRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('overwrites original chat file in place instead of creating a new copy', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');
    const fs = await import('fs/promises');

    const chatFilename = 'original-chat-upload.jpg';
    const chatFilePath = '/tmp/test-app/uploads/u1/original-chat-upload.jpg';

    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot('https://media.gettyimages.com/old.jpg'),
    });
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: makeSlot('/airo-assets/uploads/hero-new.jpg'),
    });
    vi.mocked(fileUploadService.findUploadedFilePath).mockResolvedValue(chatFilePath);

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .field('chatFilenameOverwrite', chatFilename)
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.chatUploadFilename).toBe(chatFilename);

    // Should overwrite the existing file, not call processUpload
    expect(fileUploadService.findUploadedFilePath).toHaveBeenCalledWith('test-app', chatFilename);
    expect(fs.default.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(chatFilePath),
      expect.any(Buffer)
    );
    expect(fileUploadService.processUpload).not.toHaveBeenCalled();
  });

  it('falls back to creating a new chat copy when the chat file is not found on disk', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');

    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot('https://media.gettyimages.com/old.jpg'),
    });
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: makeSlot('/airo-assets/uploads/hero-new.jpg'),
    });
    vi.mocked(fileUploadService.findUploadedFilePath).mockResolvedValue(null); // not found

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .field('chatFilenameOverwrite', 'original-chat-upload.jpg')
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    // chatFilenameOverwrite not applied, chatUploadFilename not set from it
    expect(response.body.chatUploadFilename).toBeUndefined();
  });

  it('rejects chatFilenameOverwrite containing a path separator', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');

    vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
      success: true,
      slot: makeSlot('https://media.gettyimages.com/old.jpg'),
    });
    vi.mocked(mediaManifestService.updateSlotWithUpload).mockResolvedValue({
      success: true,
      slot: makeSlot('/airo-assets/uploads/hero-new.jpg'),
    });

    const response = await request(app)
      .post('/media/test-app/slots/hero/upload')
      .field('chatFilenameOverwrite', '../escape/file.jpg')
      .attach('image', await makeJpeg(), { filename: 'edit.jpg', contentType: 'image/jpeg' });

    expect(response.status).toBe(200);
    // Invalid chatFilenameOverwrite ignored — falls through to normal processUpload
    expect(fileUploadService.findUploadedFilePath).not.toHaveBeenCalled();
  });
});

describe('DELETE /media/:appId/uploads/:filename', () => {
  let app: express.Application;

  beforeAll(async () => {
    const { default: mediaRouter } = await import('../media.js');
    app = express();
    app.use('/media', mediaRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes manifest references before deleting the chat upload file', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');
    const fs = await import('fs/promises');

    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: {
        hero: makeSlot('/airo-assets/uploads/hero-upload.jpg', {
          '/airo-assets/uploads/hero-upload.jpg': 'chat-upload.jpg',
        }),
      },
    });
    vi.mocked(mediaManifestService.removeUploadedUrls).mockResolvedValue({
      success: true,
      affectedSlots: ['hero'],
      removedUrls: ['/airo-assets/uploads/hero-upload.jpg'],
    });
    vi.mocked(fileUploadService.deleteUploadedFile).mockResolvedValue({
      deleted: true,
      uploadId: 'upload_123',
    });

    const response = await request(app).delete('/media/test-app/uploads/chat-upload.jpg');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      affectedSlots: ['hero'],
      removedUrls: ['/airo-assets/uploads/hero-upload.jpg'],
      chatUploadDeleted: true,
      uploadId: 'upload_123',
    });
    expect(mediaManifestService.removeUploadedUrls).toHaveBeenCalledWith('test-app', [
      '/airo-assets/uploads/hero-upload.jpg',
    ]);
    expect(fs.default.unlink).toHaveBeenCalledWith('/tmp/test-app/public/media/hero-upload.jpg');
    expect(fileUploadService.deleteUploadedFile).toHaveBeenCalledWith(
      'test-app',
      'chat-upload.jpg'
    );
  });

  it('returns conflict and leaves files alone when manifest cleanup cannot replace an active slot', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');
    const fs = await import('fs/promises');

    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: {
        hero: makeSlot('/airo-assets/uploads/hero-upload.jpg', {
          '/airo-assets/uploads/hero-upload.jpg': 'chat-upload.jpg',
        }),
      },
    });
    vi.mocked(mediaManifestService.removeUploadedUrls).mockResolvedValue({
      success: false,
      error: 'Cannot delete upload because it is the only media for slot: hero',
      affectedSlots: [],
      removedUrls: ['/airo-assets/uploads/hero-upload.jpg'],
    });

    const response = await request(app).delete('/media/test-app/uploads/chat-upload.jpg');

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('Cannot delete upload');
    expect(fs.default.unlink).not.toHaveBeenCalled();
    expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced chat upload without touching the manifest', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');

    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: {},
    });
    vi.mocked(fileUploadService.deleteUploadedFile).mockResolvedValue({
      deleted: true,
      uploadId: 'upload_123',
    });

    const response = await request(app).delete('/media/test-app/uploads/chat-upload.jpg');

    expect(response.status).toBe(200);
    expect(response.body.chatUploadDeleted).toBe(true);
    expect(mediaManifestService.removeUploadedUrls).not.toHaveBeenCalled();
  });

  it('rejects unsafe filenames', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');

    const response = await request(app).delete('/media/test-app/uploads/bad..jpg');

    expect(response.status).toBe(400);
    expect(mediaManifestService.getManifest).not.toHaveBeenCalled();
    expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
  });
});

describe('DELETE /media/:appId/slots/:slotName/uploads/:filename', () => {
  let app: express.Application;

  beforeAll(async () => {
    const { default: mediaRouter } = await import('../media.js');
    app = express();
    app.use('/media', mediaRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes the upload from only the requested slot and leaves the chat upload available', async () => {
    const { mediaManifestService } = await import('../../../services/MediaManifestService.js');
    const { fileUploadService } = await import('../../../services/FileUploadService.js');

    vi.mocked(mediaManifestService.getManifest).mockResolvedValue({
      success: true,
      manifest: {
        hero: makeSlot('/airo-assets/uploads/hero-upload.jpg', {
          '/airo-assets/uploads/hero-upload.jpg': 'chat-upload.jpg',
        }),
        gallery: makeSlot('/airo-assets/uploads/gallery-upload.jpg', {
          '/airo-assets/uploads/gallery-upload.jpg': 'chat-upload.jpg',
        }),
      },
    });
    vi.mocked(mediaManifestService.removeUploadedUrlsFromSlot).mockResolvedValue({
      success: true,
      affectedSlots: ['hero'],
      removedUrls: ['/airo-assets/uploads/hero-upload.jpg'],
    });

    const response = await request(app).delete(
      '/media/test-app/slots/hero/uploads/chat-upload.jpg'
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      affectedSlots: ['hero'],
      removedUrls: ['/airo-assets/uploads/hero-upload.jpg'],
      chatUploadDeleted: false,
    });
    expect(mediaManifestService.removeUploadedUrlsFromSlot).toHaveBeenCalledWith(
      'test-app',
      'hero',
      ['/airo-assets/uploads/hero-upload.jpg']
    );
    expect(mediaManifestService.removeUploadedUrls).not.toHaveBeenCalled();
    expect(fileUploadService.deleteUploadedFile).not.toHaveBeenCalled();
  });
});
