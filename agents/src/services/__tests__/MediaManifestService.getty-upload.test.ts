import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import type { MediaSlot } from '../MediaManifestService.js';

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
  },
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: vi.fn().mockImplementation(function () { return {
    findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
  }; }),
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: { createForApp: vi.fn().mockReturnValue(null) },
}));

vi.mock('../../utils/git.js', () => ({
  GitUtils: vi.fn(),
}));

vi.mock('../../logging/index.js', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: stub,
    Logger: { create: vi.fn(() => stub) },
  };
});

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
    uploadVideo: vi.fn().mockResolvedValue(null),
  },
}));

import { MediaManifestService } from '../MediaManifestService.js';
import { gettyUploadService } from '../GettyUploadService.js';

function makeSlot(overrides: Partial<MediaSlot> = {}): MediaSlot {
  return {
    mediaType: 'image',
    currentUrl: 'https://preview.getty.com/current.jpg',
    searchQuery: 'nature',
    alternatives: ['https://preview.getty.com/alt1.jpg', 'https://preview.getty.com/alt2.jpg'],
    userModified: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MediaManifestService - Getty upload integration', () => {
  let service: MediaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MediaManifestService();

    // Default: writeFile and rename succeed
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------------
  // setSlot
  // ---------------------------------------------------------------------------
  describe('setSlot with Getty ID', () => {
    it('calls uploadAndReport with all Getty IDs', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-100', url: 'https://cdn.example.com/100.jpg' },
        { id: 'getty-101', url: 'https://cdn.example.com/101.jpg' },
        { id: 'getty-102', url: 'https://cdn.example.com/102.jpg' },
      ]);

      const slot = makeSlot({
        gettyId: 'getty-100',
        alternativeGettyIds: ['getty-101', 'getty-102'],
      });

      await service.setSlot('test-app', 'hero-image', slot);

      expect(gettyUploadService.uploadAndReport).toHaveBeenCalledWith([
        'getty-100',
        'getty-101',
        'getty-102',
      ]);
    });

    it('replaces currentUrl with CDN URL from upload result', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-100', url: 'https://cdn.example.com/100.jpg' },
      ]);

      const slot = makeSlot({
        gettyId: 'getty-100',
        currentUrl: 'https://preview.getty.com/current.jpg',
      });

      const result = await service.setSlot('test-app', 'hero-image', slot);

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe('https://cdn.example.com/100.jpg');
    });

    it('replaces alternative URLs with CDN URLs from upload result', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-100', url: 'https://cdn.example.com/100.jpg' },
        { id: 'getty-201', url: 'https://cdn.example.com/201.jpg' },
        { id: 'getty-202', url: 'https://cdn.example.com/202.jpg' },
      ]);

      const slot = makeSlot({
        gettyId: 'getty-100',
        alternativeGettyIds: ['getty-201', 'getty-202'],
        alternatives: ['https://preview.getty.com/alt1.jpg', 'https://preview.getty.com/alt2.jpg'],
      });

      const result = await service.setSlot('test-app', 'hero-image', slot);

      expect(result.success).toBe(true);
      expect(result.slot!.alternatives).toEqual([
        'https://cdn.example.com/201.jpg',
        'https://cdn.example.com/202.jpg',
      ]);
    });

    it('writes manifest with CDN URLs', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-100', url: 'https://cdn.example.com/100.jpg' },
        { id: 'getty-201', url: 'https://cdn.example.com/201.jpg' },
      ]);

      const slot = makeSlot({
        gettyId: 'getty-100',
        alternativeGettyIds: ['getty-201'],
        alternatives: ['https://preview.getty.com/alt1.jpg'],
      });

      await service.setSlot('test-app', 'hero-image', slot, true);

      // Verify the written JSON contains CDN URLs
      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      const writtenManifest = JSON.parse(writtenContent);

      expect(writtenManifest['hero-image'].currentUrl).toBe('https://cdn.example.com/100.jpg');
      expect(writtenManifest['hero-image'].alternatives[0]).toBe('https://cdn.example.com/201.jpg');
    });
  });

  describe('setSlot without Getty ID', () => {
    it('does not call uploadAndReport when no gettyId on slot', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      const slot = makeSlot(); // no gettyId

      await service.setSlot('test-app', 'hero-image', slot);

      expect(gettyUploadService.uploadAndReport).not.toHaveBeenCalled();
    });
  });

  describe('setSlot when upload fails', () => {
    it('falls back to original preview URLs (graceful degradation)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));
      // uploadAndReport returns empty array on failure
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([]);

      const slot = makeSlot({
        gettyId: 'getty-100',
        alternativeGettyIds: ['getty-201'],
        currentUrl: 'https://preview.getty.com/current.jpg',
        alternatives: ['https://preview.getty.com/alt1.jpg'],
      });

      const result = await service.setSlot('test-app', 'hero-image', slot);

      expect(result.success).toBe(true);
      // Original preview URLs should be preserved when upload returns nothing
      expect(result.slot!.currentUrl).toBe('https://preview.getty.com/current.jpg');
      expect(result.slot!.alternatives).toEqual(['https://preview.getty.com/alt1.jpg']);
    });
  });

  // ---------------------------------------------------------------------------
  // updateSlot
  // ---------------------------------------------------------------------------
  describe('updateSlot with Getty ID swap', () => {
    it('calls uploadAndReport when swapping to alternative with Getty ID', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: 'getty-100',
        alternatives: ['https://preview.getty.com/alt1.jpg', 'https://preview.getty.com/alt2.jpg'],
        alternativeGettyIds: ['getty-201', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-201', url: 'https://cdn.example.com/201.jpg' },
      ]);

      await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://preview.getty.com/alt1.jpg',
        alternativeIndex: 1,
      });

      expect(gettyUploadService.uploadAndReport).toHaveBeenCalledWith(['getty-201']);
    });

    it('uses CDN URL as the new currentUrl', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: 'getty-100',
        alternatives: ['https://preview.getty.com/alt1.jpg', 'https://preview.getty.com/alt2.jpg'],
        alternativeGettyIds: ['getty-201', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-201', url: 'https://cdn.example.com/201.jpg' },
      ]);

      const result = await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://preview.getty.com/alt1.jpg',
        alternativeIndex: 1,
      });

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe('https://cdn.example.com/201.jpg');
    });

    it('updates gettyId and alternativeGettyIds correctly after swap', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: 'getty-100',
        alternatives: ['https://preview.getty.com/alt1.jpg', 'https://preview.getty.com/alt2.jpg'],
        alternativeGettyIds: ['getty-201', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-201', url: 'https://cdn.example.com/201.jpg' },
      ]);

      const result = await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://preview.getty.com/alt1.jpg',
        alternativeIndex: 1,
      });

      expect(result.success).toBe(true);
      // After swapping index 1 to current:
      // new current Getty ID = getty-201 (was at index 1 in alternatives)
      expect(result.slot!.gettyId).toBe('getty-201');
      // Remaining IDs in the alternatives: getty-100 (old current) and getty-202
      expect(result.slot!.alternativeGettyIds).toEqual(['getty-100', 'getty-202']);
    });
  });

  describe('updateSlot with uploaded image injection', () => {
    it('injects uploaded URL as currentUrl and shifts all others to alternatives', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://preview.getty.com/current.jpg',
        gettyId: 'getty-100',
        alternatives: ['https://preview.getty.com/alt1.jpg'],
        alternativeGettyIds: ['getty-201'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));

      const result = await service.updateSlot('test-app', 'hero-image', {
        newUrl: '/airo-assets/uploads/new-upload.jpg',
      });

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe('/airo-assets/uploads/new-upload.jpg');
      expect(result.slot!.gettyId).toBeUndefined();
      expect(result.slot!.alternatives).toEqual([
        'https://preview.getty.com/current.jpg',
        'https://preview.getty.com/alt1.jpg',
      ]);
      expect(result.slot!.alternativeGettyIds).toEqual(['getty-100', 'getty-201']);
    });
  });

  describe('updateSlot without Getty ID', () => {
    it('does not call uploadAndReport when the new active image has no Getty ID', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: undefined,
        alternatives: ['https://example.com/uploaded.jpg', 'https://preview.getty.com/alt2.jpg'],
        alternativeGettyIds: ['', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));

      await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://example.com/uploaded.jpg',
        alternativeIndex: 1,
      });

      expect(gettyUploadService.uploadAndReport).not.toHaveBeenCalled();
    });

    it('handles misaligned alternativeGettyIds shorter than alternatives array', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: undefined,
        alternatives: [
          'https://example.com/alt1.jpg',
          'https://example.com/alt2.jpg',
          'https://example.com/alt3.jpg',
        ],
        // Only 2 Getty IDs for 3 alternatives (misaligned)
        alternativeGettyIds: ['getty-201', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));

      // Select the 3rd alternative (index 3 in allUrls) which has no Getty ID
      await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://example.com/alt3.jpg',
        alternativeIndex: 3,
      });

      // No Getty ID for this alternative, so no upload should happen
      expect(gettyUploadService.uploadAndReport).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // updateSlot — allowExternalUrl (search-selected images)
  // ---------------------------------------------------------------------------
  describe('updateSlot with allowExternalUrl', () => {
    it('sets CDN URL as currentUrl when upload succeeds', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: undefined,
        alternatives: ['https://cdn.example.com/alt1.jpg'],
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-search-1', url: 'https://cdn.example.com/licensed.jpg' },
      ]);

      const result = await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://preview.getty.com/watermarked.jpg',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-search-1', mediaType: 'image' },
        markUserModified: true,
      });

      expect(result.success).toBe(true);
      expect(result.slot?.currentUrl).toBe('https://cdn.example.com/licensed.jpg');
      expect(gettyUploadService.uploadAndReport).toHaveBeenCalledWith(['getty-search-1']);
    });

    it('returns error and does not write manifest when CDN upload fails', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: undefined,
        alternatives: [],
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([]);

      const result = await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://preview.getty.com/watermarked.jpg',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-search-1', mediaType: 'image' },
        markUserModified: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to license/i);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('updates searchQuery metadata when provided', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: undefined,
        alternatives: [],
        searchQuery: 'old query',
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-search-1', url: 'https://cdn.example.com/licensed.jpg' },
      ]);

      const result = await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://preview.getty.com/watermarked.jpg',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-search-1', mediaType: 'image' },
        searchQuery: 'new query',
        markUserModified: true,
      });

      expect(result.success).toBe(true);
      expect(result.slot?.searchQuery).toBe('new query');
    });
  });

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // updateSlot — video branch (gettyAsset.mediaType === 'video')
  // ---------------------------------------------------------------------------
  describe('updateSlot with gettyAsset video', () => {
    it('calls uploadVideo (not uploadAndReport) when gettyAsset.mediaType is video', async () => {
      const existingSlot = makeSlot({ mediaType: 'image' });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero': existingSlot })
      );
      vi.mocked(gettyUploadService.uploadVideo).mockResolvedValue(
        'https://cdn.example.com/licensed-video.mp4'
      );

      const result = await service.updateSlot('test-app', 'hero', {
        newUrl: 'https://preview.getty.com/watermarked.mp4',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-video-1', mediaType: 'video' },
      });

      expect(result.success).toBe(true);
      expect(gettyUploadService.uploadVideo).toHaveBeenCalledWith('getty-video-1');
      expect(gettyUploadService.uploadAndReport).not.toHaveBeenCalled();
      expect(result.slot?.currentUrl).toBe('https://cdn.example.com/licensed-video.mp4');
    });

    it('returns error when uploadVideo returns null (prevents watermark persistence)', async () => {
      const existingSlot = makeSlot({ mediaType: 'image' });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero': existingSlot })
      );
      vi.mocked(gettyUploadService.uploadVideo).mockResolvedValue(null);

      const result = await service.updateSlot('test-app', 'hero', {
        newUrl: 'https://preview.getty.com/watermarked.mp4',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-video-1', mediaType: 'video' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to license Getty video/);
    });

    it('sets mediaType to video when gettyAsset.mediaType is video and slot is not logo/generated', async () => {
      const existingSlot = makeSlot({ mediaType: 'image' });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero': existingSlot })
      );
      vi.mocked(gettyUploadService.uploadVideo).mockResolvedValue(
        'https://cdn.example.com/video.mp4'
      );

      const result = await service.updateSlot('test-app', 'hero', {
        newUrl: 'https://preview.getty.com/video.mp4',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-video-1', mediaType: 'video' },
      });

      expect(result.success).toBe(true);
      expect(result.slot?.mediaType).toBe('video');
    });

    it('preserves logo mediaType even when gettyAsset.mediaType is video', async () => {
      const existingSlot = makeSlot({ mediaType: 'logo' });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'logo-slot': existingSlot })
      );
      vi.mocked(gettyUploadService.uploadVideo).mockResolvedValue(
        'https://cdn.example.com/video.mp4'
      );

      const result = await service.updateSlot('test-app', 'logo-slot', {
        newUrl: 'https://preview.getty.com/video.mp4',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-video-1', mediaType: 'video' },
      });

      expect(result.success).toBe(true);
      expect(result.slot?.mediaType).toBe('logo');
    });

    it('preserves generated mediaType even when gettyAsset.mediaType is video', async () => {
      const existingSlot = makeSlot({ mediaType: 'generated' });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'gen-slot': existingSlot })
      );
      vi.mocked(gettyUploadService.uploadVideo).mockResolvedValue(
        'https://cdn.example.com/video.mp4'
      );

      const result = await service.updateSlot('test-app', 'gen-slot', {
        newUrl: 'https://preview.getty.com/video.mp4',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-video-1', mediaType: 'video' },
      });

      expect(result.success).toBe(true);
      expect(result.slot?.mediaType).toBe('generated');
    });

    it('reverts mediaType from video to image when gettyAsset.mediaType is image on a video slot', async () => {
      const existingSlot = makeSlot({ mediaType: 'video' });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero': existingSlot })
      );
      vi.mocked(gettyUploadService.uploadAndReport).mockResolvedValue([
        { id: 'getty-img-1', url: 'https://cdn.example.com/img.jpg' },
      ]);

      const result = await service.updateSlot('test-app', 'hero', {
        newUrl: 'https://preview.getty.com/img.jpg',
        allowExternalUrl: true,
        gettyAsset: { id: 'getty-img-1', mediaType: 'image' },
      });

      expect(result.success).toBe(true);
      expect(result.slot?.mediaType).toBe('image');
    });
  });

  // ---------------------------------------------------------------------------
  // removeUploadedUrls
  // ---------------------------------------------------------------------------
  describe('removeUploadedUrls', () => {
    it('promotes the first remaining alternative when removing the current upload', async () => {
      const existingSlot = makeSlot({
        currentUrl: '/airo-assets/uploads/hero-upload.jpg',
        gettyId: undefined,
        alternatives: [
          'https://cdn.example.com/replacement.jpg',
          '/airo-assets/uploads/other-upload.jpg',
        ],
        alternativeGettyIds: ['getty-201', ''],
        uploadSources: {
          '/airo-assets/uploads/hero-upload.jpg': 'chat-hero.jpg',
          '/airo-assets/uploads/other-upload.jpg': 'chat-other.jpg',
        },
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));

      const result = await service.removeUploadedUrls('test-app', [
        '/airo-assets/uploads/hero-upload.jpg',
      ]);

      expect(result.success).toBe(true);
      expect(result.affectedSlots).toEqual(['hero-image']);
      expect(result.slot).toBeUndefined();

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      const writtenManifest = JSON.parse(writtenContent);
      expect(writtenManifest['hero-image'].currentUrl).toBe(
        'https://cdn.example.com/replacement.jpg'
      );
      expect(writtenManifest['hero-image'].gettyId).toBe('getty-201');
      expect(writtenManifest['hero-image'].alternatives).toEqual([
        '/airo-assets/uploads/other-upload.jpg',
      ]);
      expect(writtenManifest['hero-image'].uploadSources).toEqual({
        '/airo-assets/uploads/other-upload.jpg': 'chat-other.jpg',
      });
    });

    it('removes uploaded alternatives and source mappings without changing the current image', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: 'getty-100',
        alternatives: ['/airo-assets/uploads/old-upload.jpg', 'https://cdn.example.com/alt.jpg'],
        alternativeGettyIds: ['', 'getty-201'],
        uploadSources: {
          '/airo-assets/uploads/old-upload.jpg': 'chat-old.jpg',
        },
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));

      const result = await service.removeUploadedUrls('test-app', [
        '/airo-assets/uploads/old-upload.jpg',
      ]);

      expect(result.success).toBe(true);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      const writtenManifest = JSON.parse(writtenContent);
      expect(writtenManifest['hero-image'].currentUrl).toBe('https://cdn.example.com/current.jpg');
      expect(writtenManifest['hero-image'].alternatives).toEqual([
        'https://cdn.example.com/alt.jpg',
      ]);
      expect(writtenManifest['hero-image'].alternativeGettyIds).toEqual(['getty-201']);
      expect(writtenManifest['hero-image'].uploadSources).toBeUndefined();
    });

    it('fails without writing when the deleted current upload has no replacement', async () => {
      const existingSlot = makeSlot({
        currentUrl: '/airo-assets/uploads/only-upload.jpg',
        alternatives: [],
        uploadSources: {
          '/airo-assets/uploads/only-upload.jpg': 'chat-only.jpg',
        },
      });

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ 'hero-image': existingSlot }));

      const result = await service.removeUploadedUrls('test-app', [
        '/airo-assets/uploads/only-upload.jpg',
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete upload');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('removeUploadedUrlsFromSlot', () => {
    it('removes the uploaded URL from only the requested slot', async () => {
      const heroSlot = makeSlot({
        currentUrl: '/airo-assets/uploads/hero-upload.jpg',
        alternatives: ['https://cdn.example.com/hero-replacement.jpg'],
        alternativeGettyIds: ['getty-201'],
        uploadSources: {
          '/airo-assets/uploads/hero-upload.jpg': 'chat-upload.jpg',
        },
      });
      const gallerySlot = makeSlot({
        currentUrl: '/airo-assets/uploads/gallery-upload.jpg',
        alternatives: ['https://cdn.example.com/gallery-replacement.jpg'],
        alternativeGettyIds: ['getty-301'],
        uploadSources: {
          '/airo-assets/uploads/gallery-upload.jpg': 'chat-upload.jpg',
        },
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ hero: heroSlot, gallery: gallerySlot })
      );

      const result = await service.removeUploadedUrlsFromSlot('test-app', 'hero', [
        '/airo-assets/uploads/hero-upload.jpg',
      ]);

      expect(result.success).toBe(true);
      expect(result.affectedSlots).toEqual(['hero']);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0]![1] as string;
      const writtenManifest = JSON.parse(writtenContent);
      expect(writtenManifest.hero.currentUrl).toBe('https://cdn.example.com/hero-replacement.jpg');
      expect(writtenManifest.hero.alternatives).toEqual([]);
      expect(writtenManifest.hero.uploadSources).toBeUndefined();
      expect(writtenManifest.gallery.currentUrl).toBe('/airo-assets/uploads/gallery-upload.jpg');
      expect(writtenManifest.gallery.uploadSources).toEqual({
        '/airo-assets/uploads/gallery-upload.jpg': 'chat-upload.jpg',
      });
    });

    it('fails without writing when the requested slot has no replacement image', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          hero: makeSlot({
            currentUrl: '/airo-assets/uploads/only-upload.jpg',
            alternatives: [],
            uploadSources: {
              '/airo-assets/uploads/only-upload.jpg': 'chat-only.jpg',
            },
          }),
        })
      );

      const result = await service.removeUploadedUrlsFromSlot('test-app', 'hero', [
        '/airo-assets/uploads/only-upload.jpg',
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot remove upload');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
