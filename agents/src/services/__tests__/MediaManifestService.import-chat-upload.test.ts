import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

// sha256 of the mocked upload bytes ('fake-image-bytes') — the content hash
// importChatUploadToSlot records on a slot. Used here to prove it no longer
// selects a slot (placement is intent-driven, not byte-identity-driven).
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

const { gitAddFiles, gitGetStatus, gitCommit, gitGetLastCommit } = vi.hoisted(() => ({
  gitAddFiles: vi.fn(),
  gitGetStatus: vi.fn(),
  gitCommit: vi.fn(),
  gitGetLastCommit: vi.fn(),
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
import { GitUtils } from '../../utils/git.js';
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
    // Default: the target media file does not pre-exist (new import).
    vi.mocked(fs.stat).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
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
    gitAddFiles.mockResolvedValue({ success: true });
    gitGetStatus.mockResolvedValue({ stagedFiles: 2 });
    gitCommit.mockResolvedValue({ success: true });
    gitGetLastCommit.mockResolvedValue({ hash: 'abc1234' });
    // Re-apply after clearAllMocks. Assign to `this` (constructor pattern) so
    // `new GitUtils()` yields an instance carrying the spies.
    vi.mocked(GitUtils).mockImplementation(function (this: Record<string, unknown>) {
      this.addFiles = gitAddFiles;
      this.getStatus = gitGetStatus;
      this.commit = gitCommit;
      this.getLastCommit = gitGetLastCommit;
    } as unknown as () => GitUtils);
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

    it('stages the processed media file in the SAME commit as the manifest', async function commitsMediaBytes() {
      // Regression guard: the manifest must never be committed without the media
      // file it points at. Otherwise a workspace recycle drops the untracked file
      // and the slot 404s ("file not found") while the manifest survives.
      const result = await service.importChatUploadToSlot('test-app', {
        filename: 'stored-hero.jpg',
        assetRole: 'hero_image',
      });

      expect(result.success).toBe(true);
      expect(gitAddFiles).toHaveBeenCalledTimes(1);
      const [stagedAppPath, stagedFiles] = gitAddFiles.mock.calls[0]!;
      expect(stagedAppPath).toBe('/tmp/test-app');
      // Manifest AND the processed media file under public/media (the test's
      // getPersistentPublicDir mock returns <appPath>/public).
      expect(stagedFiles).toContain('airo-media.json');
      expect(stagedFiles).toEqual(
        expect.arrayContaining([expect.stringMatching(/^public\/media\/.+\.jpg$/)]),
      );
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

    it('does NOT reuse a slot by upload filename — derives a fresh slot instead of hijacking', async function noFilenameReuse() {
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
        // The same stored filename already backs uploads/existing-hero, but that
        // no longer short-circuits placement — a fresh slot is derived rather
        // than hijacking the existing one.
        expect(result.slotPath).toBe('uploads/hero-stored-hero');
        expect(result.slotPath).not.toBe('uploads/existing-hero');
      }
    });

    it('does NOT hijack an unrelated slot by content hash on the auto-register path — derives a fresh slot', async function noContentHashHijack() {
      // The SAME bytes already back "menu/latte-art-friends". A hero
      // auto-register of those bytes must NOT resolve onto that menu slot (the
      // QR-code / second-photo → hero hijack class) — placement is intent-driven,
      // so a fresh hero slot is derived and the menu slot is left untouched.
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
        expect(result.slotPath).not.toBe('menu/latte-art-friends');
        expect(result.slotPath).toBe('uploads/hero-test-app-222-file-new');
      }
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

    it('does NOT unlink the media file on manifest-write failure when it already existed (referenced by a prior import)', async function orphanGuard() {
      // Same slot + same bytes ⇒ same deterministic filename, and the file is
      // already on disk from an earlier successful import. A manifest-write
      // failure now must NOT delete it, or the earlier slot 404s.
      vi.mocked(fs.stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof fs.stat>>);
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
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    // AIROBUILD-2789 — auto-register must NOT overwrite a user-customized canonical role slot.
    describe('auto-register guard against clobbering user-customized canonical slots (AIROBUILD-2789)', function airobuild2789Tests() {
      it('does NOT overwrite a user-modified canonical hero slot (Getty pick the user accepted)', async function preserveUserAcceptedStockHero(): Promise<void> {
        // Pre: userModified=true Getty pick. A later unrelated hero-tagged upload must not displace it.
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/hero': {
                mediaType: 'image',
                currentUrl: 'https://isteam.dev-wsimg.com/getty/user-accepted-coffee',
                searchQuery: 'coffee shop interior',
                alternatives: [],
                userModified: true,
                gettyId: 'user-accepted-coffee',
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
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
          expect(result.slotPath).not.toBe('pages/home/hero');
          expect(result.slotPath).toMatch(/^uploads\/hero-/);
          expect(result.slotUrl).toMatch(/^\/airo-assets\/images\/uploads\/hero-/);
          expect(result.slot.currentUrl).toMatch(/^\/airo-assets\/uploads\//);
        }
      });

      it('does NOT overwrite a hero slot already backed by a prior user upload', async function preserveExistingUploadHero(): Promise<void> {
        // Pre: hero backed by a prior user upload (uploadSources populated). A subsequent unrelated hero-tagged upload must land in a fresh slot.
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/hero': {
                mediaType: 'image',
                currentUrl: '/airo-assets/uploads/pages-home-hero-prevhash.jpg',
                searchQuery: '',
                alternatives: [],
                userModified: true,
                uploadSources: {
                  '/airo-assets/uploads/pages-home-hero-prevhash.jpg': 'previous-user-upload.jpg',
                },
                uploadContentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
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
          expect(result.slotPath).not.toBe('pages/home/hero');
          expect(result.slotPath).toMatch(/^uploads\/hero-/);
        }
      });

      it('does NOT overwrite a user-modified canonical background slot', async function preserveUserBackground(): Promise<void> {
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/background': {
                mediaType: 'image',
                currentUrl: 'https://isteam.dev-wsimg.com/getty/user-accepted-bg',
                searchQuery: 'pattern',
                alternatives: [],
                userModified: true,
                gettyId: 'user-accepted-bg',
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
              },
            });
          }
          return Buffer.from('fake-image-bytes');
        });

        const result = await service.importChatUploadToSlot('test-app', {
          filename: 'stored-hero.jpg',
          assetRole: 'background',
          createIfMissing: true,
        });

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.slotPath).not.toBe('pages/home/background');
          expect(result.slotPath).toMatch(/^uploads\/background-/);
        }
      });

      it('STILL replaces the initial AI scaffold hero (userModified=false, no uploadSources) — AIROBUILD-2364 stays green', async function scaffoldReplacementUnchanged(): Promise<void> {
        // AIROBUILD-2364 contract: untouched scaffold is still a legitimate replace target.
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/hero': {
                mediaType: 'image',
                currentUrl: 'https://isteam.dev-wsimg.com/getty/initial-scaffold',
                searchQuery: 'coffee shop',
                alternatives: [],
                userModified: false,
                gettyId: 'initial-scaffold',
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
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
          expect(result.slotPath).toBe('pages/home/hero');
          expect(result.slot.currentUrl).toMatch(/^\/airo-assets\/uploads\//);
        }
      });

      it('explicit slotName from the agent still replaces in place even when the existing slot is user-modified', async function explicitSlotStillReplaces(): Promise<void> {
        // Explicit slotName = explicit user intent; replacement-in-place is preserved.
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/hero': {
                mediaType: 'image',
                currentUrl: 'https://isteam.dev-wsimg.com/getty/user-accepted-coffee',
                searchQuery: 'coffee shop',
                alternatives: [],
                userModified: true,
                gettyId: 'user-accepted-coffee',
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
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
          expect(result.slot.currentUrl).toMatch(/^\/airo-assets\/uploads\//);
          expect(result.slot.alternatives).toContain('https://isteam.dev-wsimg.com/getty/user-accepted-coffee');
        }
      });

      it('does NOT overwrite a hero slot backed by aiGeneratedUrls (AI-generated hero counts as user-meaningful, not scaffold) — review finding #4', async function preserveAiGeneratedHero(): Promise<void> {
        // aiGeneratedUrls counts as user-meaningful — AI hero must not be silently clobbered.
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/hero': {
                mediaType: 'image',
                currentUrl: '/airo-assets/uploads/pages-home-hero-ai-gen.jpg',
                searchQuery: '',
                alternatives: [],
                userModified: false,
                aiGeneratedUrls: ['/airo-assets/uploads/pages-home-hero-ai-gen.jpg'],
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
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
          expect(result.slotPath).not.toBe('pages/home/hero');
          expect(result.slotPath).toMatch(/^uploads\/hero-/);
          expect(result.deflectedFromCanonical).toBe(true);
        }
      });

      it('sets deflectedFromCanonical:true when the guard fires; false when scaffold is reused — review finding #1 plumbing', async function deflectedFlag(): Promise<void> {
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/hero': {
                mediaType: 'image',
                currentUrl: 'https://isteam.dev-wsimg.com/getty/initial-scaffold',
                searchQuery: 'coffee shop',
                alternatives: [],
                userModified: false,
                gettyId: 'initial-scaffold',
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
              },
            });
          }
          return Buffer.from('fake-image-bytes');
        });

        const scaffoldResult = await service.importChatUploadToSlot('test-app', {
          filename: 'stored-hero.jpg',
          assetRole: 'hero_image',
          createIfMissing: true,
        });
        expect(scaffoldResult.success).toBe(true);
        if (scaffoldResult.success) {
          expect(scaffoldResult.slotPath).toBe('pages/home/hero');
          expect(scaffoldResult.deflectedFromCanonical).toBe(false);
        }
      });

      it('same bytes re-uploaded against a user-customized hero still lands in a fresh slot (intent-driven, no byte-identity short-circuit)', async function sameBytesIntoFreshSlot(): Promise<void> {
        // Intent-driven (no byte-identity short-circuit): same bytes against a user-customized hero still routes to a fresh slot via the AIROBUILD-2789 guard.
        vi.mocked(fs.readFile).mockImplementation(async (filePath: fs.FileHandle | string | Buffer | URL): Promise<string | Buffer> => {
          if (String(filePath).endsWith('airo-media.json')) {
            return JSON.stringify({
              'pages/home/hero': {
                mediaType: 'image',
                currentUrl: '/airo-assets/uploads/pages-home-hero-prevhash.jpg',
                searchQuery: '',
                alternatives: [],
                userModified: true,
                uploadSources: {
                  '/airo-assets/uploads/pages-home-hero-prevhash.jpg': 'previous-user-upload.jpg',
                },
                uploadContentHash: FAKE_IMAGE_CONTENT_HASH,
                createdAt: '2026-06-22T00:00:00.000Z',
                lastUpdated: '2026-06-22T00:00:00.000Z',
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
          expect(result.slotPath).not.toBe('pages/home/hero');
          expect(result.slotPath).toMatch(/^uploads\/hero-/);
        }
      });
    });
  });
});
