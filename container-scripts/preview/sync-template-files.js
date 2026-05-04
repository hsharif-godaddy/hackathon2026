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
 * Sync groups (e.g. ssrMigration for entry.ts + entry-server.tsx + main.tsx +
 * vite.config.ts) are applied atomically: we only sync a group if every file in the
 * group would be synced. That avoids partial updates (e.g. a new entry-server.tsx
 * paired with a stale vite.config.ts that doesn't know how to build it).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const METHOD_FILES = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

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
 *   (e.g. the ssrMigration group: entry.ts + entry-server.tsx + main.tsx + vite.config.ts sync all-or-nothing).
 *
 * To add a new hash:
 * 1. Find the commit with the old version: git log --oneline -- <file>
 * 2. Get the hash: git show <commit>:<file> | md5
 * 3. Add it to the known_hashes array
 */
const SYNC_MANIFEST = [
  {
    file: 'src/server/entry.ts',
    description: 'Express server entry (replaces configure.js + vite-plugin-api-routes)',
    known_hashes: [
      '97f7b2dca47358d1cdf6838aa346a13c', // before async render + redirect forwarding (data-router SSR)
      '102ddeac9f0c0017adf7405e1dbf3c92', // before non-redirect loader Response (error-response branch)
      '3d66a88d88b8ec09bf5098b474c7a56c', // before empty status-200 Response fallback handling
      'f0d49c600a0fc04550f9afe25f5f2f67'  // before sanitized API error responses
    ],
    force: false,
    syncGroup: 'ssrMigration'
  },
  {
    file: 'src/entry-server.tsx',
    description: 'SSR render entry point used by entry.ts in prod',
    known_hashes: [
      'e087bd8703e07221ae2902e246e8f862' // renderToString(<App url />) via BrowserRouter/StaticRouter split; before data-router refactor
    ],
    force: false,
    syncGroup: 'ssrMigration'
  },
  {
    file: 'src/lib/seo-routes.ts',
    description: 'Agent-editable registry of public routes for sitemap.xml',
    known_hashes: [],
    force: false
  },
  {
    file: 'src/main.tsx',
    description: 'Client entry; hydrateRoot when SSR markup present, createRoot otherwise',
    known_hashes: [
      '13101631d2bee2ae872743b93f8cb7a3', // createRoot only, before hydrateRoot branch
      'dc37acfb8a11bc79e0159310eaede77d'  // before data-router refactor (pre-2026-05-01)
    ],
    force: false,
    syncGroup: 'ssrMigration'
  },
  // App.tsx lives in the ssrMigration group so it lands atomically with
  // entry-server.tsx / main.tsx / entry.ts. entry-server.tsx no longer imports
  // App (stale App is not a crashloop anymore), but a mismatched App.tsx
  // (legacy BrowserRouter vs new data-router) would hydrate markup that does
  // not match the static render.
  {
    file: 'src/App.tsx',
    description: 'Client App - data-router RouterProvider with layout wrapper',
    known_hashes: [
      '307d295de691b65ea9217a74ca9d02d6', // 0bd48df3b - before CookieBanner
      '966395da41e36083d6bd9e08811ef3ea', // intermediate - inline CookieBannerErrorBoundary (before extraction)
      '9be50c9e3b4a1eeb6d385adc80f6dfa7', // pre-SSR createBrowserRouter version
      '1b5f3b0e5efcbde4ffeacb6069d8c539'  // BrowserRouter/StaticRouter split; before data-router refactor (pre-2026-05-01)
    ],
    force: false,
    syncGroup: 'ssrMigration'
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
      '72c4eef20dcee8a90cd547b1a042ad70', // Before ScrollToTop - CookieBanner removed
      '0d65cc5e501da40c7dc28ed173027125'  // #3311 (AIROBUILD-1478) - <ScrollRestoration />; template comment refreshed in SSR branch
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
    // Intentionally NOT in syncGroup: 'ssrMigration'. Agents edit index.html
    // frequently (e.g. <title>, favicon, analytics), so a customer-modified
    // index.html would otherwise block the whole SSR group from syncing.
    // The inject-ssr-markers migration handles modified-by-customer index.html
    // separately; unmodified hashes here keep the template-sync path working.
    description: 'Main HTML file that loads the React app and analytics script',
    known_hashes: [
      '2b36ce7723f0a17d0a735b65079f3e7c', // 072cb636 - Before analytics was added
      '5a13fd960f9e484c4b92e2fc927518b3', // f482954c - Current version with refactored analytics
      '03d2c6061dba1a2d61870ba1c9e3e406', // Before import retry for transient Vite dep optimization errors
      '0b3e1d30a5b646e0fabfa7e657a582c9'  // before <!--app-head--> / <!--app-html--> SSR markers
    ],
    force: false
  },
  {
    file: 'tailwind.config.js',
    description: 'Tailwind configuration',
    known_hashes: [
      'dc4000c310080b563197be98cf2069d8', // Before dev-tools/src content path was added
      'f1a752489462cb9e7f63b4def57d22bb'  // ESM export with CommonJS require("tailwindcss-animate")
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
      '385752a8951868d101668ae3f5c9637b', // fd075bd8 - closeBundle plugin, before resolve.dedupe
      '23983daa85eb1afd36bd4e4c818f0d84', // 13898857b - resolve.dedupe, before ESM bundle (still CJS)
      'e35e331c50f1818c26185fda8721c9bc', // Before mediaVersionsPlugin
      'e5ef456d8dc6e5da9fb87a643c07a8a0', // c0f39562 (#2556) - mediaVersionsPlugin added, before envPrefix
      'c756114664418042ae7d4c2622ec6a24', // efb47df1 - mediaVersionsPlugin, before tscWatchPlugin
      'f7c0080a7b7a32e8fc84002ae4b478d5', // ed8aa444 (#2284) - tscWatchPlugin added, before extractHostname .host -> .hostname fix
      '3e9501608607628f08fd458d8831ecb8', // tscWatchPlugin, before extractHostname .host -> .hostname fix
      '0cd4b63e3ebfaa63088ac218924a9e6f', // before tscWatchPlugin removal (post-hook tsc migration)
      '641596ecb45dc0cfdcb2d49159b33cf6'  // before vite-plugin-api-routes removal and SSR build split
    ],
    force: false,
    syncGroup: 'ssrMigration'
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

function scanApiDir(apiDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // A subdir deleted between the parent readdirSync and this call races
      // to ENOENT. Mirrors the async guards in entry-api-sync.ts walk().
      // Other errors (EACCES/EIO on a subtree) must propagate — silently
      // omitting routes would make the regenerated entry.ts 404 them.
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = extname(entry.name);
      if (ext !== '.ts' && ext !== '.js') continue;
      const methodName = basename(entry.name, ext);
      if (!METHOD_FILES.has(methodName)) continue;

      const relDir = relative(apiDir, dirname(full));
      const routePath = relDir === ''
        ? '/'
        : '/' + relDir.split(sep).map((seg) => seg.replace(/^\[(.+)\]$/, ':$1')).join('/');

      const importPath = './api/' + (relDir === '' ? methodName : relDir.split(sep).join('/') + '/' + methodName);

      results.push({
        method: methodName.toLowerCase(),
        path: routePath,
        importPath,
        methodName,
        relDir,
      });
    }
  }
  walk(apiDir);
  return sortRoutes(results);
}

function sortRoutes(routes) {
  return routes.sort((a, b) => {
    const aParts = a.path.split('/').filter(Boolean);
    const bParts = b.path.split('/').filter(Boolean);
    const len = Math.min(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      const aIsParam = aParts[i].startsWith(':');
      const bIsParam = bParts[i].startsWith(':');
      if (aIsParam !== bIsParam) return aIsParam ? 1 : -1;
      const cmp = aParts[i].localeCompare(bParts[i]);
      if (cmp !== 0) return cmp;
    }
    if (aParts.length !== bParts.length) return aParts.length - bParts.length;
    return a.method.localeCompare(b.method);
  });
}

function identifierFor(entry, index) {
  const parts = entry.relDir === '' ? [] : entry.relDir.split(sep);
  parts.push(entry.methodName.toLowerCase());
  const base = parts
    .map((s) => s.replace(/^\[(.+)\]$/, '$1').replace(/[^a-zA-Z0-9]/g, '_'))
    .join('_');
  // Underscore-prefix when the base starts with a digit — JS identifiers
  // cannot start with a digit, so an API dir like src/server/api/2026/GET.ts
  // would otherwise emit `import 2026_get_0` and break the bundle parse.
  const safeBase = /^[0-9]/.test(base) ? `_${base}` : base;
  return `${safeBase || 'route'}_${index}`;
}

function generateEntryApiBlocks(entries) {
  if (entries.length === 0) {
    return { imports: '', registrations: '' };
  }
  const imports = entries
    .map((e, i) => `import ${identifierFor(e, i)} from ${JSON.stringify(e.importPath)};`)
    .join('\n');
  const registrations = entries
    .map((e, i) => `app.${e.method}(${JSON.stringify('/api' + (e.path === '/' ? '' : e.path))}, ${identifierFor(e, i)});`)
    .join('\n');
  return { imports, registrations };
}

/**
 * Returns true iff the customer app is fully migrated to SSR. Read-only,
 * never throws. Used to gate HTML migrations (marker injection, stale
 * <title> strip) which depend on SSR actually being wired end-to-end, not
 * just the presence of one sentinel file.
 */
export function isSsrInstalled(customerDir) {
  const entryPath = join(customerDir, 'src/server/entry.ts');
  const entryServerPath = join(customerDir, 'src/entry-server.tsx');
  const pkgPath = join(customerDir, 'package.json');
  const configurePath = join(customerDir, 'src/server/configure.js');

  if (!existsSync(entryServerPath)) return false;
  if (!existsSync(entryPath)) return false;
  if (existsSync(configurePath)) return false;

  try {
    const entry = readFileSync(entryPath, 'utf8');
    if (!/\/\/ <api-imports>[\s\S]*?\/\/ <\/api-imports>/.test(entry)) return false;
    if (!/\/\/ <api-registrations>[\s\S]*?\/\/ <\/api-registrations>/.test(entry)) return false;

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (!pkg.scripts?.build?.includes('--ssr')) return false;
    if (pkg.dependencies?.['vite-plugin-api-routes']) return false;
    if (pkg.devDependencies?.['vite-plugin-api-routes']) return false;
  } catch (err) {
    // ENOENT on pkgPath is a legitimate "not installed" state — entry.ts
    // exists but package.json doesn't. Silent false for that case.
    // Everything else (EACCES/EIO, JSON parse failure, EISDIR) is
    // unexpected; emit a structured event so Loki surfaces the root
    // cause instead of downstream HTML migrations silently skipping
    // with no indication why.
    if (!err || err.code !== 'ENOENT') {
      // console.error (not warn) — EACCES / EIO / corrupt package.json has
      // no self-healing path and blocks downstream HTML migrations. Alert
      // rules filtering on level=error would miss a warn.
      console.error(JSON.stringify({
        event: 'isSsrInstalled.read-error',
        code: err && err.code ? err.code : undefined,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    return false;
  }

  return true;
}

/**
 * Migrations run targeted transforms on specific files rather than hash-based
 * whole-file replacement. Each migration has an `id` (for logging) and a `run`
 * function that receives the customer app directory and the set of files that
 * were synced (so migrations can gate on prerequisite syncs).
 *
 * Return contract (see plan §6):
 * - 'applied' (or undefined) — body completed its primary work plan (writes,
 *   no-ops on already-converged state, or safe partial writes on customized
 *   paths where the core deliverable still landed).
 * - 'skipped' — migration's primary deliverable could not run (precondition
 *   not met, or a prerequisite file missing). Minor idempotent writes may
 *   still have landed, but the core work was omitted — operators reading
 *   migration.<id>.skipped in Loki know this migration did not achieve its
 *   SSR-install goal this run.
 * - throw — filesystem errors, JSON parse errors mid-rewrite, unexpected
 *   state. Propagates out of runMigrations, aborts sync-template-files.js
 *   with a non-zero exit, nomad_setup.sh's set -e skips the commit, and
 *   the next restart's git reset --hard discards the partial working tree.
 */
export const MIGRATIONS = [
  {
    id: 'remove-public-assets-gitignore',
    description: 'Remove public/assets from .gitignore so uploaded assets are tracked in git',
    run(customerDir, _syncedFiles) {
      const gitignorePath = join(customerDir, '.gitignore');
      if (!existsSync(gitignorePath)) return 'skipped';

      const content = readFileSync(gitignorePath, 'utf8');
      // Remove the "# Public Assets" comment and "public/assets" entry independently
      // so we catch cases where the comment was removed but the entry remains.
      // Match whole lines in multiline mode so both LF and CRLF files are handled,
      // and tolerate an optional trailing slash on "public/assets/".
      const updated = content
        .replace(/^# Public Assets\s*$\r?\n?/gm, '')
        .replace(/^public\/assets\/?\s*$\r?\n?/gm, '');
      if (updated !== content) {
        writeFileSync(gitignorePath, updated, 'utf8');
        console.log('  Removed public/assets from .gitignore');
      }

      return 'applied';
    }
  },
  {
    id: 'migrate-to-ssr-entry',
    description: 'Generate src/server/entry.ts API registrations, drop vite-plugin-api-routes/esbuild, delete configure.js',
    run(customerDir, _syncedFiles) {
      const entryPath = join(customerDir, 'src/server/entry.ts');
      const apiDir = join(customerDir, 'src/server/api');
      const entryServerPath = join(customerDir, 'src/entry-server.tsx');

      // SSR foundation must exist on disk before we touch any of the other
      // files. entry-server.tsx is the render entry that entry.ts imports at
      // runtime - without it the SSR branch will always throw.
      if (!existsSync(entryServerPath)) {
        console.log('  ⏭️  src/entry-server.tsx not present (SSR foundation not in place)');
        return 'skipped';
      }
      if (!existsSync(entryPath) || !existsSync(apiDir)) {
        console.log('  ⏭️  src/server/entry.ts or src/server/api not present');
        return 'skipped';
      }

      // 1. entry.ts API registrations. Idempotent: marked-block shape is
      // detected and rewritten in place; bare template shape is upgraded;
      // anything else (customer-modified) is left alone.
      let entryHasMarkers = false;
      const entries = scanApiDir(apiDir);
      const content = readFileSync(entryPath, 'utf8');
      const markedImportRe = /\/\/ <api-imports>[\s\S]*?\/\/ <\/api-imports>/;
      const markedRegRe = /\/\/ <api-registrations>[\s\S]*?\/\/ <\/api-registrations>/;
      const bareImportRe = /import healthGet from "\.\/api\/health\/GET";/;
      const bareRegRe = /app\.get\("\/api\/health", healthGet\);/;
      const alreadyMarked = markedImportRe.test(content) && markedRegRe.test(content);
      const bareTemplate = bareImportRe.test(content) && bareRegRe.test(content);

      if (alreadyMarked) {
        // Always rewrite: resyncs marked blocks to the current api dir, which
        // also zeros them out when the dir is empty. Prevents stale imports to
        // deleted handlers from surviving — isSsrInstalled() can then trust
        // marker presence without verifying import resolvability.
        const { imports, registrations } = generateEntryApiBlocks(entries);
        const importBlock = `// <api-imports>\n${imports}\n// </api-imports>`;
        const regBlock = `// <api-registrations>\n${registrations}\n// </api-registrations>`;
        const updated = content.replace(markedImportRe, importBlock).replace(markedRegRe, regBlock);
        if (updated !== content) {
          writeFileSync(entryPath, updated, 'utf8');
          console.log(`  Regenerated ${entries.length} API registration(s) in src/server/entry.ts`);
        }
        entryHasMarkers = true;
      } else if (bareTemplate) {
        if (entries.length === 0) {
          // Rewriting bare → marked with no routes would drop the health
          // import and leave entry.ts unrunnable.
          console.log('  No API handlers found in src/server/api; leaving bare entry.ts untouched');
          return 'skipped';
        }
        const { imports, registrations } = generateEntryApiBlocks(entries);
        const importBlock = `// <api-imports>\n${imports}\n// </api-imports>`;
        const regBlock = `// <api-registrations>\n${registrations}\n// </api-registrations>`;
        const updated = content.replace(bareImportRe, importBlock).replace(bareRegRe, regBlock);
        if (updated !== content) {
          writeFileSync(entryPath, updated, 'utf8');
          console.log(`  Generated ${entries.length} API registration(s) in src/server/entry.ts`);
        }
        entryHasMarkers = true;
      } else {
        console.log('  entry.ts does not match expected template markers; leaving as-is');
        return 'skipped';
      }

      // 2. package.json cleanup + SSR build script. Runs whenever entry.ts
      // is in marked state, so a partial-crash where step 1 landed but step 2
      // didn't will self-heal on the next restart. Each inspection is
      // idempotent (checking for presence before removal / rewrite).
      let buildHasSsr = false;
      if (entryHasMarkers) {
        const pkgPath = join(customerDir, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          let changed = false;

          if (pkg.dependencies && 'vite-plugin-api-routes' in pkg.dependencies) {
            delete pkg.dependencies['vite-plugin-api-routes'];
            changed = true;
            console.log('  Removed dependencies.vite-plugin-api-routes');
          }
          if (pkg.devDependencies && 'vite-plugin-api-routes' in pkg.devDependencies) {
            delete pkg.devDependencies['vite-plugin-api-routes'];
            changed = true;
            console.log('  Removed devDependencies.vite-plugin-api-routes');
          }
          if (pkg.devDependencies && 'esbuild' in pkg.devDependencies) {
            delete pkg.devDependencies.esbuild;
            changed = true;
            console.log('  Removed devDependencies.esbuild');
          }
          if (pkg.scripts && 'bundle' in pkg.scripts) {
            // Only strip the legacy `node bundle.js` / `node dist/bundle.js`
            // step. A customer / agent may have repurposed the `bundle` key
            // for unrelated tooling (e.g. "webpack --config webpack.prod.js"
            // or "node src/bundle/index.js"); deleting that would silently
            // destroy their build. Anchor to the exact legacy forms — a
            // `\bnode\b.*\bbundle\b` pattern false-positive-matches paths
            // like `src/bundle/index.js` because `/` is a word boundary.
            if (/^node\s+(?:\.\/)?(?:dist\/)?bundle(?:\.js)?$/.test(pkg.scripts.bundle.trim())) {
              delete pkg.scripts.bundle;
              changed = true;
              console.log('  Removed scripts.bundle (legacy node bundle.js step)');
            } else {
              console.log(`  ⚠️  scripts.bundle is customised (${pkg.scripts.bundle}); leaving as-is`);
            }
          }
          if (
            pkg.scripts &&
            'build:vite' in pkg.scripts &&
            pkg.scripts['build:vite'] === pkg.scripts.build
          ) {
            delete pkg.scripts['build:vite'];
            changed = true;
            console.log('  Removed redundant scripts["build:vite"]');
          }

          const build = pkg.scripts?.build;
          if (build) {
            if (!build.includes('--ssr')) {
              // Normalize legacy pipelines like `vite build && node bundle.js`
              // or `vite build && node dist/bundle.js`. Only replace when the
              // result is exactly `vite build` - anything else is customized
              // and must be left alone so we don't clobber customer logic.
              const normalized = build
                .replace(/&&\s*node\s+bundle(?:\.js)?\s*/g, '')
                .replace(/&&\s*node\s+dist\/bundle(?:\.js)?\s*/g, '')
                .trim()
                .replace(/\s*&&\s*$/, '');
              if (normalized === 'vite build') {
                // Land --ssr unconditionally: a legacy App.tsx (e.g.
                // module-top-level createBrowserRouter) will crashloop the
                // publish container on SSR bundle import, but the develop
                // agent can diagnose and rewrite App.tsx on demand. Gating
                // --ssr on App.tsx shape here would leave variants we
                // don't auto-rewrite (stripe-skilled apps with
                // CartProvider etc.) on CSR indefinitely with no forcing
                // function. Preferring loud, fixable failure over silent
                // stagnation.
                pkg.scripts.build = 'vite build && vite build --ssr src/server/entry.ts';
                changed = true;
                console.log('  Updated scripts.build to include SSR build');
              } else {
                // Customized pipeline: dep cleanup above still ran (safe
                // regardless of build pipeline). Build script + configure.js
                // are preserved. isSsrInstalled() will return false and
                // downstream HTML migrations will correctly skip.
                console.log(`  ⚠️  scripts.build is customized (${build}); leaving as-is`);
              }
            }
          }

          if (changed) {
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          }
          if (pkg.scripts?.build?.includes('--ssr')) {
            buildHasSsr = true;
          }
        } else {
          // Step 1 (entry.ts rewrite) landed, but the migration's primary
          // deliverable — dep cleanup, SSR build-script, configure.js /
          // bundle.js unlink — can't run without package.json. Return
          // 'skipped' so the emitted event reflects that the core work
          // didn't complete, rather than 'applied' which reads as success.
          console.log('  ⚠️  package.json not found; skipping dep-cleanup and build-script steps');
          return 'skipped';
        }
      }

      // 3. Delete obsolete legacy build artefacts. Only safe once the build
      // script actually produces an SSR bundle - deleting them while
      // scripts.build is still a legacy pipeline that references them would
      // leave the app with a broken build, not just unused files.
      //   - configure.js: replaced by entry.ts (uses import.meta.url for paths)
      //   - bundle.js: legacy post-build esbuild step, superseded by vite
      //     build --ssr. Build-script normalisation above already strips
      //     `&& node bundle.js` from scripts.build.
      if (entryHasMarkers && buildHasSsr) {
        const configurePath = join(customerDir, 'src/server/configure.js');
        if (existsSync(configurePath)) {
          unlinkSync(configurePath);
          console.log('  Deleted src/server/configure.js');
        }
        const bundlePath = join(customerDir, 'bundle.js');
        if (existsSync(bundlePath)) {
          unlinkSync(bundlePath);
          console.log('  Deleted bundle.js');
        }
      }

      return 'applied';
    }
  },
  {
    id: 'inject-ssr-markers',
    description: 'Inject <!--app-head--> and <!--app-html--> into customer-modified index.html',
    run(customerDir, syncedFiles) {
      if (syncedFiles.has('index.html')) return 'skipped';
      const htmlPath = join(customerDir, 'index.html');
      if (!existsSync(htmlPath)) return 'skipped';

      // Don't inject markers when SSR isn't fully installed — otherwise an
      // app whose ssrMigration sync group was blocked (e.g. customer-modified
      // vite.config.ts) or whose migrate-to-ssr-entry took the customized-
      // build branch ends up with dead marker comments that no server ever
      // replaces, and later agent edits of index.html get confused by them.
      if (!isSsrInstalled(customerDir)) {
        console.log('  ⏭️  SSR not installed; skipping marker injection');
        return 'skipped';
      }

      const original = readFileSync(htmlPath, 'utf8');
      const hasHead = original.includes('<!--app-head-->');
      const hasHtml = original.includes('<!--app-html-->');
      if (hasHead && hasHtml) {
        return 'applied';
      }

      const appDivRe = /<div id="app"([^>]*)><\/div>/;
      if (!hasHtml && !appDivRe.test(original)) {
        console.log('  ⚠️  Could not locate empty <div id="app"></div>; skipping both markers (ambiguous)');
        return 'skipped';
      }

      let updated = original;
      if (!hasHead) {
        const headCloseIdx = updated.indexOf('</head>');
        if (headCloseIdx < 0) {
          console.log('  ⚠️  No </head> found; skipping injection (ambiguous)');
          return 'skipped';
        }
        updated = updated.slice(0, headCloseIdx) + '<!--app-head-->' + updated.slice(headCloseIdx);
      }
      if (!hasHtml) {
        updated = updated.replace(appDivRe, '<div id="app"$1><!--app-html--></div>');
      }

      if (updated !== original) {
        writeFileSync(htmlPath, updated, 'utf8');
        console.log('  Injected SSR markers into index.html');
      }

      return 'applied';
    }
  },
  {
    id: 'strip-stale-index-title',
    description: 'Strip bare <title> from customer index.html once SSR + Helmet own head metadata',
    run(customerDir, _syncedFiles) {
      const htmlPath = join(customerDir, 'index.html');
      if (!existsSync(htmlPath)) return 'skipped';

      // Gate on SSR being fully installed. Without SSR wired end-to-end,
      // Helmet isn't driving the head and stripping the static <title>
      // would leave the page titleless.
      if (!isSsrInstalled(customerDir)) return 'skipped';

      const original = readFileSync(htmlPath, 'utf8');
      if (!original.includes('<!--app-head-->')) return 'skipped';

      const titleRe = /[ \t]*<title(?:\s[^>]*)?>[\s\S]*?<\/title>\r?\n?/i;
      if (!titleRe.test(original)) return 'skipped';

      const updated = original.replace(titleRe, '');
      if (updated !== original) {
        writeFileSync(htmlPath, updated, 'utf8');
        console.log('  Stripped stale <title> from index.html (Helmet owns <head>)');
      }

      return 'applied';
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

export function runMigrations(customerDir, syncedFiles) {
  console.log('');
  console.log('=== Running Migrations ===');

  for (const migration of MIGRATIONS) {
    console.log(`Migration: ${migration.id} — ${migration.description}`);
    const start = Date.now();
    let status;
    try {
      status = migration.run(customerDir, syncedFiles) === 'skipped' ? 'skipped' : 'applied';
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Failure event goes to stderr so Loki / Docker log drivers that split
      // streams at transport level route it to the error stream alongside the
      // raw stack emitted by the outer catch. stdout would drop it onto the
      // success channel where dashboards keyed on migrationId/durationMs
      // wouldn't surface it.
      console.error(JSON.stringify({
        event: `migration.${migration.id}.failed`,
        migrationId: migration.id,
        durationMs: Date.now() - start,
        error: errorMsg,
      }));
      throw error;
    }
    console.log(JSON.stringify({
      event: `migration.${migration.id}.${status}`,
      migrationId: migration.id,
      durationMs: Date.now() - start,
    }));
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

// Main - only run when executed directly (not when imported by tests)
const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntrypoint) {
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
    // Pass the Error object so Node formats the full stack, not just the
    // message - the migration.<id>.failed event already captures the
    // message; the stack is what points ops at the failing line.
    console.error('Error in sync-template-files:', error);
    process.exit(1);
  }
}
