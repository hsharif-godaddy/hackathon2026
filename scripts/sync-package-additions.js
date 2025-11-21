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
 * - Never modify or delete existing entries in target
 */

import { readFileSync, writeFileSync } from 'node:fs';

function syncAdditions(sourcePath, targetPath) {
  console.log(`Reading source: ${sourcePath}`);
  console.log(`Reading target: ${targetPath}`);

  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const target = JSON.parse(readFileSync(targetPath, 'utf8'));

  const sections = ['scripts', 'dependencies', 'devDependencies'];
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

  if (addedCount > 0) {
    console.log(`\n✅ Writing ${addedCount} additions to ${targetPath}`);
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

