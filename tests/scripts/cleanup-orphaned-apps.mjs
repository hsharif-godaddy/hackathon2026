/**
 * One-shot cleanup for orphaned [e2e:*] apps left behind when a Playwright
 * worker is killed mid-test (timeout → respawn → afterAll never runs on the
 * killed worker, leaving its appId orphaned in the test account).
 *
 * Plain ESM JS so it runs under `node` directly (the workspace's
 * supply-chain settings block on-demand installs of `tsx`/`ts-node`).
 *
 * Usage:
 *   node tests/scripts/cleanup-orphaned-apps.mjs                 # default env=test
 *   node tests/scripts/cleanup-orphaned-apps.mjs --env=test
 *   node tests/scripts/cleanup-orphaned-apps.mjs --dry-run       # list, no delete
 *
 * STATUS: TEMPORARILY OUT OF SERVICE. The script previously relied on the
 * storageState file produced by `tests/e2e-v2/auth.setup.ts`, but that
 * setup project was removed when the e2e-v2 suite moved to per-test live
 * SSO (see playwright.config.ts notes). To restore this script, port the
 * UI login from `tests/helpers/auth.ts` (`loginIfNeeded`) into a plain JS
 * inline form here, or run the eviction guard inside the spec
 * (`evictOldestE2eAppsToFitLimit` in `tests/helpers/api.ts`) which already
 * handles ongoing cleanup. Manual deletion via the /apps UI is the
 * fallback in the meantime.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const E2E_PREFIX_MARKER = '[e2e:';

const ENV_HOSTS = {
  test: 'https://airo-builder.test-godaddy.com',
  prod: 'https://airo-builder.godaddy.com',
};

function authStateFile(env) {
  return path.resolve(__dirname, '..', '.auth', `e2e-v2-${env}.json`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const envArg = args.find((a) => a.startsWith('--env='));
  const env = envArg ? envArg.slice('--env='.length) : 'test';
  const dryRun = args.includes('--dry-run');
  return { env, dryRun };
}

async function main() {
  const { env, dryRun } = parseArgs();
  const host = ENV_HOSTS[env];
  if (!host) {
    console.error(`Unknown env "${env}". Supported: ${Object.keys(ENV_HOSTS).join(', ')}`);
    process.exit(2);
  }

  const stateFile = authStateFile(env);
  if (!fs.existsSync(stateFile)) {
    console.error(`storageState not found: ${stateFile}`);
    console.error(
      'This script is temporarily out of service: the e2e-v2 auth.setup project ' +
        'that produced the storageState file was removed when the suite switched ' +
        'to per-test live SSO. See the file header for restoration notes.',
    );
    process.exit(2);
  }

  console.log(`Cleanup target: ${host} (env=${env})${dryRun ? ' [DRY RUN]' : ''}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ storageState: stateFile });
  const page = await ctx.newPage();

  try {
    await page.goto(host);

    const sites = await page.evaluate(async () => {
      const res = await fetch('/api/sites');
      if (!res.ok) throw new Error(`GET /api/sites returned ${res.status}`);
      return await res.json();
    });

    const orphans = sites.filter((s) => {
      const fields = [s.name, s.initial_prompt].filter(Boolean).join(' ');
      return fields.includes(E2E_PREFIX_MARKER);
    });

    console.log(`Total apps: ${sites.length}`);
    console.log(`Orphaned [e2e:*] apps: ${orphans.length}`);
    for (const s of orphans) {
      const label = s.name || s.initial_prompt || '(unnamed)';
      console.log(`  ${s.id}  ${label.slice(0, 80)}`);
    }

    if (dryRun || orphans.length === 0) {
      return;
    }

    let deleted = 0;
    let failed = 0;
    for (const site of orphans) {
      const result = await page.evaluate(async (id) => {
        const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
        return { ok: res.ok, status: res.status };
      }, site.id);
      if (result.ok) {
        deleted++;
        console.log(`  ✓ deleted ${site.id}`);
      } else {
        failed++;
        console.log(`  ✗ ${site.id} → HTTP ${result.status}`);
      }
    }
    console.log(`Done. Deleted ${deleted}, failed ${failed}.`);
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
