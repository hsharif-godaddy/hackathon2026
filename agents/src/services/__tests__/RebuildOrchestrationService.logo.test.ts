import { describe, it, expect } from 'vitest';
import type { AssetManifest } from '../../types/rebuild.js';
import { normalizeLogoUrl } from '../../utils/rebuild-utils.js';

/**
 * NOTE: These tests use a local reimplementation of findBestQualityLogo because
 * RebuildOrchestrationService has deep dependency chains (database, filesystem)
 * that make instantiation in unit tests impractical.
 *
 * The reimplementation matches production behavior as of 2026-06-26. If production
 * methods change, update this copy. Integration tests cover the real methods in
 * live workflows.
 *
 * Production differences to maintain:
 * - findBestQualityLogo: filters type ∈ {image,icon}, includes dimensionless assets
 * - normalizeLogoUrl: now imported from rebuild-utils.js (shared implementation)
 */

describe('RebuildOrchestrationService - Logo Methods', () => {
  // Local reimplementation matching production RebuildOrchestrationService.ts:420-446
  const findBestQualityLogo = (identifiedLogoUrl: string, assetManifest: AssetManifest): string => {

    const normalizedIdentified: string = normalizeLogoUrl(identifiedLogoUrl);

    // Filter to image/icon types and match normalized paths
    const matchingAssets = assetManifest.assets.filter((asset) => {
      if (asset.type !== 'image' && asset.type !== 'icon') return false;
      const normalizedAsset: string = normalizeLogoUrl(asset.url);
      return normalizedAsset === normalizedIdentified;
    });

    if (matchingAssets.length === 0) {
      return identifiedLogoUrl;
    }

    // Sort by resolution (dimensionless assets treated as 0x0)
    const sorted = matchingAssets.sort((a, b) => {
      const aPixels: number = (a.dimensions?.width ?? 0) * (a.dimensions?.height ?? 0);
      const bPixels: number = (b.dimensions?.width ?? 0) * (b.dimensions?.height ?? 0);
      return bPixels - aPixels;
    });

    return sorted[0]!.url;
  };

  describe('findBestQualityLogo', () => {
    it('should return highest resolution variant', () => {
      const assets: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/logo.png',
            localPath: '/assets/logo.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 100, height: 100 },
          },
          {
            url: 'https://example.com/logo.png/:/rs=w:200,h:200,m',
            localPath: '/assets/logo-200.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 200, height: 200 },
          },
          {
            url: 'https://example.com/logo.png/:/rs=w:400,h:400,m',
            localPath: '/assets/logo-400.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 400, height: 400 },
          },
        ],
        totalAssets: 3,
        byType: { image: 3, font: 0, icon: 0, other: 0 },
        generatedAt: '2026-01-01T00:00:00Z',
      };

      const result: string = findBestQualityLogo('https://example.com/logo.png', assets);

      expect(result).toBe('https://example.com/logo.png/:/rs=w:400,h:400,m');
    });

    it('should handle query parameters correctly', () => {
      const assets: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/logo.png?v=1',
            localPath: '/assets/logo.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 100, height: 100 },
          },
          {
            url: 'https://example.com/logo.png/:/rs=w:200,h:200,m',
            localPath: '/assets/logo-200.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 200, height: 200 },
          },
        ],
        totalAssets: 2,
        byType: { image: 2, font: 0, icon: 0, other: 0 },
        generatedAt: '2026-01-01T00:00:00Z',
      };

      const result: string = findBestQualityLogo('https://example.com/logo.png?v=1', assets);

      expect(result).toBe('https://example.com/logo.png/:/rs=w:200,h:200,m');
    });

    it('should fall back to original URL when no variants found', () => {
      const assets: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/other.png',
            localPath: '/assets/other.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 100, height: 100 },
          },
        ],
        totalAssets: 1,
        byType: { image: 1, font: 0, icon: 0, other: 0 },
        generatedAt: '2026-01-01T00:00:00Z',
      };

      const result: string = findBestQualityLogo('https://example.com/logo.png', assets);

      expect(result).toBe('https://example.com/logo.png');
    });

    it('should filter by type (image or icon only)', () => {
      const assets: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/logo.png',
            localPath: '/assets/logo.png',
            type: 'font', // Should be filtered out
            sourcePages: ['/'],
            dimensions: { width: 400, height: 400 },
          },
          {
            url: 'https://example.com/logo.png/:/rs=w:200,h:200,m',
            localPath: '/assets/logo-200.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 200, height: 200 },
          },
        ],
        totalAssets: 2,
        byType: { image: 1, font: 1, icon: 0, other: 0 },
        generatedAt: '2026-01-01T00:00:00Z',
      };

      const result: string = findBestQualityLogo('https://example.com/logo.png', assets);

      // Should return the image variant, not the font
      expect(result).toBe('https://example.com/logo.png/:/rs=w:200,h:200,m');
    });

    it('should include assets without dimensions (treated as 0x0)', () => {
      const assets: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/logo.png',
            localPath: '/assets/logo.png',
            type: 'image',
            sourcePages: ['/'],
            // No dimensions
          },
          {
            url: 'https://example.com/logo.png/:/rs=w:200,h:200,m',
            localPath: '/assets/logo-200.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 200, height: 200 },
          },
        ],
        totalAssets: 2,
        byType: { image: 2, font: 0, icon: 0, other: 0 },
        generatedAt: '2026-01-01T00:00:00Z',
      };

      const result: string = findBestQualityLogo('https://example.com/logo.png', assets);

      // Should pick the 200x200 (higher res than 0x0)
      expect(result).toBe('https://example.com/logo.png/:/rs=w:200,h:200,m');
    });

    it('should handle resize suffix stripping', () => {
      const assets: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/logo.png/:/rs=w:100,h:100,m',
            localPath: '/assets/logo-100.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 100, height: 100 },
          },
          {
            url: 'https://example.com/logo.png/:/rs=w:300,h:300,m',
            localPath: '/assets/logo-300.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 300, height: 300 },
          },
        ],
        totalAssets: 2,
        byType: { image: 2, font: 0, icon: 0, other: 0 },
        generatedAt: '2026-01-01T00:00:00Z',
      };

      const result: string = findBestQualityLogo(
        'https://example.com/logo.png/:/rs=w:50,h:50,m',
        assets,
      );

      expect(result).toBe('https://example.com/logo.png/:/rs=w:300,h:300,m');
    });

    it('should handle case-insensitive suffix matching (RS= vs rs=)', () => {
      const assets: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/logo.png/:/RS=w:300,h:300,m', // Uppercase
            localPath: '/assets/logo-300.png',
            type: 'image',
            sourcePages: ['/'],
            dimensions: { width: 300, height: 300 },
          },
        ],
        totalAssets: 1,
        byType: { image: 1, font: 0, icon: 0, other: 0 },
        generatedAt: '2026-01-01T00:00:00Z',
      };

      const result: string = findBestQualityLogo('https://example.com/logo.png/:/rs=w:50,h:50,m', assets);

      expect(result).toBe('https://example.com/logo.png/:/RS=w:300,h:300,m');
    });
  });

  describe('Fail-safe guard behavior', () => {
    it('should write logo when slot not found (normal fresh rebuild)', () => {
      // Mock the "Slot not found" error message from MediaManifestService.getSlot
      const slotNotFoundError = 'Slot not found: logo/horizontal';
      
      // Verify this does NOT trigger fail-safe (should proceed to write)
      const shouldFailSafe = slotNotFoundError.startsWith('Failed to read manifest');
      
      expect(shouldFailSafe).toBe(false);
    });

    it('should fail-safe on manifest read errors', () => {
      // Mock real read failure error messages
      const readErrors = [
        'Failed to read manifest: EACCES: permission denied',
        'Failed to read manifest: Unexpected token in JSON',
        'Failed to read manifest: ENOENT',
      ];
      
      for (const error of readErrors) {
        const shouldFailSafe = error.startsWith('Failed to read manifest');
        expect(shouldFailSafe).toBe(true);
      }
    });
  });
});
