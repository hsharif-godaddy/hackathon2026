/**
 * Test script to trace Atlas homepage asset flow locally.
 *
 * Usage: cd agents && npx tsx scripts/test-atlas-assets.ts https://www.urbancookies.com
 */
import 'dotenv/config';

import { AtlasCrawlerAdapter, type AtlasCrawlOutput } from '../src/services/AtlasCrawlerAdapter.js';
import { bucketAssetsForProcessing } from '../src/services/rebuild/scrape-pipeline.js';
import { isRebuildHomepage, normalizeRebuildPageKey } from '../src/utils/rebuild-utils.js';

const sourceUrl = process.argv[2] || 'https://www.urbancookies.com';
const rootPath = '/';

console.log('🔍 Atlas Homepage Asset Flow Test');
console.log('================================================\n');
console.log(`Source URL: ${sourceUrl}`);
console.log(`Root Path: ${rootPath}\n`);

async function main() {
  const adapter = new AtlasCrawlerAdapter();

  let homepageOutput: AtlasCrawlOutput | null = null;

  const onHomepageReady = async (output: AtlasCrawlOutput): Promise<void> => {
    console.log('\n🏠 onHomepageReady callback fired!');
    console.log('─'.repeat(50));
    console.log(`  Pages received: ${output.pages.length}`);
    console.log(`  Assets received: ${output.assets.length}`);
    console.log(`  Sitemap pages: ${output.sitemapData.totalPages}`);

    // Find homepage
    const homePage = output.pages.find(
      (p) => p.success && (p.sanitizedContent || p.html) && isRebuildHomepage(p.url, rootPath)
    );

    if (!homePage) {
      console.log('\n❌ No homepage found in pages!');
      console.log('   Page URLs:', output.pages.map((p) => p.url));
      return;
    }

    console.log(`\n  Homepage URL: ${homePage.url}`);
    console.log(`  Homepage success: ${homePage.success}`);

    // Bucket assets exactly like scrape-pipeline.ts does
    const { homeAssets, otherAssets } = bucketAssetsForProcessing(output.assets, homePage.url);

    console.log(`\n📊 Asset Bucketing Results:`);
    console.log(`  Total assets from Atlas: ${output.assets.length}`);
    console.log(`  Home assets (matched): ${homeAssets.length}`);
    console.log(`  Other assets: ${otherAssets.length}`);

    // Debug: Show sample sourceUrls
    if (output.assets.length > 0) {
      console.log(`\n  Sample asset sourceUrls (first 5):`);
      const sample = output.assets.slice(0, 5);
      for (const asset of sample) {
        console.log(`    - ${asset.sourceUrl}`);
      }
    }

    // Debug: Show normalization
    const homeKey = normalizeRebuildPageKey(homePage.url);
    console.log(`\n  Normalized homepage key: "${homeKey}"`);

    if (output.assets.length > 0) {
      const firstAssetKey = normalizeRebuildPageKey(output.assets[0].sourceUrl);
      console.log(`  Normalized first asset sourceUrl: "${firstAssetKey}"`);
      console.log(`  Keys match: ${homeKey === firstAssetKey}`);
    }

    // Check for mismatches
    if (output.assets.length > 0 && homeAssets.length === 0) {
      console.log('\n⚠️  WARNING: Assets received but none matched homepage!');
      console.log('   This indicates a URL normalization mismatch.');
      console.log(`\n   Homepage URL: "${homePage.url}"`);
      console.log(`   Normalized: "${homeKey}"`);
      console.log('\n   Asset sourceUrls (unique):');
      const uniqueSourceUrls = [...new Set(output.assets.map((a) => a.sourceUrl))];
      for (const url of uniqueSourceUrls.slice(0, 10)) {
        const normalized = normalizeRebuildPageKey(url);
        const matches = normalized === homeKey ? '✓' : '✗';
        console.log(`     ${matches} "${url}" → "${normalized}"`);
      }
    }

    homepageOutput = output;
    console.log('─'.repeat(50));
  };

  console.log('\n🚀 Starting Atlas crawl...\n');

  try {
    const startTime = Date.now();
    const result = await adapter.crawlSite(
      sourceUrl,
      { maxPages: 3, rootPath },
      { onHomepageReady }
    );

    const durationMs = Date.now() - startTime;
    console.log(`\n✅ Crawl complete in ${(durationMs / 1000).toFixed(1)}s`);
    console.log(`   Total pages: ${result.pages.length}`);
    console.log(`   Total assets: ${result.assets.length}`);

    if (!homepageOutput) {
      console.log('\n❌ onHomepageReady callback was never fired!');
      console.log('   This means Atlas did not reach homepage_ready status.');
    }

    // Final verification
    if (homepageOutput) {
      const homePage = homepageOutput.pages.find((p) => isRebuildHomepage(p.url, rootPath));
      if (homePage) {
        const { homeAssets } = bucketAssetsForProcessing(homepageOutput.assets, homePage.url);
        console.log(`\n📋 FINAL VERDICT:`);
        if (homeAssets.length > 0) {
          console.log(`   ✅ ${homeAssets.length} homepage assets would be processed`);
          console.log(`   The homepage prompt should have access to these assets.`);
        } else {
          console.log(`   ❌ 0 homepage assets would be processed`);
          console.log(`   The homepage prompt would have NO imported assets!`);
        }
      }
    }
  } catch (error) {
    console.error('\n❌ Crawl failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch(console.error);
