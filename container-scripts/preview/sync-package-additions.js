#!/usr/bin/env node

/**
 * Sync additions from one package.json to another
 *
 * Usage: node sync-package-additions.js <source.json> <target.json>
 *
 * This script will:
 * - Add new scripts from source to target
 * - Add new dependencies from source to target
 * - Add new devDependencies from source to target
 * - Never modify or delete existing entries in target, except for targeted
 *   backport overrides (see the `pinBrokenPackage` block below) used to heal
 *   known-bad package specs in already-deployed apps.
 */

import { readFileSync, writeFileSync } from 'node:fs';

function syncAdditions(sourcePath, targetPath) {
  console.log(`Reading source: ${sourcePath}`);
  console.log(`Reading target: ${targetPath}`);

  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));

  const sections = ['imports', 'scripts', 'dependencies', 'devDependencies'];
  let addedCount = 0;

  sections.forEach(function processSection(section) {
    if (!source[section]) {
      console.log(`\nNo ${section} in source, skipping...`);
      return;
    }

    if (!target[section]) {
      target[section] = {};
    }

    const additions = [];

    Object.keys(source[section]).forEach(function checkKey(key) {
      if (!target[section][key]) {
        target[section][key] = source[section][key];
        additions.push(`  + ${key}: ${source[section][key]}`);
        addedCount++;
      }
    });

    if (additions.length > 0) {
      console.log(`\n${section}:`);
      additions.forEach(function logAddition(addition) {
        console.log(addition);
      });
    } else {
      console.log(`\n${section}: No new additions`);
    }
  });

  // Targeted backport: heal apps still carrying a broken
  // vite-plugin-api-routes spec so publish starts working again. Upstream
  // 1.2.7 added `build.watch.exclude` (see
  // https://github.com/yracnet/vite-plugin-api-routes/commit/f83e33243f8c435b1efbaaf7f2d5a006daff270d)
  // which breaks `vite build` and causes publish to fail. The template now
  // pins to 1.2.6, but sync-package-additions only adds missing entries — so
  // without this override, existing apps keep the broken `^1.2.6` range and
  // re-resolve to 1.2.7 on the next `npm install`.
  //
  // Only rewrite known-bad specs so we don't clobber apps that have been
  // manually remediated to a newer fixed release. Remove this block once all
  // prod apps have been rescheduled and converged off the broken specs.
  const BROKEN_VITE_API_ROUTES_SPECS = new Set(['^1.2.6', '1.2.7']);
  let pinnedBrokenPackage = false;
  ['dependencies', 'devDependencies'].forEach(function pinBrokenPackage(section) {
    const current = target[section]?.['vite-plugin-api-routes'];
    if (current !== undefined && BROKEN_VITE_API_ROUTES_SPECS.has(current)) {
      target[section]['vite-plugin-api-routes'] = '1.2.6';
      console.log(`\nPinning ${section}.vite-plugin-api-routes: ${current} -> 1.2.6`);
      pinnedBrokenPackage = true;
    }
  });

  if (addedCount > 0 || pinnedBrokenPackage) {
    let writeSummary;
    if (addedCount > 0 && pinnedBrokenPackage) {
      writeSummary = `${addedCount} additions and package pin updates`;
    } else if (addedCount > 0) {
      writeSummary = `${addedCount} additions`;
    } else {
      writeSummary = 'package pin updates';
    }
    console.log(`\n✅ Writing ${writeSummary} to ${targetPath}`);
    writeFileSync(targetPath, JSON.stringify(target, null, 2) + '\n', 'utf8');
  } else {
    console.log('\n✅ No additions needed, target is up to date');
  }
}

const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error('Usage: node sync-package-additions.js <source.json> <target.json>');
  console.error('');
  console.error('Example:');
  console.error('  node sync-package-additions.js ./source/package.json ./target/package.json');
  process.exit(1);
}

const [sourcePath, targetPath] = args;

try {
  syncAdditions(sourcePath, targetPath);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
