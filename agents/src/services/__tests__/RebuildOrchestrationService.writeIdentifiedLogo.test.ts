import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceSiteData, StylePreferences } from '../../types/rebuild.js';

// Mock database connection before any imports that might trigger it
vi.mock('../../database/connection.js', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
    })),
    pragma: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock('../MediaManifestService.js', () => ({
  mediaManifestService: {
    getSlot: vi.fn(),
    setSlot: vi.fn(),
  },
}));

// Import after mocks are set up
import { RebuildOrchestrationService } from '../RebuildOrchestrationService.js';
import { mediaManifestService } from '../MediaManifestService.js';

describe('RebuildOrchestrationService.writeIdentifiedLogoIfPresent', () => {
  let service: RebuildOrchestrationService;
  const appId: string = 'test-app-id';
  const testAppPath: string = '/tmp/test-app';

  beforeEach(() => {
    service = new RebuildOrchestrationService(testAppPath);
    vi.clearAllMocks();
  });

  const createMockSourceSiteData = (identifiedLogoUrl?: string): SourceSiteData => ({
    metadata: {
      identifiedLogo: identifiedLogoUrl
        ? { url: identifiedLogoUrl, detectionMethod: 'header-placement' }
        : undefined,
      title: 'Test Site',
      description: 'Test Description',
    } as any,
    assets: {
      assets: [
        {
          url: 'https://example.com/logo.png',
          localPath: '/assets/logo.png',
          type: 'image',
          sourcePages: ['/'],
          dimensions: { width: 100, height: 100 },
        },
        {
          url: 'https://example.com/logo.png/:/rs=w:400,h:400,m',
          localPath: '/assets/logo-400.png',
          type: 'image',
          sourcePages: ['/'],
          dimensions: { width: 400, height: 400 },
        },
      ],
      totalAssets: 2,
      byType: { image: 2, font: 0, icon: 0, other: 0 },
      generatedAt: '2026-01-01T00:00:00Z',
    },
    sitemap: { pages: [], totalPages: 0, discoveredAt: '2026-01-01T00:00:00Z' },
    pages: {},
  });

  const mockStylePreferences = (keepLogo: boolean): StylePreferences => ({
    keepLogo,
    keepSourceImages: true,
    designDirection: 'keep-similar',
    colorPreference: 'keep-original',
    typographyStyle: 'keep-original',
    layoutApproach: 'responsive',
  });

  describe('slot-not-found scenario (fresh rebuild)', () => {
    it('should write logo when slot does not exist', async () => {
      const sourceSiteData: SourceSiteData = createMockSourceSiteData('https://example.com/logo.png');
      vi.spyOn(service as any, 'loadSourceSiteData').mockResolvedValue(sourceSiteData);
      vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
        success: false,
        error: 'Slot not found',
      });
      vi.mocked(mediaManifestService.setSlot).mockResolvedValue({ success: true });

      await (service as any).writeIdentifiedLogoIfPresent(appId, mockStylePreferences(true));

      expect(mediaManifestService.setSlot).toHaveBeenCalledWith(
        appId,
        'logo/horizontal',
        expect.objectContaining({
          mediaType: 'logo',
          currentUrl: '/airo-assets/uploads/logo-400.png', // converted to servable URL
          userModified: false,
        }),
        false
      );
    });
  });

  describe('userModified:true scenario', () => {
    it('should skip write when user has uploaded logo', async () => {
      const sourceSiteData: SourceSiteData = createMockSourceSiteData('https://example.com/logo.png');
      vi.spyOn(service as any, 'loadSourceSiteData').mockResolvedValue(sourceSiteData);
      vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
        success: true,
        slot: {
          mediaType: 'logo',
          currentUrl: 'https://example.com/user-logo.png',
          searchQuery: 'user uploaded',
          alternatives: [],
          userModified: true,
          createdAt: '2026-01-01T00:00:00Z',
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      });

      await (service as any).writeIdentifiedLogoIfPresent(appId, mockStylePreferences(true));

      expect(mediaManifestService.setSlot).not.toHaveBeenCalled();
    });
  });

  describe('manifest read error scenario', () => {
    it('should skip write when manifest cannot be read', async () => {
      const sourceSiteData: SourceSiteData = createMockSourceSiteData('https://example.com/logo.png');
      vi.spyOn(service as any, 'loadSourceSiteData').mockResolvedValue(sourceSiteData);
      vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
        success: false,
        error: 'Failed to read manifest: EACCES permission denied',
      });

      await (service as any).writeIdentifiedLogoIfPresent(appId, mockStylePreferences(true));

      expect(mediaManifestService.setSlot).not.toHaveBeenCalled();
    });
  });

  describe('keepLogo:false scenario', () => {
    it('should skip write when keepLogo preference is false', async () => {
      const sourceSiteData: SourceSiteData = createMockSourceSiteData('https://example.com/logo.png');
      vi.spyOn(service as any, 'loadSourceSiteData').mockResolvedValue(sourceSiteData);

      await (service as any).writeIdentifiedLogoIfPresent(appId, mockStylePreferences(false));

      expect(mediaManifestService.getSlot).not.toHaveBeenCalled();
      expect(mediaManifestService.setSlot).not.toHaveBeenCalled();
    });
  });

  describe('no logo identified', () => {
    it('should skip write when no logo was identified', async () => {
      const sourceSiteData: SourceSiteData = createMockSourceSiteData(undefined);
      vi.spyOn(service as any, 'loadSourceSiteData').mockResolvedValue(sourceSiteData);

      await (service as any).writeIdentifiedLogoIfPresent(appId, mockStylePreferences(true));

      expect(mediaManifestService.getSlot).not.toHaveBeenCalled();
      expect(mediaManifestService.setSlot).not.toHaveBeenCalled();
    });
  });

  describe('overwrite allowed scenario', () => {
    it('should overwrite when existing slot has userModified:false', async () => {
      const sourceSiteData: SourceSiteData = createMockSourceSiteData('https://example.com/logo.png');
      vi.spyOn(service as any, 'loadSourceSiteData').mockResolvedValue(sourceSiteData);
      vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
        success: true,
        slot: {
          mediaType: 'logo',
          currentUrl: 'https://example.com/old-logo.png',
          searchQuery: 'previous rebuild',
          alternatives: [],
          userModified: false,
          createdAt: '2026-01-01T00:00:00Z',
          lastUpdated: '2026-01-01T00:00:00Z',
        },
      });
      vi.mocked(mediaManifestService.setSlot).mockResolvedValue({ success: true });

      await (service as any).writeIdentifiedLogoIfPresent(appId, mockStylePreferences(true));

      expect(mediaManifestService.setSlot).toHaveBeenCalledWith(
        appId,
        'logo/horizontal',
        expect.objectContaining({
          currentUrl: '/airo-assets/uploads/logo-400.png',
          userModified: false,
        }),
        false
      );
    });
  });

  describe('resolution upgrade', () => {
    it('should upgrade to highest resolution variant', async () => {
      const sourceSiteData: SourceSiteData = createMockSourceSiteData(
        'https://example.com/logo.png/:/rs=w:16,h:16,m'
      );
      vi.spyOn(service as any, 'loadSourceSiteData').mockResolvedValue(sourceSiteData);
      vi.mocked(mediaManifestService.getSlot).mockResolvedValue({
        success: false,
        error: 'Slot not found',
      });
      vi.mocked(mediaManifestService.setSlot).mockResolvedValue({ success: true });

      await (service as any).writeIdentifiedLogoIfPresent(appId, mockStylePreferences(true));

      expect(mediaManifestService.setSlot).toHaveBeenCalledWith(
        appId,
        'logo/horizontal',
        expect.objectContaining({
          currentUrl: '/airo-assets/uploads/logo-400.png',
        }),
        false
      );
    });
  });
});
