#!/usr/bin/env node

/**
 * Sync template files from base app template to customer app
 *
 * Usage: node sync-template-files.js <base-app-dir> <customer-app-dir>
 *
 * This script will:
 * - Check each file in the manifest against the customer app
 * - If file doesn't exist in customer app, copy it from base template
 * - If file exists and its MD5 matches a known hash, replace it with base template version
 * - If file exists but hash doesn't match, skip it (customer has modified the file)
 * - If force flag is set, always replace the file
 * - Run migrations for targeted transforms on specific files
 *
 * Sync groups (e.g. cookieBanner for App.tsx + RootLayout.tsx) are applied atomically:
 * we only sync a group if every file in the group would be synced. That avoids partial
 * updates (e.g. updating App.tsx but not RootLayout.tsx) which could result in duplicate
 * cookie banners.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

/**
 * Manifest of files to sync from base template to customer apps.
 *
 * Each entry contains:
 * - file: Path relative to app root
 * - description: Why this file needs syncing
 * - known_hashes: MD5 hashes of unmodified versions that are safe to replace
 * - force: If true, always replace (use sparingly, for files that should never be modified)
 * - syncGroup: Optional. Entries with the same syncGroup are synced atomically: we only
 *   sync a group if every file in the group would be synced. Prevents partial updates
 *   (e.g. App.tsx + RootLayout.tsx for cookie banner: both or neither to avoid duplicate banners).
 *
 * To add a new hash:
 * 1. Find the commit with the old version: git log --oneline -- <file>
 * 2. Get the hash: git show <commit>:<file> | md5
 * 3. Add it to the known_hashes array
 */
const SYNC_MANIFEST = [
  {
    file: 'src/server/configure.js',
    description: 'Server configuration with SPA fallback middleware for client-side routing',
    known_hashes: [
      '42ba9f4178f0125d150e0453b18aace0', // 0d42af30 - fix: various improvements to local development
      '2accfb4db2acca217a56610abbeff409', // 8c779b55 - feat: changes to support app publish
      '4e602bf93117af87df4621edc156282c', // Before import.meta.url fix - uses express.static("client")
      'f31a3e2c5c87fb16212a911612d7a3fd', // Before database extraction to skill - on origin/main
      '5fbbdcc5d9cf08913df35a0c72885356'  // Before cache-control headers
    ],
    force: false
  },
  {
    file: 'src/App.tsx',
    description: 'App entry with CookieBanner and RootLayout wrapper',
    known_hashes: [
      '307d295de691b65ea9217a74ca9d02d6', // 0bd48df3b - before CookieBanner
      '966395da41e36083d6bd9e08811ef3ea'  // intermediate - inline CookieBannerErrorBoundary (before extraction to own file)
    ],
    force: false,
    syncGroup: 'cookieBanner'
  },
  {
    file: 'src/components/CookieBanner.tsx',
    description: 'cookie consent banner for C2 analytics',
    known_hashes: [
      '1785601300e3d9d95e5da2c53aa155a3', // c054fea9 - Implement CookieBanner component for analytics
      'c23c35c1239baf9990b60ac54c7c4b97'  // d4d5fb79 - i18n round
    ],
    force: false
  },
  {
    file: 'src/components/CookieBannerErrorBoundary.tsx',
    description: 'Error boundary for CookieBanner component',
    known_hashes: [],
    force: true
  },
  {
    file: 'src/layouts/RootLayout.tsx',
    description: 'Root layout',
    known_hashes: [
      'a4956fef6d7b07ada0017265268436ad', // Version without CookieBanner
      '3b60b06116874cd0632eb47ea5f96f80', // 8c484796 - Simplify Header and Footer
      '278eb10635f8543359cfa77a47fb4122', // 153b8e50 - Add dynamic context
      '398cc701e5338594788187c0ac488712', // 0bd48df3b - FIX: Use ENV mode
      '89379a72aadeed8ac76dee704aabfd91', // main - WITH CookieBanner (pre-PR)
      '72c4eef20dcee8a90cd547b1a042ad70'  // This PR - CookieBanner removed
    ],
    force: false,
    syncGroup: 'cookieBanner'
  },
  {
    file: 'public/analytics.js',
    description: 'GoDaddy Signals analytics library initialization script',
    known_hashes: [
      '37c4e2e42c74028b41d692b990bd3883'  // e4b56fd8 - Original version that auto-loads analytics
    ],
    force: false
  },
  {
    file: 'index.html',
    description: 'Main HTML file that loads the React app and analytics script',
    known_hashes: [
      '2b36ce7723f0a17d0a735b65079f3e7c', // 072cb636 - Before analytics was added
      '5a13fd960f9e484c4b92e2fc927518b3'  // f482954c - Current version with refactored analytics
    ],
    force: false
  },
  {
    file: 'tailwind.config.js',
    description: 'Tailwind configuration',
    known_hashes: [
      'dc4000c310080b563197be98cf2069d8'  // Before dev-tools/src content path was added
    ],
    force: false
  },
  {
    file: 'vite.config.ts',
    description: 'Vite build and dev server configuration',
    known_hashes: [
      '16269c87b3b6fc698e25d57e46a431f7', // Older version - hardcoded host: "0.0.0.0"
      'a4186186a022994547055e21bc92ceaa', // 0d42af30 - before errorInterceptor removal
      'd18a56841b551364f6ec0c0cdeccaca2', // e9c5d478 - configurable host binding
      '4bec07f7c9c3412478c08afd333ece87', // 08a99145 - errorInterceptor removed (broken)
      'd26b3f1349b07a524c7df4df29c55883', // 4839907 - added watch.ignored
      '29ca0ea18a635f996d4716ad1d0f43b3', // Before closeBundle plugin and chunk splitting
      '385752a8951868d101668ae3f5c9637b'  // fd075bd8 - closeBundle plugin, before resolve.dedupe
    ],
    force: false
  },
  {
    file: 'src/components/ui/sonner.tsx',
    description: 'Sonner toaster component',
    known_hashes: [
      '22e6ae1898a423aff378e0664323a9ae'  // Original shadcn template with next-themes
    ],
    force: false
  }
];

/**
 * Migrations run targeted transforms on specific files rather than hash-based
 * whole-file replacement. Each migration has an `id` (for logging) and a `run`
 * function that receives the customer app directory and the set of files that
 * were synced (so migrations can gate on prerequisite syncs).
 */
const MIGRATIONS = [
  {
    id: 'remove-bundle-js-build-step',
    description: 'Remove redundant bundle.js from build pipeline',
    run(customerDir, syncedFiles) {
      // Only safe to remove the old bundle step if both:
      // 1. vite.config.ts was synced (contains the replacement serverBundlePlugin)
      // 2. src/server/configure.js was synced (uses import.meta.url for __dirname)
      // The old bundle.js patched express.static("client") → __dirname-based path at
      // build time. The new configure.js resolves paths via import.meta.url instead,
      // and serverBundlePlugin polyfills import.meta.url in CJS. Without both, removing
      // bundle.js would break static file serving in production.
      const required = ['vite.config.ts', 'src/server/configure.js'];
      const missing = required.filter(f => !syncedFiles.has(f));
      if (missing.length > 0) {
        console.log(`  ⏭️  Skipping: ${missing.join(', ')} not synced (customer modified), removing bundle.js would break the build`);
        return;
      }
      // 1. Patch package.json build script first (can fail on JSON parse),
      //    before deleting bundle.js — avoids leaving a broken build script
      //    referencing a deleted file.
      const pkgPath = join(customerDir, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        let changed = false;

        if (pkg.scripts?.build) {
          const updated = pkg.scripts.build.replace(/\s*&&\s*node\s+bundle\.js\s*/g, '').trim();
          if (updated !== pkg.scripts.build) {
            pkg.scripts.build = updated;
            changed = true;
          }
        }
        if (pkg.scripts?.bundle) {
          delete pkg.scripts.bundle;
          changed = true;
        }
        if (pkg.scripts?.['build:vite'] && pkg.scripts?.build === pkg.scripts['build:vite']) {
          delete pkg.scripts['build:vite'];
          changed = true;
        }

        if (changed) {
          writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          console.log('  Patched package.json build scripts');
        }
      }

      // 2. Delete bundle.js after package.json is safely updated
      const bundlePath = join(customerDir, 'bundle.js');
      if (existsSync(bundlePath)) {
        unlinkSync(bundlePath);
        console.log('  Deleted bundle.js');
      }
    }
  }
];

function md5(content) {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Decide for each manifest entry whether we would sync it (without writing).
 * Returns Map<index, boolean>. Also returns { baseContents: Map<index, string> } for use in second pass.
 */
function computeWouldSync(baseDir, customerDir) {
  const wouldSync = new Map();
  const baseContents = new Map();

  for (let i = 0; i < SYNC_MANIFEST.length; i++) {
    const entry = SYNC_MANIFEST[i];
    const { file, known_hashes, force } = entry;
    const basePath = join(baseDir, file);
    const customerPath = join(customerDir, file);

    if (!existsSync(basePath)) {
      wouldSync.set(i, false);
      continue;
    }

    const baseContent = readFileSync(basePath, 'utf8');
    baseContents.set(i, baseContent);

    if (force) {
      wouldSync.set(i, true);
      continue;
    }

    if (!existsSync(customerPath)) {
      wouldSync.set(i, true);
      continue;
    }

    const customerContent = readFileSync(customerPath, 'utf8');
    const customerHash = md5(customerContent);
    wouldSync.set(i, known_hashes.includes(customerHash));
  }

  // Apply sync groups: only sync a group if every file in the group would be synced
  const groupToIndices = new Map();
  for (let i = 0; i < SYNC_MANIFEST.length; i++) {
    const group = SYNC_MANIFEST[i].syncGroup;
    if (!group) continue;
    if (!groupToIndices.has(group)) groupToIndices.set(group, []);
    groupToIndices.get(group).push(i);
  }
  for (const indices of groupToIndices.values()) {
    const allWouldSync = indices.every((idx) => wouldSync.get(idx));
    if (!allWouldSync) {
      for (const idx of indices) {
        wouldSync.set(idx, false);
      }
    }
  }

  return { wouldSync, baseContents };
}

function runMigrations(customerDir, syncedFiles) {
  console.log('');
  console.log('=== Running Migrations ===');

  for (const migration of MIGRATIONS) {
    console.log(`Migration: ${migration.id} — ${migration.description}`);
    try {
      migration.run(customerDir, syncedFiles);
    } catch (error) {
      console.error(`  ⚠️  Migration failed: ${error.message}`);
    }
  }
}

function sync(baseDir, customerDir) {
  console.log('=== Template File Sync ===');
  console.log(`Base template: ${baseDir}`);
  console.log(`Customer app:  ${customerDir}`);
  console.log('');

  const { wouldSync, baseContents } = computeWouldSync(baseDir, customerDir);

  const syncedFiles = new Set();
  let synced = 0;
  let skipped = 0;
  let created = 0;

  for (let i = 0; i < SYNC_MANIFEST.length; i++) {
    const entry = SYNC_MANIFEST[i];
    const { file, force, syncGroup } = entry;
    const basePath = join(baseDir, file);
    const customerPath = join(customerDir, file);

    console.log(`Checking: ${file}`);

    if (!existsSync(basePath)) {
      console.log(`  ⚠️  Base template missing file, skipping`);
      skipped++;
      continue;
    }

    const baseContent = baseContents.get(i);

    if (!wouldSync.get(i)) {
      if (existsSync(customerPath)) {
        const customerContent = readFileSync(customerPath, 'utf8');
        const customerHash = md5(customerContent);
        console.log(`  Current hash: ${customerHash}`);
      }
      if (syncGroup) {
        console.log(`  ⏭️  Skipping (sync group "${syncGroup}": sync all or none to avoid inconsistent state)`);
      } else {
        console.log(`  ⏭️  Hash doesn't match known versions, skipping (customer modified)`);
      }
      skipped++;
      continue;
    }

    if (!existsSync(customerPath)) {
      console.log(`  📄 File doesn't exist in customer app, creating...`);
      mkdirSync(dirname(customerPath), { recursive: true });
      writeFileSync(customerPath, baseContent, 'utf8');
      console.log(`  ✅ Created: ${file}`);
      syncedFiles.add(file);
      created++;
      continue;
    }

    const customerContent = readFileSync(customerPath, 'utf8');
    const customerHash = md5(customerContent);
    console.log(`  Current hash: ${customerHash}`);

    if (force) {
      console.log(`  🔄 Force sync enabled, replacing...`);
      writeFileSync(customerPath, baseContent, 'utf8');
      console.log(`  ✅ Synced: ${file}`);
      syncedFiles.add(file);
      synced++;
      continue;
    }

    console.log(`  🔄 Hash matches known version, replacing...`);
    writeFileSync(customerPath, baseContent, 'utf8');
    console.log(`  ✅ Synced: ${file}`);
    syncedFiles.add(file);
    synced++;
  }

  // Run migrations after hash-based sync
  runMigrations(customerDir, syncedFiles);

  console.log('');
  console.log('=== Summary ===');
  console.log(`Created: ${created}`);
  console.log(`Synced:  ${synced}`);
  console.log(`Skipped: ${skipped}`);
}

// Main
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: node sync-template-files.js <base-app-dir> <customer-app-dir>');
  console.error('');
  console.error('Example:');
  console.error('  node sync-template-files.js /base-app /customer-app');
  process.exit(1);
}

const [baseDir, customerDir] = args;

try {
  sync(baseDir, customerDir);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
