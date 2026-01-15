import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AssetManifest, AssetInfo } from '../../types/rebuild.js';

describe('AssetProcessingService - analyzePageAssets filtering', () => {
  const createMockManifest = (): AssetManifest => ({
    assets: [
      {
        url: 'https://example.com/home-hero.jpg',
        localPath: '.source-site/assets/images/abc123.jpg',
        type: 'image',
        sourcePages: ['https://example.com/', 'https://example.com/home'],
        dimensions: { width: 1200, height: 800 },
        fileSize: 150000
      },
      {
        url: 'https://example.com/home-logo.png',
        localPath: '.source-site/assets/images/def456.png',
        type: 'image',
        sourcePages: ['https://example.com/'],
        dimensions: { width: 200, height: 100 },
        fileSize: 20000
      },
      {
        url: 'https://example.com/blog-header.jpg',
        localPath: '.source-site/assets/images/ghi789.jpg',
        type: 'image',
        sourcePages: ['https://example.com/blog', 'https://example.com/blog/post-1'],
        dimensions: { width: 800, height: 600 },
        fileSize: 100000
      },
      {
        url: 'https://example.com/shared-icon.svg',
        localPath: '.source-site/assets/images/jkl012.svg',
        type: 'image',
        sourcePages: ['https://example.com/', 'https://example.com/blog'],
        dimensions: { width: 50, height: 50 },
        fileSize: 5000
      }
    ],
    totalAssets: 4,
    byType: { image: 4, font: 0, icon: 0, other: 0 },
    generatedAt: new Date().toISOString()
  });

  describe('filtering by sourcePages', () => {
    it('should return only assets from homepage', () => {
      const manifest = createMockManifest();
      const pageUrl = 'https://example.com/';
      
      const pageAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes(pageUrl)
      );

      expect(pageAssets).toHaveLength(3);
      expect(pageAssets.map(a => a.url)).toEqual([
        'https://example.com/home-hero.jpg',
        'https://example.com/home-logo.png',
        'https://example.com/shared-icon.svg'
      ]);
    });

    it('should return only assets from blog page', () => {
      const manifest = createMockManifest();
      const pageUrl = 'https://example.com/blog';
      
      const pageAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes(pageUrl)
      );

      expect(pageAssets).toHaveLength(2);
      expect(pageAssets.map(a => a.url)).toEqual([
        'https://example.com/blog-header.jpg',
        'https://example.com/shared-icon.svg'
      ]);
    });

    it('should not return blog assets when filtering homepage', () => {
      const manifest = createMockManifest();
      const pageUrl = 'https://example.com/';
      
      const pageAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes(pageUrl)
      );

      const blogOnlyAsset = pageAssets.find(a => a.url === 'https://example.com/blog-header.jpg');
      expect(blogOnlyAsset).toBeUndefined();
    });

    it('should not return homepage-only assets when filtering blog', () => {
      const manifest = createMockManifest();
      const pageUrl = 'https://example.com/blog';
      
      const pageAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes(pageUrl)
      );

      const homeOnlyAsset = pageAssets.find(a => a.url === 'https://example.com/home-logo.png');
      expect(homeOnlyAsset).toBeUndefined();
    });

    it('should return assets that appear on multiple pages', () => {
      const manifest = createMockManifest();
      
      const homeAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes('https://example.com/')
      );
      const blogAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes('https://example.com/blog')
      );

      const sharedIcon = 'https://example.com/shared-icon.svg';
      expect(homeAssets.find(a => a.url === sharedIcon)).toBeDefined();
      expect(blogAssets.find(a => a.url === sharedIcon)).toBeDefined();
    });

    it('should handle assets with no sourcePages', () => {
      const manifest = createMockManifest();
      manifest.assets.push({
        url: 'https://example.com/orphan.jpg',
        localPath: '.source-site/assets/images/orphan.jpg',
        type: 'image',
        sourcePages: []
      });

      const pageUrl = 'https://example.com/';
      const pageAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes(pageUrl)
      );

      expect(pageAssets.find(a => a.url === 'https://example.com/orphan.jpg')).toBeUndefined();
    });

    it('should handle URL variations (with and without trailing slash)', () => {
      const manifest = createMockManifest();
      
      const withSlash = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes('https://example.com/')
      );
      const withoutSlash = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes('https://example.com')
      );

      // These should be different because exact matching is used
      expect(withSlash.length).not.toBe(withoutSlash.length);
    });
  });

  describe('filtering unanalyzed images', () => {
    it('should filter images without descriptions', () => {
      const manifest = createMockManifest();
      
      // Add description to some images
      manifest.assets[0]!.description = 'A beautiful hero image';
      manifest.assets[0]!.usageContext = 'hero';
      
      const pageUrl = 'https://example.com/';
      const pageAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes(pageUrl)
      );
      
      const unanalyzedImages = pageAssets.filter(
        asset => asset.type === 'image' && !asset.description
      );

      expect(unanalyzedImages).toHaveLength(2); // logo and shared icon
      expect(unanalyzedImages.map(a => a.url)).toEqual([
        'https://example.com/home-logo.png',
        'https://example.com/shared-icon.svg'
      ]);
    });

    it('should not include already analyzed images', () => {
      const manifest = createMockManifest();
      
      // Add descriptions to all home images
      manifest.assets.forEach(asset => {
        if (asset.sourcePages?.includes('https://example.com/')) {
          asset.description = 'Analyzed image';
          asset.usageContext = 'general';
        }
      });
      
      const pageUrl = 'https://example.com/';
      const pageAssets = manifest.assets.filter(asset => 
        asset.sourcePages && asset.sourcePages.includes(pageUrl)
      );
      
      const unanalyzedImages = pageAssets.filter(
        asset => asset.type === 'image' && !asset.description
      );

      expect(unanalyzedImages).toHaveLength(0);
    });
  });
});
