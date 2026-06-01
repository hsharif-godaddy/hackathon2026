import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetInfo, AssetManifest } from '../../types/rebuild.js';
import { AssetProcessingService } from '../AssetProcessingService.js';

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

describe('AssetProcessingService - analyzePageAssets return value', () => {
  it('returns pageAssets and zero analyzedImageCount when all images already described', async function analyzedCountZero() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'asset-processing-analyzed-'));
    try {
      const manifest: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/home-hero.jpg',
            localPath: '.source-site/assets/images/abc.jpg',
            type: 'image',
            sourcePages: ['https://example.com/'],
            description: 'already described'
          },
          {
            url: 'https://example.com/other.jpg',
            localPath: '.source-site/assets/images/def.jpg',
            type: 'image',
            sourcePages: ['https://example.com/other']
          }
        ],
        totalAssets: 2,
        byType: { image: 2, font: 0, icon: 0, other: 0 },
        generatedAt: new Date().toISOString()
      };

      const svc = new AssetProcessingService(dir);
      const result = await svc.analyzePageAssets('https://example.com/', manifest);

      expect(result.pageAssets).toHaveLength(1);
      expect(result.pageAssets[0]?.url).toBe('https://example.com/home-hero.jpg');
      expect(result.analyzedImageCount).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns analyzedImageCount equal to number of images described in this call', async function analyzedCountNonZero() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'asset-processing-analyzed-nonzero-'));
    try {
      await mkdir(path.join(dir, '.source-site', 'assets'), { recursive: true });
      const manifest: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/a.jpg',
            localPath: '.source-site/assets/images/a.jpg',
            type: 'image',
            sourcePages: ['https://example.com/']
          },
          {
            url: 'https://example.com/b.jpg',
            localPath: '.source-site/assets/images/b.jpg',
            type: 'image',
            sourcePages: ['https://example.com/']
          }
        ],
        totalAssets: 2,
        byType: { image: 2, font: 0, icon: 0, other: 0 },
        generatedAt: new Date().toISOString()
      };

      const svc = new AssetProcessingService(dir);
      vi
        .spyOn(
          svc as unknown as { analyzeImageBatch: (images: AssetInfo[]) => Promise<void> },
          'analyzeImageBatch'
        )
        .mockImplementation(async function describe(images) {
          for (const img of images) {
            img.description = 'stub description';
          }
        });

      const result = await svc.analyzePageAssets('https://example.com/', manifest);

      expect(result.pageAssets).toHaveLength(2);
      expect(result.analyzedImageCount).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('AssetProcessingService - Atlas-provided dimensions and placement', () => {
  it('uses provided dimensions instead of reading file header', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'asset-dims-'));
    try {
      const assetsDir = path.join(dir, '.source-site', 'assets', 'images');
      await mkdir(assetsDir, { recursive: true });
      const fakeImagePath = path.join(assetsDir, 'test-hero.jpg');
      await writeFile(fakeImagePath, Buffer.from('fake-jpg-data'));

      const svc = new AssetProcessingService(dir);

      vi.spyOn(svc as any, 'downloadAsset').mockResolvedValue({
        success: true,
        localPath: '.source-site/assets/images/test-hero.jpg',
      });

      const dimSpy = vi.spyOn(svc as any, 'getImageDimensions');

      const sourcePages = new Map([['https://example.com/hero.jpg', ['https://example.com/']]]);
      const manifest = await svc.process(
        [{
          url: 'https://example.com/hero.jpg',
          type: 'image',
          sourceUrl: 'https://example.com/',
          dimensions: { width: 1920, height: 1080 },
        }],
        sourcePages,
      );

      expect(dimSpy).not.toHaveBeenCalled();
      const hero = manifest.assets.find(a => a.url === 'https://example.com/hero.jpg');
      expect(hero?.dimensions).toEqual({ width: 1920, height: 1080 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes placement through to AssetInfo output', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'asset-placement-'));
    try {
      const assetsDir = path.join(dir, '.source-site', 'assets', 'images');
      await mkdir(assetsDir, { recursive: true });
      const fakeImagePath = path.join(assetsDir, 'test-logo.png');
      await writeFile(fakeImagePath, Buffer.from('fake-png-data'));

      const svc = new AssetProcessingService(dir);

      vi.spyOn(svc as any, 'downloadAsset').mockResolvedValue({
        success: true,
        localPath: '.source-site/assets/images/test-logo.png',
      });

      const sourcePages = new Map([['https://example.com/logo.png', ['https://example.com/']]]);
      const manifest = await svc.process(
        [{
          url: 'https://example.com/logo.png',
          type: 'image',
          sourceUrl: 'https://example.com/',
          dimensions: { width: 200, height: 60 },
          placement: {
            inHeader: true,
            inFooter: false,
            inFirstSection: false,
            nearH1: false,
            isFirstInContainer: true,
          },
        }],
        sourcePages,
      );

      const logo = manifest.assets.find(a => a.url === 'https://example.com/logo.png');
      expect(logo?.placement?.inHeader).toBe(true);
      expect(logo?.placement?.isFirstInContainer).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('AssetProcessingService - process merge', () => {
  it('resolves processAssetsWithConcurrency immediately for empty input', async function emptyConcurrency() {
    const svc = new AssetProcessingService(path.join(os.tmpdir(), 'asset-processing-empty'));
    const results = await (svc as unknown as {
      processAssetsWithConcurrency: (
        assets: unknown[],
        sourcePages: Map<string, string[]>
      ) => Promise<(AssetInfo | null)[]>;
    }).processAssetsWithConcurrency([], new Map());

    expect(results).toEqual([]);
  });

  it('merge pass completes when every URL already exists in manifest', async function mergeOnlySourcePages() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'asset-processing-merge-'));
    try {
      const assetsDir = path.join(dir, '.source-site', 'assets');
      await mkdir(assetsDir, { recursive: true });
      const existing: AssetManifest = {
        assets: [
          {
            url: 'https://example.com/logo.png',
            localPath: '.source-site/assets/images/logo.png',
            type: 'image',
            sourcePages: ['https://example.com/'],
            dimensions: { width: 100, height: 50 },
            fileSize: 1000
          }
        ],
        totalAssets: 1,
        byType: { image: 1, font: 0, icon: 0, other: 0 },
        generatedAt: new Date().toISOString()
      };
      await writeFile(
        path.join(assetsDir, 'manifest.json'),
        JSON.stringify(existing),
        'utf-8'
      );

      const svc = new AssetProcessingService(dir);
      const sourcePages = new Map<string, string[]>([
        ['https://example.com/logo.png', ['https://example.com/', 'https://example.com/about']]
      ]);

      await svc.process(
        [
          {
            url: 'https://example.com/logo.png',
            type: 'image',
            sourceUrl: 'https://example.com/about'
          }
        ],
        sourcePages,
        { merge: true }
      );

      const saved = JSON.parse(
        await readFile(path.join(assetsDir, 'manifest.json'), 'utf-8')
      ) as AssetManifest;

      expect(saved.assets).toHaveLength(1);
      expect(saved.assets[0]?.sourcePages?.sort()).toEqual(
        ['https://example.com/', 'https://example.com/about'].sort()
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
