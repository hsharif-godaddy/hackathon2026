/**
 * rebuild-media eval runner.
 *
 * For each fixture site under fixtures/:
 *  1. Load source-images.json (the real scraped manifest)
 *  2. Load slot-queries.json (real agent slot+query pairs from a rebuild)
 *  3. Run selectSourceImageForSlot through the full slot sequence
 *  4. Assert contracts: all filled, no duplicates, hero sizing, logo isolation
 *
 * No LLM calls, no running instance — pure function eval against captured data.
 * Catches regressions in the source-image matching pipeline.
 *
 * Usage:
 *   pnpm --filter rebuild-media eval
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  selectSourceImageForSlot,
  toServableSlotUrl,
  tokenize,
} from '@airo/agents/rebuild-source-media';

interface SourceImageAsset {
  localPath: string;
  type: string;
  usageContext?: string | null;
  description?: string | null;
  alt?: string | null;
  dimensions?: { width: number; height: number } | null;
  sourcePages?: string[];
  placement?: Record<string, unknown> | null;
}

interface SlotQuery {
  slot: string;
  query: string;
}

interface Fixture {
  name: string;
  images: SourceImageAsset[];
  slots: SlotQuery[];
  rootPath: string;
}

interface Contract {
  description: string;
  check: (results: SlotResult[], fixture: Fixture) => boolean;
}

interface SlotResult {
  slot: string;
  query: string;
  url: string | null;
  alternatives: string[];
}

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

// ----- Contracts ----------------------------------------------------------
// Each contract is one invariant we expect to hold for any rebuild site.
// Failures should be actionable — "hero got a tiny image" not "something wrong."

const CONTRACTS: Contract[] = [
  {
    description: 'All content slots filled (no null = no Getty fallthrough)',
    check: (results) => results.every((r) => r.url !== null),
  },
  {
    description: 'No duplicate images across slots (dedup working)',
    check: (results) => {
      const urls = results.filter((r) => r.url).map((r) => r.url!);
      return new Set(urls).size === urls.length;
    },
  },
  {
    description: 'All URLs in the servable /airo-assets/uploads/ form',
    check: (results) =>
      results
        .filter((r) => r.url)
        .every((r) => r.url!.startsWith('/airo-assets/uploads/')),
  },
  {
    description: 'Hero slot gets a large image (>= 1MP)',
    check: (results, fixture) => {
      const heroResult = results.find((r) => /hero|banner/.test(r.slot));
      if (!heroResult?.url) return false;
      // Reverse-lookup: find the source image by matching the basename
      const heroBasename = heroResult.url.split('/').pop();
      const heroImage = fixture.images.find(
        (img) => img.localPath.split('/').pop() === heroBasename,
      );
      if (!heroImage?.dimensions) return false;
      const mp =
        (heroImage.dimensions.width * heroImage.dimensions.height) / 1_000_000;
      return mp >= 1.0;
    },
  },
  {
    description: 'Logo slot (if present) gets a logo-role image, not a content photo',
    check: (results, fixture) => {
      const logoResult = results.find((r) => /logo/.test(r.slot));
      if (!logoResult?.url) return true; // no logo slot = vacuously true
      const logoBasename = logoResult.url.split('/').pop();
      const logoImage = fixture.images.find(
        (img) => img.localPath.split('/').pop() === logoBasename,
      );
      return (
        logoImage?.usageContext === 'logo' ||
        (logoImage?.placement as Record<string, unknown>)?.inHeader === true
      );
    },
  },
  {
    description: 'Content slots have at least 1 alternative for the swap UX',
    check: (results) =>
      results
        .filter((r) => r.url && !/logo/.test(r.slot))
        .every((r) => r.alternatives.length >= 1),
  },
];

// ----- Runner -------------------------------------------------------------

async function listFixtureNames(): Promise<string[]> {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function loadFixture(name: string): Promise<Fixture> {
  const imagesRaw = await readFile(
    path.join(FIXTURES_DIR, name, 'source-images.json'),
    'utf-8',
  );
  const slotsRaw = await readFile(
    path.join(FIXTURES_DIR, name, 'slot-queries.json'),
    'utf-8',
  );
  const { assets } = JSON.parse(imagesRaw) as { assets: SourceImageAsset[] };
  const { slots, rootPath } = JSON.parse(slotsRaw) as {
    slots: SlotQuery[];
    rootPath: string;
  };
  return { name, images: assets, slots, rootPath };
}

function runSlotSequence(fixture: Fixture): SlotResult[] {
  const usedUrls = new Set<string>();
  const results: SlotResult[] = [];

  // Filter homepage images (same logic as fillSlotFromRebuildSource)
  const isHomepage = (url: string): boolean => {
    try {
      const p = new URL(url).pathname;
      return p === fixture.rootPath || p === fixture.rootPath + '/';
    } catch {
      return url === fixture.rootPath || url === '/';
    }
  };

  for (const { slot, query } of fixture.slots) {
    const homeImages = slot.startsWith('pages/home')
      ? fixture.images.filter((a) =>
          (a.sourcePages ?? []).some((u) => isHomepage(u)),
        )
      : [];
    const primaryPool =
      homeImages.length > 0 ? homeImages : fixture.images;

    const pick =
      selectSourceImageForSlot(primaryPool, slot, query, usedUrls) ??
      selectSourceImageForSlot(fixture.images, slot, query, usedUrls) ??
      selectSourceImageForSlot(fixture.images, slot, query, new Set());

    if (pick) {
      const servableUrl = toServableSlotUrl(pick.url);
      usedUrls.add(servableUrl);
      results.push({
        slot,
        query,
        url: servableUrl,
        alternatives: pick.alternatives.map(toServableSlotUrl),
      });
    } else {
      results.push({ slot, query, url: null, alternatives: [] });
    }
  }

  return results;
}

// ----- Main ---------------------------------------------------------------

async function main(): Promise<void> {
  const fixtureNames = await listFixtureNames();
  console.log(`\nrebuild-media eval — ${fixtureNames.length} fixture(s)\n`);

  let totalPass = 0;
  let totalFail = 0;

  for (const name of fixtureNames) {
    const fixture = await loadFixture(name);
    const results = runSlotSequence(fixture);

    console.log(`── ${name} (${fixture.images.length} images, ${fixture.slots.length} slots)`);

    // Show slot assignments
    for (const r of results) {
      const status = r.url ? '✓' : '✗';
      const basename = r.url?.split('/').pop() ?? '(MISS → Getty)';
      console.log(`   ${status} ${r.slot} → ${basename}`);
    }
    console.log('');

    // Run contracts
    for (const contract of CONTRACTS) {
      const passed = contract.check(results, fixture);
      const icon = passed ? '✅' : '❌';
      console.log(`   ${icon} ${contract.description}`);
      if (passed) totalPass++;
      else totalFail++;
    }
    console.log('');
  }

  // Summary
  const total = totalPass + totalFail;
  console.log(`\n${totalPass}/${total} contracts passed`);
  if (totalFail > 0) {
    console.log(`❌ ${totalFail} FAILED — source-image matching has regressed`);
    process.exit(1);
  } else {
    console.log('✅ All contracts pass — source images correctly selected over Getty');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
