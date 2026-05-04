#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), '..');
const baseRef = process.env.MIGRATION_SMOKE_BASE_REF || 'origin/main';
const keepTmp = process.env.KEEP_MIGRATION_SMOKE_TMP === '1';

const baseTemplateDir = join(repoRoot, 'app-templates/v8');
const syncPackageScript = join(repoRoot, 'container-scripts/preview/sync-package-additions.js');
const syncTemplateScript = join(repoRoot, 'container-scripts/preview/sync-template-files.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (result.status === null || result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    const reason =
      result.status === null ? `signal ${result.signal ?? 'unknown'}` : `exit ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed with ${reason}`);
  }

  return result.stdout?.trim() ?? '';
}

function ensureBaseRef() {
  const result = spawnSync('git', ['rev-parse', '--verify', baseRef], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status === 0) return;
  if (baseRef !== 'origin/main') {
    throw new Error(`Could not resolve MIGRATION_SMOKE_BASE_REF=${baseRef}`);
  }

  run('git', ['fetch', 'origin', 'main:refs/remotes/origin/main']);
}

function assertFileContains(path, expected) {
  const content = readFileSync(path, 'utf8');
  if (!content.includes(expected)) {
    throw new Error(`${path} does not contain expected text: ${expected}`);
  }
}

function main() {
  ensureBaseRef();

  const tmpRoot = mkdtempSync(join(tmpdir(), 'v8-template-migration-smoke-'));
  const archivePath = join(tmpRoot, 'origin-template.tar');
  const extractDir = join(tmpRoot, 'extract');
  const customerDir = join(tmpRoot, 'customer-app');

  try {
    console.log(`Using base ref: ${baseRef}`);
    console.log(`Working directory: ${tmpRoot}`);

    run('git', ['archive', '--format=tar', `--output=${archivePath}`, baseRef, 'app-templates/v8']);
    mkdirSync(extractDir, { recursive: true });
    run('tar', ['-xf', archivePath, '-C', extractDir]);
    cpSync(join(extractDir, 'app-templates/v8'), customerDir, { recursive: true });

    // Match the preview restart sequence: package additions land before the
    // template manifest/migration pass, and npm install refreshes lockfile
    // state for the migrated app before build.
    run('node', [syncPackageScript, join(baseTemplateDir, 'package.json'), join(customerDir, 'package.json')]);
    run('node', [syncTemplateScript, baseTemplateDir, customerDir]);

    assertFileContains(join(customerDir, 'package.json'), '--ssr src/server/entry.ts');
    assertFileContains(join(customerDir, 'index.html'), '<!--app-head-->');
    assertFileContains(join(customerDir, 'index.html'), '<!--app-html-->');
    assertFileContains(join(customerDir, 'src/server/entry.ts'), '// <api-imports>');
    assertFileContains(join(customerDir, 'src/server/entry.ts'), '// <api-registrations>');

    // The archived template may carry an old .npmrc; force public npm for the
    // throwaway customer app so this smoke stays independent of workspace
    // registry setup.
    writeFileSync(join(customerDir, '.npmrc'), 'registry=https://registry.npmjs.org/\nfund=false\naudit=false\n', 'utf8');

    run('npm', ['install', '--no-fund', '--no-audit'], { cwd: customerDir });
    run('npm', ['run', 'build'], { cwd: customerDir });

    const serverBundlePath = join(customerDir, 'dist/server.bundle.mjs');
    const clientIndexPath = join(customerDir, 'dist/client/index.html');
    if (!existsSync(serverBundlePath)) {
      throw new Error(`Expected SSR bundle not found: ${serverBundlePath}`);
    }
    run('node', ['--check', serverBundlePath]);
    if (!existsSync(clientIndexPath)) {
      throw new Error(`Expected client index not found: ${clientIndexPath}`);
    }

    console.log('V8 template migration smoke passed');
  } finally {
    if (keepTmp) {
      console.log(`Keeping temporary directory: ${tmpRoot}`);
    } else {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

main();
