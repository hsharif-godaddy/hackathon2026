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
import { logger } from '../../logging/index.js';

const TRANSPARENT_URL = 'https://logos.example.com/abc-transparent.png';
const SOLID_URL = 'https://logos.example.com/abc-solid.png';
const REVERSED_URL = 'https://logos.example.com/abc-reversed.png';

function makeLogoSlot(overrides: Partial<MediaSlot> = {}): MediaSlot {
  return {
    mediaType: 'logo',
    currentUrl: TRANSPARENT_URL,
    searchQuery: 'Acme',
    alternatives: [],
    solidUrlMap: { [TRANSPARENT_URL]: SOLID_URL },
    reversedUrlMap: { [TRANSPARENT_URL]: REVERSED_URL },
    userModified: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MediaManifestService — transparent-logo invariant', () => {
  let service: MediaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MediaManifestService();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
  });

  describe('setSlot', () => {
    it('rewrites a solid currentUrl to its transparent sibling and warns', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      const slot = makeLogoSlot({ currentUrl: SOLID_URL });
      const result = await service.setSlot('test-app', 'logo/primary', slot, true);

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe(TRANSPARENT_URL);
      expect(logger.warn).toHaveBeenCalledWith(
        'media_manifest.logo.non_transparent_rewritten',
        expect.objectContaining({
          appId: 'test-app',
          slotName: 'logo/primary',
          originalUrl: SOLID_URL,
          transparentUrl: TRANSPARENT_URL,
        }),
      );
    });

    it('rewrites a reversed currentUrl to its transparent sibling and warns', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      const slot = makeLogoSlot({ currentUrl: REVERSED_URL });
      const result = await service.setSlot('test-app', 'logo/primary', slot, true);

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe(TRANSPARENT_URL);
      expect(logger.warn).toHaveBeenCalledWith(
        'media_manifest.logo.non_transparent_rewritten',
        expect.objectContaining({ originalUrl: REVERSED_URL, transparentUrl: TRANSPARENT_URL }),
      );
    });

    it('leaves a transparent currentUrl unchanged and does not warn', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      const slot = makeLogoSlot();
      const result = await service.setSlot('test-app', 'logo/primary', slot, true);

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe(TRANSPARENT_URL);
      expect(logger.warn).not.toHaveBeenCalledWith(
        'media_manifest.logo.non_transparent_rewritten',
        expect.anything(),
      );
    });

    it('leaves currentUrl unchanged for non-logo slots even if a value coincidentally matches', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      const slot: MediaSlot = {
        mediaType: 'image',
        currentUrl: SOLID_URL,
        searchQuery: 'test',
        alternatives: [],
        userModified: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
      };

      const result = await service.setSlot('test-app', 'hero/image', slot, true);

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe(SOLID_URL);
    });

    it('leaves currentUrl unchanged when a logo slot has no variant maps (no transparent sibling exists)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      const slot = makeLogoSlot({
        currentUrl: SOLID_URL,
        solidUrlMap: undefined,
        reversedUrlMap: undefined,
      });
      const result = await service.setSlot('test-app', 'logo/primary', slot, true);

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe(SOLID_URL);
      expect(logger.warn).not.toHaveBeenCalledWith(
        'media_manifest.logo.non_transparent_rewritten',
        expect.anything(),
      );
    });
  });

  describe('updateSlot', () => {
    it('rewrites a solid newUrl picked from alternatives to its transparent sibling', async () => {
      const existingSlot = makeLogoSlot({
        currentUrl: TRANSPARENT_URL,
        alternatives: [SOLID_URL],
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'logo/primary': existingSlot }),
      );

      const result = await service.updateSlot('test-app', 'logo/primary', {
        newUrl: SOLID_URL,
      });

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe(TRANSPARENT_URL);
      expect(logger.warn).toHaveBeenCalledWith(
        'media_manifest.logo.non_transparent_rewritten',
        expect.objectContaining({
          slotName: 'logo/primary',
          originalUrl: SOLID_URL,
          transparentUrl: TRANSPARENT_URL,
        }),
      );
    });

    it('leaves a transparent newUrl unchanged on updateSlot', async () => {
      const otherTransparent = 'https://logos.example.com/xyz-transparent.png';
      const otherSolid = 'https://logos.example.com/xyz-solid.png';
      const existingSlot = makeLogoSlot({
        currentUrl: TRANSPARENT_URL,
        alternatives: [otherTransparent],
        solidUrlMap: {
          [TRANSPARENT_URL]: SOLID_URL,
          [otherTransparent]: otherSolid,
        },
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({ 'logo/primary': existingSlot }),
      );

      const result = await service.updateSlot('test-app', 'logo/primary', {
        newUrl: otherTransparent,
      });

      expect(result.success).toBe(true);
      expect(result.slot!.currentUrl).toBe(otherTransparent);
      expect(logger.warn).not.toHaveBeenCalledWith(
        'media_manifest.logo.non_transparent_rewritten',
        expect.anything(),
      );
    });
  });
});
