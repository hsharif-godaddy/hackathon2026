import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtlasCrawlerAdapter } from '../AtlasCrawlerAdapter.js';
import type { AtlasCrawlResult } from '../../types/atlas-api.js';

// Mock logger
vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('AtlasCrawlerAdapter - identifyLogoImage', () => {
  let adapter: AtlasCrawlerAdapter;

  beforeEach(() => {
    adapter = new AtlasCrawlerAdapter();
  });

  const createBaseMockResult = (): AtlasCrawlResult => ({
    baseUrl: 'https://example.com',
    structure: {
      sitemap: null,
      navigation: { primary: [], footer: [] },
    },
    pages: [],
    assets: [],
    images: [],
    favicon: null,
    metadata: {
      siteType: 'content',
      primaryPurpose: 'business',
      targetAudience: 'customers',
      brandVoice: 'professional',
      designStyle: 'modern',
      colorPalette: { primary: [], secondary: [], accent: [] },
      typography: { roles: [] },
      scrapedAt: '2026-01-01T00:00:00Z',
      atlasVersion: '1.0.0',
    },
  });

  describe('Priority 2: Favicon-based identification', () => {
    it('should identify logo from primary favicon', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        favicon: {
          primary: {
            url: 'https://example.com/favicon.ico',
            rel: 'icon',
          },
          candidates: [],
        },
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/favicon.ico',
        detectionMethod: 'favicon',
      });
    });

    it('should fall back to first candidate when primary missing', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        favicon: {
          primary: null,
          candidates: [
            { url: 'https://example.com/icon.png', rel: 'icon' },
            { url: 'https://example.com/icon-backup.png', rel: 'icon' },
          ],
        },
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/icon.png',
        detectionMethod: 'favicon',
      });
    });
  });

  describe('Priority 1: Header placement', () => {
    it('should identify logo from header placement (Priority 1)', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        images: [
          {
            url: 'https://example.com/header-logo.png',
            width: 200,
            height: 200,
            inHeader: true,
            inFooter: false,
            nearH1: false,
            inFirstSection: false,
            isFirstInContainer: false,
          },
          {
            url: 'https://example.com/hero.jpg',
            width: 1200,
            height: 800,
            inHeader: false,
            inFooter: false,
            nearH1: true,
            inFirstSection: true,
            isFirstInContainer: true,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/header-logo.png',
        detectionMethod: 'header-placement',
      });
    });

    it('should identify logo from hero + logo-sized near H1 (Priority 3a)', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        images: [
          {
            url: 'https://example.com/hero-logo.png',
            width: 250,
            height: 150,
            inHeader: false,
            inFooter: false,
            nearH1: true,
            inFirstSection: true,
            isFirstInContainer: false,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/hero-logo.png',
        detectionMethod: 'hero-placement',
      });
    });

    it('should not identify non-logo-sized image near H1', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        images: [
          {
            url: 'https://example.com/hero-image.jpg',
            width: 1200,
            height: 800,
            inHeader: false,
            inFooter: false,
            nearH1: true,
            inFirstSection: true,
            isFirstInContainer: true,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toBeNull();
    });

    it('should identify logo from homepage link + logo-sized (Priority 3b)', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        baseUrl: 'https://example.com',
        images: [
          {
            url: 'https://example.com/linked-logo.png',
            width: 200,
            height: 100,
            linkedTo: 'https://example.com',
            inHeader: false,
            inFooter: false,
            nearH1: false,
            inFirstSection: false,
            isFirstInContainer: false,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/linked-logo.png',
        detectionMethod: 'homepage-link',
      });
    });
  });

  describe('Priority 4: Size heuristics', () => {
    it('should identify logo by size heuristic', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        assets: [
          { url: 'https://example.com/image.png', type: 'image' },
        ],
        images: [
          {
            url: 'https://example.com/image.png',
            width: 250,
            height: 250,
            inHeader: false,
            inFooter: false,
            nearH1: false,
            inFirstSection: false,
            isFirstInContainer: false,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/image.png',
        detectionMethod: 'size-heuristic',
      });
    });

    it('should not identify oversized images by size heuristic', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        assets: [
          { url: 'https://example.com/hero.jpg', type: 'image' },
        ],
        images: [
          {
            url: 'https://example.com/hero.jpg',
            width: 1920,
            height: 1080,
            inHeader: false,
            inFooter: false,
            nearH1: false,
            inFirstSection: false,
            isFirstInContainer: false,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toBeNull();
    });
  });

  describe('Priority 5: Text matching', () => {
    it('should identify logo by "logo" in URL', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        assets: [
          { url: 'https://example.com/company-logo.png', type: 'image' },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/company-logo.png',
        detectionMethod: 'text-match',
      });
    });

    it('should identify logo by "brand" in URL', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        assets: [
          { url: 'https://example.com/brand-mark.png', type: 'image' },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/brand-mark.png',
        detectionMethod: 'text-match',
      });
    });

    it('should match text case-insensitively', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        assets: [
          { url: 'https://example.com/LOGO.PNG', type: 'image' },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toEqual({
        url: 'https://example.com/LOGO.PNG',
        detectionMethod: 'text-match',
      });
    });
  });

  describe('Priority cascade', () => {
    it('should prefer header placement over favicon', () => {
      // Header placement is Priority 1 because it's a stronger visual signal.
      // Many sites use separate files for favicon (16×16 .ico) vs logo (higher resolution).
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        favicon: {
          primary: {
            url: 'https://example.com/favicon.ico',
            rel: 'icon',
          },
          candidates: [],
        },
        images: [
          {
            url: 'https://example.com/header-logo.png',
            width: 200,
            height: 200,
            inHeader: true,
            inFooter: false,
            nearH1: false,
            inFirstSection: false,
            isFirstInContainer: false,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result?.detectionMethod).toBe('header-placement');
      expect(result?.url).toBe('https://example.com/header-logo.png');
    });

    it('should prefer header placement over hero placement', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        images: [
          {
            url: 'https://example.com/header-logo.png',
            width: 200,
            height: 200,
            inHeader: true,
            inFooter: false,
            nearH1: false,
            inFirstSection: false,
            isFirstInContainer: false,
          },
          {
            url: 'https://example.com/hero-logo.png',
            width: 250,
            height: 150,
            inHeader: false,
            inFooter: false,
            nearH1: true,
            inFirstSection: true,
            isFirstInContainer: false,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result?.detectionMethod).toBe('header-placement');
    });

    it('should prefer size heuristic over text matching', () => {
      const mockResult: AtlasCrawlResult = {
        ...createBaseMockResult(),
        assets: [
          { url: 'https://example.com/sized.png', type: 'image' },
          { url: 'https://example.com/logo.png', type: 'image' },
        ],
        images: [
          {
            url: 'https://example.com/sized.png',
            width: 200,
            height: 200,
            inHeader: false,
            inFooter: false,
            nearH1: false,
            inFirstSection: false,
            isFirstInContainer: false,
          },
        ],
      };

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result?.detectionMethod).toBe('size-heuristic');
    });
  });

  describe('No logo found', () => {
    it('should return null when no logo identified', () => {
      const mockResult: AtlasCrawlResult = createBaseMockResult();

      const result = (adapter as any).identifyLogoImage(mockResult);

      expect(result).toBeNull();
    });
  });
});
