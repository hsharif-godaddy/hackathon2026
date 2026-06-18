import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

// sha256 of the mocked upload bytes ('fake-image-bytes') — the content hash
// importChatUploadToSlot computes for dedup.
const FAKE_IMAGE_CONTENT_HASH = crypto
  .createHash('sha256')
  .update(Buffer.from('fake-image-bytes'))
  .digest('hex');

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    stat: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () {
    return {
      findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
    };
  }),
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn(),
}));

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: () => ({ tasks: {} }),
}));

vi.mock('../../tools/ast-image-editor.js', () => ({
  astImageEditor: {
    replaceImage: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('../GettyUploadService.js', () => ({
  gettyUploadService: {
    uploadAndReport: vi.fn().mockResolvedValue([]),
    reportUsage: vi.fn(),
  },
}));

vi.mock('../FileUploadService.js', () => ({
  fileUploadService: {
    listUploadedFiles: vi.fn(),
    findUploadedFilePath: vi.fn(),
  },
}));

vi.mock('../ImageProcessingService.js', () => ({
  imageProcessingService: {
    processImage: vi.fn(),
  },
}));

vi.mock('../../utils/persistent-assets.js', () => ({
  getPersistentPublicDir: vi.fn(function (appPath: string) {
    return `${appPath}/public`;
  }),
}));

import { fileUploadService } from '../FileUploadService.js';
import { imageProcessingService } from '../ImageProcessingService.js';
import {
  deriveChatUploadSlotPath,
  MediaManifestService,
} from '../MediaManifestService.js';

describe('MediaManifestService - importChatUploadToSlot', function importChatUploadTests() {
  let service: MediaManifestService;

  beforeEach(function reset() {
    vi.clearAllMocks();
    service = new MediaManifestService();
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      if (String(filePath).endsWith('airo-media.json')) {
        return JSON.stringify({});
      }
      return Buffer.from('fake-image-bytes');
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);
    vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
      {
        filename: 'stored-hero.jpg',
        originalName: 'hero.jpg',
        mimeType: 'image/jpeg',
        size: 100,
        uploadedAt: '2026-01-01T00:00:00.000Z',
        uploadId: 'upload-1',
      },
    ]);
    vi.mocked(fileUploadService.findUploadedFilePath).mockResolvedValue(
      '/tmp/uploads/stored-hero.jpg'
    );
    vi.mocked(imageProcessingService.processImage).mockResolvedValue({
      buffer: Buffer.from('processed'),
      width: 800,
      height: 600,
      format: 'jpeg',
      originalWidth: 800,
      originalHeight: 600,
    });
  });

  describe('#deriveChatUploadSlotPath', function derivePathTests() {
    it('derives hero slot path from filename', function heroPath() {
      const path = deriveChatUploadSlotPath({}, {
        filename: 'My Hero Photo.jpg',
        assetRole: 'hero_image',
      });
      expect(path).toBe('uploads/hero-my-hero-photo');
    });

    it('derives background slot path from filename', function backgroundPath() {
      const path = deriveChatUploadSlotPath({}, {
        filename: 'section-bg.png',
        assetRole: 'background',
      });
      expect(path).toBe('uploads/background-section-bg');
    });

    it('appends counter when derived path exists', function collision() {
      const path = deriveChatUploadSlotPath(
        { 'uploads/hero-photo': { currentUrl: '/x' } as never },
        { filename: 'photo.jpg', assetRole: 'hero_image' }
      );
      expect(path).toBe('uploads/hero-photo-2');
    });

    it('uses explicit slotName when provided', function explicitSlot() {
      const path = deriveChatUploadSlotPath({}, {
        filename: 'photo.jpg',
        slotName: 'menu/pasta-carbonara',
      });
      expect(path).toBe('menu/pasta-carbonara');
    });
  });

  describe('#importChatUploadToSlot', function importTests() {
    it('creates a new slot from chat upload when no matching role slot exists', async function createSlot() {
      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        assetRole: 'hero_image',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.slotPath).toBe('uploads/hero-stored-hero');
        expect(result.slotUrl).toBe('/airo-assets/images/uploads/hero-stored-hero');
        expect(result.uploadedUrl).toMatch(/^\/airo-assets\/uploads\//);
      }
    });

    it('updates existing hero slot (pages/home/hero) instead of creating uploads/hero-... (AIROBUILD-2364)', async function useExistingRoleSlot() {
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('airo-media.json')) {
          return JSON.stringify({
            'pages/home/hero': {
              mediaType: 'image',
              currentUrl: 'https://isteam.dev-wsimg.com/getty/coffee',
              searchQuery: 'coffee shop',
              alternatives: [],
              userModified: false,
            },
          });
        }
        return Buffer.from('fake-image-bytes');
      });

      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        assetRole: 'hero_image',
        createIfMissing: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Must reuse the established slot, not create uploads/hero-stored-hero
        expect(result.slotPath).toBe('pages/home/hero');
        expect(result.slotUrl).toBe('/airo-assets/images/pages/home/hero');
        // Slot now points at the upload
        expect(result.slot.currentUrl).toMatch(/^\/airo-assets\/uploads\//);
      }
    });

    it('prefers the home hero slot when multiple hero slots exist', async function multiHeroPrefersHome() {
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('airo-media.json')) {
          return JSON.stringify({
            'pages/about/hero': { mediaType: 'image', currentUrl: '/x', searchQuery: '', alternatives: [], userModified: false },
            'pages/home/hero': { mediaType: 'image', currentUrl: '/y', searchQuery: '', alternatives: [], userModified: false },
          });
        }
        return Buffer.from('fake-image-bytes');
      });

      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        assetRole: 'hero_image',
        createIfMissing: true,
      });

      expect(result.success).toBe(true);
      if (result.success) expect(result.slotPath).toBe('pages/home/hero');
    });

    it('does NOT guess when multiple non-home hero slots exist — derives a fresh slot instead of overwriting the wrong one', async function multiHeroAmbiguous() {
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('airo-media.json')) {
          return JSON.stringify({
            'pages/about/hero': { mediaType: 'image', currentUrl: '/x', searchQuery: '', alternatives: [], userModified: false },
            'pages/contact/hero': { mediaType: 'image', currentUrl: '/y', searchQuery: '', alternatives: [], userModified: false },
          });
        }
        return Buffer.from('fake-image-bytes');
      });

      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        assetRole: 'hero_image',
        createIfMissing: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // Neither existing hero is overwritten — a fresh derived slot is used.
        expect(result.slotPath).toBe('uploads/hero-stored-hero');
      }
    });

    it('returns existing slot when upload filename already registered', async function dedup() {
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('airo-media.json')) {
          return JSON.stringify({
            'uploads/existing-hero': {
              mediaType: 'image',
              currentUrl: '/airo-assets/uploads/existing-hero-abc.jpg',
              searchQuery: '',
              alternatives: [],
              userModified: true,
              uploadSources: {
                '/airo-assets/uploads/existing-hero-abc.jpg': 'stored-hero.jpg',
              },
            },
          });
        }
        return Buffer.from('fake-image-bytes');
      });

      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        assetRole: 'hero_image',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.slotPath).toBe('uploads/existing-hero');
        expect(result.slotUrl).toBe('/airo-assets/images/uploads/existing-hero');
      }
      expect(imageProcessingService.processImage).not.toHaveBeenCalled();
    });

    it('dedups by content hash on auto-register path (no slotName) — re-uploaded same image reuses existing slot', async function contentHashDedup() {
      // The image already lives in "menu/latte-art-friends" with its hash.
      // A re-upload of the SAME bytes under a fresh stored filename, with NO
      // explicit slotName (auto-register path), must reuse the existing slot.
      // Duplicate prevention via guidance (existingSlotUrl) handles the explicit
      // import_upload path — the slot layer only dedups on auto-register.
      vi.mocked(fileUploadService.listUploadedFiles).mockResolvedValue([
        {
          filename: 'test-app_222_file_NEW.jpg',
          originalName: 'coffee.jpg',
          mimeType: 'image/jpeg',
          size: 100,
          uploadedAt: '2026-01-02T00:00:00.000Z',
          uploadId: 'upload-2',
        },
      ]);
      vi.mocked(fileUploadService.findUploadedFilePath).mockResolvedValue(
        '/tmp/uploads/test-app_222_file_NEW.jpg'
      );
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('airo-media.json')) {
          return JSON.stringify({
            'menu/latte-art-friends': {
              mediaType: 'image',
              currentUrl: '/airo-assets/uploads/menu-latte-art-friends-abc.jpg',
              searchQuery: '',
              alternatives: [],
              userModified: true,
              uploadSources: {
                '/airo-assets/uploads/menu-latte-art-friends-abc.jpg': 'test-app_111_file_OLD.jpg',
              },
              uploadContentHash: FAKE_IMAGE_CONTENT_HASH,
            },
          });
        }
        return Buffer.from('fake-image-bytes');
      });

      // No slotName — auto-register path
      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'test-app_222_file_NEW.jpg',
        assetRole: 'hero_image',
        createIfMissing: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.slotPath).toBe('menu/latte-art-friends');
        expect(result.slotUrl).toBe('/airo-assets/images/menu/latte-art-friends');
      }
      expect(imageProcessingService.processImage).not.toHaveBeenCalled();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('does NOT dedup-short-circuit when an explicit slotName is given (re-select an already-known upload)', async function explicitSlotReapplies() {
      // The upload is already registered in this slot, but its currentUrl is a
      // Getty image. An explicit apply/import must set the upload as current —
      // not silently return the unchanged slot (the bug behind "use this image
      // does nothing").
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('airo-media.json')) {
          return JSON.stringify({
            'pages/home/hero': {
              mediaType: 'image',
              currentUrl: 'https://isteam.dev-wsimg.com/getty/123',
              searchQuery: '',
              alternatives: ['/airo-assets/uploads/old-upload-abc.jpg'],
              userModified: true,
              gettyId: '123',
              uploadSources: {
                '/airo-assets/uploads/old-upload-abc.jpg': 'stored-hero.jpg',
              },
            },
          });
        }
        return Buffer.from('fake-image-bytes');
      });

      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        slotName: 'pages/home/hero',
        createIfMissing: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.slotPath).toBe('pages/home/hero');
        // currentUrl is now the (re-processed) upload, not the Getty image.
        expect(result.slot.currentUrl).toMatch(/^\/airo-assets\/uploads\//);
        expect(result.slot.currentUrl).not.toContain('getty');
        // Prior Getty currentUrl preserved as an alternative.
        expect(result.slot.alternatives).toContain('https://isteam.dev-wsimg.com/getty/123');
      }
      // It actually re-processed the file (did not short-circuit).
      expect(imageProcessingService.processImage).toHaveBeenCalled();
    });

    it('returns 404 when slot missing and createIfMissing is false', async function requireExisting() {
      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        slotName: 'pages/home/hero',
        createIfMissing: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.httpStatus).toBe(404);
        expect(result.error).toContain('Slot not found');
      }
    });

    it('updates an existing slot in place: old url moves to alternatives, new url is current', async function updateExisting() {
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (String(filePath).endsWith('airo-media.json')) {
          return JSON.stringify({
            'pages/home/hero': {
              mediaType: 'image',
              currentUrl: '/airo-assets/uploads/old-hero-1111.jpg',
              searchQuery: 'prior search',
              alternatives: [],
              userModified: false,
              // Different source filename so the dedup early-return does NOT fire.
              uploadSources: { '/airo-assets/uploads/old-hero-1111.jpg': 'previous.jpg' },
            },
          });
        }
        return Buffer.from('fake-image-bytes');
      });

      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        slotName: 'pages/home/hero',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.slotPath).toBe('pages/home/hero');
        expect(result.slot.currentUrl).toMatch(/^\/airo-assets\/uploads\//);
        expect(result.slot.currentUrl).not.toBe('/airo-assets/uploads/old-hero-1111.jpg');
        // Prior current url is preserved as an alternative.
        expect(result.slot.alternatives).toContain('/airo-assets/uploads/old-hero-1111.jpg');
        expect(result.slot.userModified).toBe(true);
        expect(result.slot.searchQuery).toBe('');
        // New upload source recorded alongside the prior one.
        expect(result.slot.uploadSources?.[result.slot.currentUrl]).toBe('stored-hero.jpg');
      }
    });

    it('unlinks the orphaned media file when the manifest write fails', async function orphanCleanup() {
      // Media file write (rename to *.jpg) succeeds; manifest write (rename to
      // airo-media.json) fails — the just-written media file must be removed.
      vi.mocked(fs.rename).mockImplementation(async (_from, to) => {
        if (String(to).endsWith('airo-media.json')) {
          throw new Error('disk full');
        }
        return undefined;
      });

      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        assetRole: 'hero_image',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.httpStatus).toBe(500);
      }
      expect(fs.unlink).toHaveBeenCalledTimes(1);
      expect(String(vi.mocked(fs.unlink).mock.calls[0][0])).toMatch(
        /\/tmp\/test-app\/public\/media\/uploads-hero-stored-hero-[0-9a-f]+\.jpg$/
      );
    });
  });
});
