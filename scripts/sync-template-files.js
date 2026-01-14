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
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
      '4e602bf93117af87df4621edc156282c'  // Current version - adds express.static("client") middleware
    ],
    force: false
  },
  {
    file: 'src/components/CookieBanner.tsx',
    description: 'cookie consent banner for C2 analytics',
    known_hashes: [],
    force: false
  },
  {
    file: 'src/layouts/RootLayout.tsx',
    description: 'Root layout with CookieBanner component',
    known_hashes: [
      'a4956fef6d7b07ada0017265268436ad', // Version without CookieBanner
      '3b60b06116874cd0632eb47ea5f96f80', // 8c484796 - Simplify Header and Footer
      '278eb10635f8543359cfa77a47fb4122'  // 153b8e50 - Add dynamic context
    ],
    force: false
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
    file: 'vite.config.ts',
    description: 'Vite configuration with configurable host binding',
    known_hashes: [
      '16269c87b3b6fc698e25d57e46a431f7'  // Current version - hardcoded host: "0.0.0.0"
    ],
    force: false
  }
];

function md5(content) {
  return createHash('md5').update(content).digest('hex');
}

function sync(baseDir, customerDir) {
  console.log('=== Template File Sync ===');
  console.log(`Base template: ${baseDir}`);
  console.log(`Customer app:  ${customerDir}`);
  console.log('');

  let synced = 0;
  let skipped = 0;
  let created = 0;

  for (const entry of SYNC_MANIFEST) {
    const { file, description, known_hashes, force } = entry;
    const basePath = join(baseDir, file);
    const customerPath = join(customerDir, file);

    console.log(`Checking: ${file}`);

    // Check if base template has the file
    if (!existsSync(basePath)) {
      console.log(`  ⚠️  Base template missing file, skipping`);
      skipped++;
      continue;
    }

    const baseContent = readFileSync(basePath, 'utf8');

    // Check if customer app has the file
    if (!existsSync(customerPath)) {
      console.log(`  📄 File doesn't exist in customer app, creating...`);
      mkdirSync(dirname(customerPath), { recursive: true });
      writeFileSync(customerPath, baseContent, 'utf8');
      console.log(`  ✅ Created: ${file}`);
      created++;
      continue;
    }

    // File exists, check if we should replace it
    const customerContent = readFileSync(customerPath, 'utf8');
    const customerHash = md5(customerContent);

    console.log(`  Current hash: ${customerHash}`);

    // Force sync if flag is set
    if (force) {
      console.log(`  🔄 Force sync enabled, replacing...`);
      writeFileSync(customerPath, baseContent, 'utf8');
      console.log(`  ✅ Synced: ${file}`);
      synced++;
      continue;
    }

    // Check if hash matches any known hash
    if (known_hashes.includes(customerHash)) {
      console.log(`  🔄 Hash matches known version, replacing...`);
      writeFileSync(customerPath, baseContent, 'utf8');
      console.log(`  ✅ Synced: ${file}`);
      synced++;
      continue;
    }

    // Hash doesn't match - file was modified by customer
    console.log(`  ⏭️  Hash doesn't match known versions, skipping (customer modified)`);
    skipped++;
  }

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

