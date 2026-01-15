#!/usr/bin/env tsx
import { readFile } from 'fs/promises';
import path from 'path';

async function testFiltering() {
  // Find a recent app with assets
  const appPath = process.argv[2];
  
  if (!appPath) {
    console.error('Usage: tsx test-asset-filtering.ts /tmp/apps/<appId>/app');
    process.exit(1);
  }

  const manifestPath = path.join(appPath, '.source-site', 'assets', 'manifest.json');
  const sitemapPath = path.join(appPath, '.source-site', 'sitemap.json');

  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    const sitemap = JSON.parse(await readFile(sitemapPath, 'utf-8'));

    console.log('\n=== SITEMAP PAGES ===');
    sitemap.pages.forEach((p: any, i: number) => {
      console.log(`${i}: ${p.url} (scraped: ${p.scraped})`);
    });

    console.log('\n=== ASSET SOURCE PAGES ===');
    manifest.assets.slice(0, 10).forEach((asset: any, i: number) => {
      console.log(`\nAsset ${i}: ${asset.url}`);
      console.log(`  Local: ${asset.localPath}`);
      console.log(`  Type: ${asset.type}`);
      console.log(`  Source Pages: ${JSON.stringify(asset.sourcePages || [])}`);
      console.log(`  Has description: ${!!asset.description}`);
    });

    console.log('\n=== FILTERING TEST ===');
    const homePage = sitemap.pages.find((p: any) => p.slug === 'homepage');
    if (homePage) {
      console.log(`\nFiltering for homepage: ${homePage.url}`);
      const homeAssets = manifest.assets.filter((asset: any) =>
        asset.sourcePages && asset.sourcePages.includes(homePage.url)
      );
      console.log(`Found ${homeAssets.length} assets for homepage`);
      homeAssets.slice(0, 15).forEach((asset: any) => {
        console.log(`  - ${asset.localPath.split('/').pop()}`);
      });
    }

    const blogPage = sitemap.pages.find((p: any) => p.url.includes('blog') && !p.url.includes('post'));
    if (blogPage) {
      console.log(`\nFiltering for blog: ${blogPage.url}`);
      const blogAssets = manifest.assets.filter((asset: any) =>
        asset.sourcePages && asset.sourcePages.includes(blogPage.url)
      );
      console.log(`Found ${blogAssets.length} assets for blog`);
      blogAssets.forEach((asset: any) => {
        console.log(`  - ${asset.localPath.split('/').pop()}`);
      });
    }

  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testFiltering();
