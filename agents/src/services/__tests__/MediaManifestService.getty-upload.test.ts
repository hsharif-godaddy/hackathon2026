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
  AppRepository: vi.fn().mockImplementation(() => ({
    findById: vi.fn().mockReturnValue({ id: 'test-app', path: '/tmp/test-app' }),
  })),
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

import { MediaManifestService } from '../MediaManifestService.js';
import { gettyUploadService } from '../GettyUploadService.js';

function makeSlot(overrides: Partial<MediaSlot> = {}): MediaSlot {
  return {
    mediaType: 'image',
    currentUrl: 'https://preview.getty.com/current.jpg',
    searchQuery: 'nature',
    alternatives: [
      'https://preview.getty.com/alt1.jpg',
      'https://preview.getty.com/alt2.jpg',
    ],
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
        alternatives: [
          'https://preview.getty.com/alt1.jpg',
          'https://preview.getty.com/alt2.jpg',
        ],
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

      expect(writtenManifest['hero-image'].currentUrl).toBe(
        'https://cdn.example.com/100.jpg'
      );
      expect(writtenManifest['hero-image'].alternatives[0]).toBe(
        'https://cdn.example.com/201.jpg'
      );
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
      expect(result.slot!.alternatives).toEqual([
        'https://preview.getty.com/alt1.jpg',
      ]);
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
        alternatives: [
          'https://preview.getty.com/alt1.jpg',
          'https://preview.getty.com/alt2.jpg',
        ],
        alternativeGettyIds: ['getty-201', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero-image': existingSlot })
      );
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
        alternatives: [
          'https://preview.getty.com/alt1.jpg',
          'https://preview.getty.com/alt2.jpg',
        ],
        alternativeGettyIds: ['getty-201', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero-image': existingSlot })
      );
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
        alternatives: [
          'https://preview.getty.com/alt1.jpg',
          'https://preview.getty.com/alt2.jpg',
        ],
        alternativeGettyIds: ['getty-201', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero-image': existingSlot })
      );
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

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero-image': existingSlot })
      );

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
      expect(result.slot!.alternativeGettyIds).toEqual([
        'getty-100',
        'getty-201',
      ]);
    });
  });

  describe('updateSlot without Getty ID', () => {
    it('does not call uploadAndReport when the new active image has no Getty ID', async () => {
      const existingSlot = makeSlot({
        currentUrl: 'https://cdn.example.com/current.jpg',
        gettyId: undefined,
        alternatives: [
          'https://example.com/uploaded.jpg',
          'https://preview.getty.com/alt2.jpg',
        ],
        alternativeGettyIds: ['', 'getty-202'],
      });

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero-image': existingSlot })
      );

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

      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'hero-image': existingSlot })
      );

      // Select the 3rd alternative (index 3 in allUrls) which has no Getty ID
      await service.updateSlot('test-app', 'hero-image', {
        newUrl: 'https://example.com/alt3.jpg',
        alternativeIndex: 3,
      });

      // No Getty ID for this alternative, so no upload should happen
      expect(gettyUploadService.uploadAndReport).not.toHaveBeenCalled();
    });
  });

});
