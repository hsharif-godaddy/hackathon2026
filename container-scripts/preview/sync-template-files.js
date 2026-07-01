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
 * Sync groups (e.g. ssrMigration for entry-server.tsx + main.tsx + App.tsx +
 * vite.config.ts) are applied atomically: we only sync a group if every file in the
 * group would be synced. That avoids partial updates (e.g. a new entry-server.tsx
 * paired with a stale vite.config.ts that doesn't know how to build it).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as babelParse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

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
 *   (e.g. the ssrMigration group: entry-server.tsx + main.tsx + App.tsx + vite.config.ts sync all-or-nothing).
 *
 * To add a new hash:
 * 1. Find the commit with the old version: git log --oneline -- <file>
 * 2. Get the hash: git show <commit>:<file> | md5
 * 3. Add it to the known_hashes array
 */
const SYNC_MANIFEST = [
  // Listed before entry.ts so this file lands in the customer app before
  // entry.ts is upgraded to a version that imports it. With force:false and
  // empty known_hashes the file is created on first sync but never overwritten
  // if a customer has authored their own version.
  {
    file: 'src/server/seo-host.ts',
    description: 'System-host classifier used by entry.ts SEO gate',
    known_hashes: [],
    force: false,
  },
  {
    file: 'src/server/seo-host.test.ts',
    description: 'Unit tests for the Airo system-host classifier',
    known_hashes: [],
    force: false,
  },
  // Listed before entry.ts so this file exists in the customer app before entry.ts
  // imports it. With force:false and empty known_hashes the file is created on first
  // sync but never overwritten if a customer has customised it.
  {
    file: 'src/server/indexnow-key.ts',
    description: 'Runtime loader for the per-site IndexNow ownership key file',
    known_hashes: [],
    force: false,
  },
  // Intentionally NOT in syncGroup: 'ssrMigration'. Unlike index.html (which agents edit
  // interactively), entry.ts is rewritten by the migrate-to-ssr-entry migration with
  // per-app API route imports — producing a unique hash per app. Including it in the group
  // would permanently block the group for any app that has received that migration,
  // creating a circular dependency: the group can't create entry-server.tsx, and without
  // entry-server.tsx the migration can't run to regenerate entry.ts.
  {
    file: 'src/server/entry.ts',
    description: 'Express server entry (replaces configure.js + vite-plugin-api-routes)',
    known_hashes: [
      '97f7b2dca47358d1cdf6838aa346a13c', // before async render + redirect forwarding (data-router SSR)
      '102ddeac9f0c0017adf7405e1dbf3c92', // before non-redirect loader Response (error-response branch)
      '3d66a88d88b8ec09bf5098b474c7a56c', // before empty status-200 Response fallback handling
      'f0d49c600a0fc04550f9afe25f5f2f67', // before sanitized API error responses
      '2791732d0b10bf8716d0cc70f3734497', // before AdSense runtime routes/head injection and per-host SEO gate
      '5487ff6fad6ab48607c498daa80cbc01', // before merging AdSense runtime injection with per-host SEO gate
      '12a5f4baadf6ce4963913fe37384e51e', // SEO: add must-revalidate to cache directives
      '678c3a987122a8266df30b6c970f862b', // before /llms.txt route (RUBICON-365)
      'be66082ac860f2e80a2c2282f78fc9c7', // RUBICON-365 branch tip (llms.txt, pre-AdSense) before main merge
      'd91be310d9ced4697eea5b146201806e', // before IndexNow /<key>.txt route
      'a2f362505ef881c1b1ec94fdecb4fe72', // before removing isSystemHost guard from /<key>.txt
      '711a79257db581a06b4085b7f80b3fc4', // RUBICON-363+main merge tip (IndexNow + llms.txt combined)
    ],
    force: false,
  },
  {
    file: 'src/server/adsense-manifest.ts',
    description: 'Published runtime helper for AdSense manifest loading, head injection, and ads.txt responses',
    known_hashes: [
      'd7223cb2d3049d061b5a9419a9cba142', // before global AdSense enable flag
      '6298f7b890950d4e4faf0af605346b40', // before requiring explicit AdSense enable flag
      'fd4b7758bb07eb45fa8536b321bc772e', // before runtime manifest path hardening
    ],
    force: false,
  },
  {
    file: 'src/server/adsense-manifest.test.ts',
    description: 'Tests for AdSense runtime manifest loading and validation',
    known_hashes: [
      'fe7d0d324542bb092365499624cf0580', // before global AdSense enable flag
      'ee2ceb09388fb9c33c700553de77099c', // before requiring explicit AdSense enable flag
      '0b4a9145309c838b16018ec55a02ec84', // before runtime manifest path hardening
    ],
    force: false,
  },
  {
    file: 'src/server/entry.test.ts',
    description: 'Tests for server entry AdSense text routes and SSR head injection',
    known_hashes: [],
    force: false,
  },
  {
    file: 'src/entry-server.tsx',
    description: 'SSR render entry point used by entry.ts in prod',
    known_hashes: [
      'e087bd8703e07221ae2902e246e8f862', // renderToString(<App url />) via BrowserRouter/StaticRouter split; before data-router refactor
      // Historical backfill (generated from git log of app-templates/v8/src/entry-server.tsx):
      'e2c0d878f6f9f4e2e5179c7ed87ae913', // af04b837b - SSR-derived canonical/og:url origin
      'e03a7b4c1c0054b0e69a2ad60016a6d8'  // 42c8f2c16 - SSR + SEO foundation initial shape
    ],
    force: false,
    syncGroup: 'ssrMigration'
  },
  {
    file: 'src/lib/seo-routes.ts',
    description: 'Auto-synced registry of public routes for sitemap.xml',
    known_hashes: [
      'eacbf6e9cf660572afa5514c83eb6960'  // before doc-comment fix (auto-synced, not hand-edited)
    ],
    force: false
  },
  {
    file: 'src/lib/site-meta.ts',
    description: 'Agent-editable business identity (name + summary) for /llms.txt',
    known_hashes: [],
    force: false
  },
  {
    file: 'src/server/llms-txt.ts',
    description: 'Pure renderer + handler for /llms.txt',
    known_hashes: [
      '40cfb22391daefe1b51dd9cc8fe2bb57', // RUBICON-365 T3 - add host-gated llmsTxtHandler
    ],
    force: false,
  },
  {
    file: 'src/server/llms-txt.test.ts',
    description: 'Unit tests for the /llms.txt renderer and handler',
    known_hashes: [
      'df34d9d248d6e4974bb8986d60c43782', // RUBICON-365 T3 - add handler tests
      '8f7e8fb0083a5af0a10277b632aab0a5', // RUBICON-365 T3 - move imports to top of file
    ],
    force: false,
  },
  {
    file: 'src/lib/analytics-consent.ts',
    description: 'Shared cookie consent utility for analytics tracking skills',
    known_hashes: [],
    force: false,
  },
  {
    file: 'src/lib/__tests__/analytics-consent.test.ts',
    description: 'Runtime coverage for analytics consent helpers',
    known_hashes: [],
    force: false,
  },
  {
    file: 'src/main.tsx',
    description: 'Client entry; hydrateRoot when SSR markup present, createRoot otherwise',
    known_hashes: [
      '13101631d2bee2ae872743b93f8cb7a3', // createRoot only, before hydrateRoot branch
      'dc37acfb8a11bc79e0159310eaede77d', // before data-router refactor (pre-2026-05-01)
      // Historical backfill (generated from git log of app-templates/v8/src/main.tsx):
      'cd27c646bde48f518e3a9911fa045a10', // 42c8f2c16 - SSR + SEO foundation shape
      'e1607af67d71eba3273e7fec193ba5a3', // AIROBUILD-1591 - dominant live-prod shape before ensure-helmet-provider migration
      'e790c445cade0cb4ba4c3aa4715b04b2', // d16667fa5 - before hydrateRoot branch / react-helmet introduction
      '52eb36f89189ccba172bc8abb8819434', // 0bd48df3b - ENV mode fix
      'a5ddaa13c9e6cfc91bf3e433953d301e', // 072cb6366 - post-revert of SCC c2 tracking
      'bb299fecd14512abe14dc2d69869ede8', // a4caff8d2 - SCC c2 event/route tracking (later reverted)
      '3cf05669f4c56c9ee509f744153edb13', // ef7b09510 - disallow web crawler traffic
      'e88e1cfddeaa4d4c0f04434ebbc12600'  // 8fe3b5cb7 - initial v8 template shape
    ],
    force: false,
    syncGroup: 'ssrMigration'
  },
  // App.tsx lives in the ssrMigration group so it lands atomically with
  // entry-server.tsx / main.tsx. entry-server.tsx no longer imports App
  // (stale App is not a crashloop anymore), but a mismatched App.tsx
  // (legacy BrowserRouter vs new data-router) would hydrate markup that does
  // not match the static render.
  {
    file: 'src/App.tsx',
    description: 'Client App - data-router RouterProvider with layout wrapper',
    known_hashes: [
      '307d295de691b65ea9217a74ca9d02d6', // 0bd48df3b - before CookieBanner
      '966395da41e36083d6bd9e08811ef3ea', // intermediate - inline CookieBannerErrorBoundary (before extraction)
      '9be50c9e3b4a1eeb6d385adc80f6dfa7', // pre-SSR createBrowserRouter version
      '1b5f3b0e5efcbde4ffeacb6069d8c539', // BrowserRouter/StaticRouter split; before data-router refactor (pre-2026-05-01)
      '3a10be7c15f2a3882ae12369af51c6e8', // data-router with dev boundary outside RouterProvider; before route-element boundary fix
      // Historical backfill (generated from git log of app-templates/v8/src/App.tsx):
      '6b96bf98a90ddadb919ba7ff47d5edb7', // 0169f28ed - route errors in dev boundary
      '97e2f3f17cb67d8162c91181737eaa21', // d16667fa5 - react-helmet head injection
      '44196e307bffd4c9555236f44610d489', // 8c484796c - simplified Header/Footer
      'bc9bcb3246e03b768f86a09c8930eea1', // 072cb6366 - post-revert of SCC c2 tracking
      'ee2cdac13d29fc19367ce681df57f564', // a4caff8d2 - SCC c2 tracking (later reverted)
      '5b08b7a13bd660060b4f882a68b20a18', // 153b8e50c - dynamic context develop agent
      '18b5302d1caefc27173db4da09ebf7b1', // 97812429c - page loading experience improvements
      'b2c73564f9d379ab0e81cb94cc667cfc', // a90e444f5 - hot reload fix
      '4dd3e794803357412bbbfa22a8d0fb5f', // e9edf480d - error capture improvements
      'e0f0d7a0f9ae9457a3c3674f250a85f9'  // 8fe3b5cb7 - initial v8 template shape
    ],
    force: false,
    syncGroup: 'ssrMigration'
  },
  {
    file: 'src/components/CookieBanner.tsx',
    description: 'cookie consent banner for C2 analytics',
    known_hashes: [
      '1785601300e3d9d95e5da2c53aa155a3', // c054fea9 - Implement CookieBanner component for analytics
      'c23c35c1239baf9990b60ac54c7c4b97', // d4d5fb79 - i18n round
      '4bdc954c07b1310fbe273850f54e6abb', // pre-consent-event dispatch
      'bdf3ad168393a08d96f177bc28d77163', // AIROBUILD-2057 - before data-airo-non-editable opt-out
      '0b543cad5a0ef93bfcf87e1e2bede6e6', // #4699 - hide-in-preview DEV guard (reverted)
      '24c734353145cdb86e173e7186323847'  // RUBICON-418 - before "Learn more" link removal
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
      '0d65cc5e501da40c7dc28ed173027125', // #3311 (AIROBUILD-1478) - <ScrollRestoration />; template comment refreshed in SSR branch
      '172c2f9a5200e19829052f765705cfb4'  // before default <Helmet> site title/description added to RootLayout
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
    file: 'public/airo-video-slots.js',
    description: 'Runtime script for published apps — replaces img slots with video elements when mediaType is video',
    known_hashes: [
      '9a930fd9c986fe6910aae1c11777b910',  // initial version
      '4df75c79e9f3d41e4a6e4fc91b75ba21',  // orphan-cleanup fix
      '133e1dbc34d51514c0dbd56a9ee21924',  // remove Vite bailout — run in both dev and prod
      'c76ce339273fe8313654245af3452f0a',  // fix polling leak, observer re-entrancy, dev-mode detection
      '29eabf3c435ab5dabff0bac38c0e3abc',  // PR review feedback fixes
      '6ef38ed9111284e38e23a94a84ff5338'   // broaden bg-image scan to cover CSS-class backgrounds
    ],
    force: false
  },
  {
    file: 'public/airo-logo-orientation.js',
    description: 'Runtime script — bumps logo height and strips brightness/invert filters when an upload\'s naturalOrientation does not match its slot',
    known_hashes: [
      'a11eb188d1835d9466290b22e4dc542e' // initial version — gated filter strip on URL having `variant=`, missed bare-URL footer/header blobs
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
      '0b3e1d30a5b646e0fabfa7e657a582c9', // before <!--app-head--> / <!--app-html--> SSR markers
      'f2faa351e9111fb14ed707d0d55e7ce7', // before static main entry restored for CSS hoisting
      '9170b78302b5d16948b51b7acdae6d72', // before airoShareToken-strip script + same-origin referrer-policy
      '17827fb25e25787b2f7bd0fd7d5e0e37', // before airo-video-slots.js script tag + share-token rationale comments removed
      'ba06ea07c92a093f90d70b2b52199652', // before airo-video-slots.js script tag (corrects mis-hashed entry above)
      'f2329d6a7b9a53f769a160487908c3bd'  // before airo-logo-orientation.js script tag
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
  // content-plugin + content-lib are framework infra (the virtual:content
  // provider and the runtime per-item-index wrapper). vite.config.ts imports
  // content-plugin, so a migrated customer app that gets the new vite.config
  // WITHOUT these files fails to build ("Could not resolve ./content-plugin/
  // src/index"). force:true — customers never edit these (same class as the
  // rsync-managed source-mapper/ and dev-tools/), so always replace; this also
  // lets fixes propagate to existing apps. Listed before vite.config.ts so they
  // land in the same sync pass that upgrades the config that imports them.
  {
    file: 'content-plugin/src/index.ts',
    description: 'Vite content plugin (virtual:content) — imported by vite.config.ts',
    known_hashes: [],
    force: true,
  },
  {
    file: 'content-plugin/src/parse.ts',
    description: 'content-plugin JSON parse helper',
    known_hashes: [],
    force: true,
  },
  {
    file: 'content-plugin/src/frontmatter.ts',
    description: 'content-plugin lightweight YAML frontmatter parser — no deps',
    known_hashes: [],
    force: true,
  },
  {
    file: 'content-lib/src/index.ts',
    description: 'content-lib barrel (ContentListContext) — content-layer runtime',
    known_hashes: [],
    force: true,
  },
  {
    file: 'content-lib/src/ContentListContext.tsx',
    description: 'Runtime per-item content-list index wrapper',
    known_hashes: [],
    force: true,
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
      '641596ecb45dc0cfdcb2d49159b33cf6', // before vite-plugin-api-routes removal and SSR build split
      // Historical backfill (generated from git log of app-templates/v8/vite.config.ts):
      'bb713c7973458231b47f8d6571b72bb0', // b9423f06b - revert CMS merge
      'b607521e17428fce0621bc926ff4162c', // 4ee542a92 - merge main into cms branch
      '2ea569b4c4ed16b9a5c1a998d4cf8a2d', // 99146c890 - CMS runtime library extraction
      'deb80aae7a748a8e3545daf174c5ff23', // e211992d1 - Vite content plugin for virtual:content
      'd47d2a7bb02651ee9895e9113b00b113', // 00ba3e685 - align with publish container conventions
      'd29d67864e000b00ee7117c359f5c135', // f8055563d - replace plugin+esbuild with Vite SSR build
      'b0aa0170d511b28e04049bbd2a4dafb4', // cf95889e4 - vite-plugin-api-routes inline plugin (variant A)
      '106434a6c3a8cb997a189d6f749ced80', // ff895d2ba - vite-plugin-api-routes inline plugin (variant B)
      '0e72c976f8d7ff1c91a59685a79450be', // d5c7d7ceb - nginx proxy for HTTPS termination
      '657efb29d5179d1210f3470ca8d72658', // b1a065812 - database agent codegen fixes
      '098101c26887115b2b8ed10311aec615', // a76ff0029 - basic database support
      '79d0fd4d3f4814d9c8f77dc32c49de38', // 0f3a3f653 - SSL cert automation
      '7d437667b434e8f94def659a50c479d2', // 4330460b0 - rollup all dependencies
      '72ad6aa914d3ca713bd0eafa9364b059', // 6ef0b956b - iframes previews over https
      '79600ba2395dc842f4786b8c544c8bc4', // 8c779b557 - app publish support
      'e3ee8d4b9b8826a77a3b7b3497df9b62', // 6fa206363 - API and email documentation
      '8c8784207e444fb13ddc8bb29604f1e3', // a90e444f5 - hot reload fix
      'a92fb857f649d67bc653ed43e664c8c7', // e9edf480d - error capture improvements
      '5342406b7dc9edf5d85a44e1d7d26a53', // e263f5993 - auth + app creation refactor
      '4bbe3b0ae32dd551134b468179545c73', // 0224f9e79 - prevent vite dev server port auto-select
      '253224a7efa87609c386e1509cca4c88', // b6223cc3b - fullstory unmask elements
      '3d56a8c11d01f1ab838efc5ca22b0fab', // d4d0b652a - switch nomad job to v8 template
      '29998491ae42daa36a849f98768adcf7', // 7f6cf57d0 - prod mode refactor
      'e2afec2400ba08ac1e3e1578ab6cb057', // 8b205e08b - hooks and stores introduction
      '4999ddbeb0b0fa89df23daf9cd01eacb', // 451020eac - initial v8 template vite.config.ts shape
      '0b084d614be1adbd00b598bf21dc62a8', // AIROBUILD-1971 - before explicit node:url URL import
      '6bba47a7ed3c240b76ec90cc589a47f4', // AIROBUILD-1971 - before motion/react optimizeDeps include
      'bb713c7973458231b47f8d6571b72bb0', // d3b2c3339 - before motion/react optimizeDeps fix
      'c01551a9385c3e0891f2cc2cc3479c69', // 7500c74c7 - motion/react added to dedupe+optimizeDeps (dedupe removed as ineffective)
      '6861d7c711f511108a57129d637bcc33', // 86f24d0f6 (AIROBUILD-1971) - before format override template runtime
      '2880be775a2ab33ded88ffdd944a1b19', // preview-load fix - before server.warmup added
      'a229eb3610393644d6d07000792f96bb', // preview-load fix - warmup comment revision (within-branch)
      '91878f06aa011a0e51db432778c254c9', // feat/cms-ile-data-bound-slice1 - before contentPlugin() registration
      'e248516684acc3749b0b08df0a6ea16c', // RUBICON-516 - indentation noise (revert)
    ],
    force: false,
    syncGroup: 'ssrMigration'
  },
  {
    file: 'format-overrides-plugin.ts',
    description: 'Vite virtual module plugin for format override sidecars',
    known_hashes: [
      'f6d9e6a1425628bba1a2c6d2a99ec9c9', // AIROBUILD-1971 - before production sidecar warnings
      'f312fbeda3c4be4cad4d8cd6f07a9604', // AIROBUILD-1971 - before live HMR sidecar updates
      '2a8bedad0f2423a8b65e928cfcf2913d'  // AIROBUILD-1971 - before structured sidecar invalid events
    ],
    force: false,
  },
  {
    file: 'src/vite-env.d.ts',
    description: 'Vite type declarations for platform virtual modules',
    known_hashes: [
      '7067a198d32f878907c1c1476ef8c4f2'  // before virtual:format-overrides declaration
    ],
    force: false,
    syncGroup: 'formatOverrides'
  },
  {
    file: 'src/lib/format-overrides.ts',
    description: 'Runtime helpers for format override sidecars',
    known_hashes: [
      'b467b38e7ee355129ffdda65e4bfc224'  // AIROBUILD-1971 - before malformed entry warnings
    ],
    force: false,
    syncGroup: 'formatOverrides'
  },
  {
    file: 'src/lib/format-overrides-store.ts',
    description: 'Runtime store for live format override sidecar updates',
    known_hashes: [
      '1775188ecb837fa4f642610b4a177d52'  // AIROBUILD-1971 - before void unsubscribe cleanup
    ],
    force: false,
    syncGroup: 'formatOverrides'
  },
  {
    file: 'src/components/FormattedBoundText.tsx',
    description: 'Runtime component that applies format override sidecars to bound text',
    known_hashes: [
      '3dd3cd453d8c1e0354b864a857f3bd93', // AIROBUILD-1971 - before live sidecar store subscription
      'fb7ef5c531e762b5a5446ef930453c0f'  // AIROBUILD-1971 - before alias import restoration
    ],
    force: false,
    syncGroup: 'formatOverrides'
  },
  {
    file: 'vitest.config.ts',
    description: 'Vitest configuration for v8 template tests',
    known_hashes: [
      'd832224628a9e29c7b6bfe7c03179799'  // before virtual:format-overrides test alias
    ],
    force: false
  },
  {
    file: 'src/test/format-overrides-module.ts',
    description: 'Vitest fixture for the format override virtual module',
    known_hashes: [],
    force: false
  },
  {
    file: 'src/components/__tests__/FormattedBoundText.test.tsx',
    description: 'Runtime coverage for bound text format overrides',
    known_hashes: [
      '028e8f56834d0efac20bbcf10cf54ad9'  // AIROBUILD-1971 - before live sidecar store coverage
    ],
    force: false
  },
  {
    file: 'src/lib/__tests__/format-overrides.test.ts',
    description: 'Runtime coverage for format override sidecar helpers',
    known_hashes: [
      '7ac6044f02d4d17120c9c835a2b65d5d'  // AIROBUILD-1971 - before malformed and guard table coverage
    ],
    force: false
  },
  {
    file: 'src/lib/__tests__/format-overrides-plugin.test.ts',
    description: 'Runtime coverage for the format override sidecar Vite plugin',
    known_hashes: [
      '47e805d8c84be1b9f3a8acb547c23f2b', // AIROBUILD-1971 - before production warning coverage
      '40caf12163b55d0bd9fb9a1d86a44135', // AIROBUILD-1971 - before live sidecar HMR coverage
      '44dc9087a0d69e0abff0bbf3518c9146'  // AIROBUILD-1971 - before structured invalid sidecar coverage
    ],
    force: false
  },
  {
    file: 'src/lib/__tests__/format-overrides-store.test.ts',
    description: 'Runtime coverage for the live format override sidecar store',
    known_hashes: [],
    force: false
  },
  {
    file: 'src/components/ui/sonner.tsx',
    description: 'Sonner toaster component',
    known_hashes: [
      '22e6ae1898a423aff378e0664323a9ae'  // Original shadcn template with next-themes
    ],
    force: false
  },
  {
    file: 'package.json',
    description: 'Template dependency manifest — synced to push security patches to customer apps',
    known_hashes: [
      '9c795a81d30c266ae7c54b58df716ba5', // before vitest 4.x + tsx/esbuild/babel security upgrades
      'e35c659efb87610eee8eafde2bb49963', // pre-main v8 package.json (merged via PR #5197 + domains-page-spacing-fix)
    ],
    force: false
  },
  {
    file: 'package-lock.json',
    description: 'Lockfile for template dependencies — synced alongside package.json for security patches',
    known_hashes: [
      'af484ed6d3e61e6f1292a3417163f57a', // before vitest 4.x + tsx/esbuild/babel security upgrades
      '779ae8d66e49a0ff908bd31689c8be67', // pre-main v8 package-lock.json (merged via PR #5197 + domains-page-spacing-fix)
      'abb2e6d76e9d7665f6244f3ffb51df05', // before undici 7.28.0 security upgrade (GHSA-vmh5-mc38-953g)
    ],
    force: false
  },
  {
    file: '.gitignore',
    description: 'Ignore turnscript platform execution scripts (.airo/turnscript-*) so they are never committed to customer app repos',
    known_hashes: [
      '94d013b24a8cc29588ffdf1dc0687458', // before .airo/turnscript-* ignore (turnscript release)
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

const VITE_CONFIG_CANDIDATES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'];

/**
 * Returns true if any vite.config.* file references `vite-plugin-api-routes`.
 * Uses a plain string search rather than a regex — the previous regex missed
 * agent-generated variants like `import("vite-plugin-api-routes" as string)`.
 * False positives (package name in a comment) only over-preserve the dep,
 * which is harmless. False negatives cause crash loops.
 */
function isVitePluginApiRoutesReferenced(customerDir) {
  for (const name of VITE_CONFIG_CANDIDATES) {
    const p = join(customerDir, name);
    if (!existsSync(p)) continue;
    try {
      const content = readFileSync(p, 'utf8');
      if (content.includes('vite-plugin-api-routes')) return true;
    } catch (err) {
      console.error(JSON.stringify({
        event: 'vite-config.read-error',
        file: name,
        code: err && err.code ? err.code : undefined,
        error: err instanceof Error ? err.message : String(err),
      }));
      return true;
    }
  }
  return false;
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
        customerDir,
        code: err && err.code ? err.code : undefined,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    return false;
  }

  return true;
}

const STATIC_MAIN_ENTRY = '<script type="module" src="/src/main.tsx"></script>';
const GLOBALS_CSS_LINK = '<link rel="stylesheet" href="/src/styles/globals.css" />';
const GLOBALS_CSS_LINK_RE =
  /<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["']\/src\/styles\/globals\.css["'])[^>]*>/i;
const MODULE_SCRIPT_RE = /<script\b(?=[^>]*\btype=["']module["'])[^>]*>/i;
const KNOWN_DEV_RETRY_BODY = `
if (import.meta.env.MODE === 'development') {
  await import('/dev-tools/src/error-client.ts')
}
let mainLoaded = false
import('/src/main.tsx').then(() => { mainLoaded = true }).catch(err => {
  // Vite dep optimization can cause transient import failures that resolve
  // in 1-3s. Retry once before reporting the error to avoid false positives.
  setTimeout(() => {
    if (mainLoaded) return
    import('/src/main.tsx').then(() => { mainLoaded = true }).catch(retryErr => {
      window.dispatchEvent(new CustomEvent('vite:initial-error', { detail: retryErr }));
    });
  }, 2000);
})
`;

function normalizeInlineScriptBody(body) {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function replaceKnownDevRetryEntry(html) {
  const scriptRe = /([ \t]*)<script\b(?=[^>]*\btype=["']module["'])[^>]*>([\s\S]*?)<\/script>/gi;
  const knownRetryBody = normalizeInlineScriptBody(KNOWN_DEV_RETRY_BODY);
  let match;
  while ((match = scriptRe.exec(html)) !== null) {
    const [script, indent, body] = match;
    if (normalizeInlineScriptBody(body) !== knownRetryBody) continue;

    const replacement = `${indent}${STATIC_MAIN_ENTRY}`;
    return {
      html: html.slice(0, match.index) + replacement + html.slice(match.index + script.length),
      replaced: true,
    };
  }

  return { html, replaced: false };
}

function injectGlobalsCssLink(html) {
  if (GLOBALS_CSS_LINK_RE.test(html)) {
    return { html, injected: false };
  }

  const marker = '<!--app-head-->';
  if (html.includes(marker)) {
    return {
      html: html.replace(marker, `${GLOBALS_CSS_LINK}\n    ${marker}`),
      injected: true,
    };
  }

  const headCloseRe = /([ \t]*)<\/head>/i;
  const match = headCloseRe.exec(html);
  if (!match) {
    return { html, injected: false };
  }

  const indent = match[1] || '';
  return {
    html: html.replace(headCloseRe, `${indent}${GLOBALS_CSS_LINK}\n$&`),
    injected: true,
  };
}

const HELMET_PKG = '@dr.pogodin/react-helmet';
const STUB_TARGETS = new Set(['./app-entry', './app-entry.tsx', './app-entry.ts', './app-entry.jsx', './app-entry.js']);

/**
 * If src is a stub wrapper (only imports, one of which targets a known app-entry
 * sibling), return the resolved path to that sibling. Otherwise null. Stubs
 * exist on apps where an agent moved the render logic out of main.tsx so
 * platform-plugin injections wouldn't cascade HMR through the whole module
 * graph; in that case we need to transform app-entry.tsx, not main.tsx.
 */
function resolveEntryStub(src, currentFileDir) {
  let ast;
  try {
    ast = babelParse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch (_err) {
    return null;
  }
  let stubTarget = null;
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      if (STUB_TARGETS.has(node.source.value)) stubTarget = node.source.value;
    } else if (node.type !== 'EmptyStatement') {
      return null;
    }
  }
  if (!stubTarget) return null;
  // Try each known sibling extension — the import may omit the extension.
  const baseName = stubTarget.replace(/^\.\//, '').replace(/\.(tsx|ts|jsx|js)$/, '');
  for (const ext of ['tsx', 'ts', 'jsx', 'js']) {
    const candidate = join(currentFileDir, `${baseName}.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function isJsxRoot(node) {
  return t.isJSXElement(node) || t.isJSXFragment(node);
}

function renderArgIndex(callee) {
  if (t.isIdentifier(callee) && callee.name === 'hydrateRoot') return 1;
  if (t.isMemberExpression(callee) && t.isIdentifier(callee.property)) {
    if (callee.property.name === 'render') return 0;
    if (callee.property.name === 'hydrateRoot') return 1;
  }
  return -1;
}

/**
 * Wrap the render tree in <HelmetProvider> and ensure the import exists.
 * Returns transformed source on success, or { reason } on skip:
 *   - helmet_already_wraps_tree  : <HelmetProvider> already in JSX (converged, no write)
 *   - render_tree_not_found      : couldn't locate createRoot/hydrateRoot call site
 *   - parse_failed               : AST parse failed (customer syntax error)
 */
function applyHelmetProviderTransform(source) {
  let ast;
  try {
    ast = babelParse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { reason: 'parse_failed', error: message };
  }

  // Anchor detection to HELMET_PKG specifically. A wrap via react-helmet-async
  // or another Helmet package wouldn't satisfy @dr.pogodin/react-helmet's
  // <Helmet> (separate provider heaps) — we must still wrap with our provider.
  let helmetProviderLocalName = null;
  let helmetPkgImportDecl = null;
  let helmetPkgHasNamespaceImport = false;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value !== HELMET_PKG) continue;
    helmetPkgImportDecl = node;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportSpecifier' && spec.imported.name === 'HelmetProvider') {
        helmetProviderLocalName = spec.local.name;
      } else if (spec.type === 'ImportNamespaceSpecifier') {
        helmetPkgHasNamespaceImport = true;
      }
    }
  }

  const providerTagName = helmetProviderLocalName ?? 'HelmetProvider';
  const wrapJsxInProvider = (jsxNode) => t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier(providerTagName), [], false),
    t.jsxClosingElement(t.jsxIdentifier(providerTagName)),
    [jsxNode],
    false,
  );

  // Detection must complete before the wrap pass: otherwise (a) an existing
  // <HelmetProvider> wrap would be re-wrapped by the CallExpression visitor
  // before the JSX visitor fires, and (b) a freshly-inserted wrap would
  // satisfy the JSX visitor and falsely flag the file as already-wrapped.
  if (helmetProviderLocalName) {
    let alreadyWrapped = false;
    traverse(ast, {
      JSXOpeningElement(path) {
        if (path.node.name.type === 'JSXIdentifier' &&
            path.node.name.name === helmetProviderLocalName) {
          alreadyWrapped = true;
          path.stop();
        }
      },
    });
    if (alreadyWrapped) return { reason: 'helmet_already_wraps_tree' };
  }

  // Tracks declarators we've already wrapped. A single `const tree = <App/>`
  // shared across hydrateRoot + createRoot branches must not get wrapped twice.
  const wrappedDeclarators = new WeakSet();
  let patched = false;
  const wrapExpression = (exprPath) => {
    const node = exprPath.node;
    if (isJsxRoot(node)) {
      exprPath.replaceWith(wrapJsxInProvider(node));
      patched = true;
      return;
    }
    if (!t.isIdentifier(node)) return;
    const binding = exprPath.scope.getBinding(node.name);
    if (!binding?.path.isVariableDeclarator()) return;
    if (wrappedDeclarators.has(binding.path.node)) {
      patched = true;
      return;
    }
    const init = binding.path.get('init');
    if (!init.node) return;
    if (isJsxRoot(init.node)) {
      init.replaceWith(wrapJsxInProvider(init.node));
      wrappedDeclarators.add(binding.path.node);
      patched = true;
      return;
    }
    if (t.isParenthesizedExpression(init.node) && isJsxRoot(init.node.expression)) {
      init.get('expression').replaceWith(wrapJsxInProvider(init.node.expression));
      wrappedDeclarators.add(binding.path.node);
      patched = true;
    }
  };

  // Visit every render call, not just the first — customer main.tsx can split
  // hydrateRoot/createRoot across inline branches (no shared `const tree`);
  // stopping after the first wrap would leave the other branch unwrapped.
  traverse(ast, {
    CallExpression(path) {
      const argIdx = renderArgIndex(path.node.callee);
      if (argIdx < 0 || path.node.arguments.length <= argIdx) return;
      wrapExpression(path.get(`arguments.${argIdx}`));
    },
  });

  if (!patched) return { reason: 'render_tree_not_found' };

  const hasSpec = !!helmetPkgImportDecl?.specifiers.some(
    (s) => s.type === 'ImportSpecifier' && s.imported.name === 'HelmetProvider',
  );

  if (!hasSpec) {
    const newSpec = t.importSpecifier(t.identifier('HelmetProvider'), t.identifier('HelmetProvider'));
    // A namespace-only import (`import * as H from ...`) can't legally carry
    // named specifiers alongside it, so add a sibling declaration rather than
    // mutating the existing one.
    if (helmetPkgImportDecl && !helmetPkgHasNamespaceImport) {
      helmetPkgImportDecl.specifiers.push(newSpec);
    } else {
      const newImport = t.importDeclaration([newSpec], t.stringLiteral(HELMET_PKG));
      const body = ast.program.body;
      let insertAt = 0;
      for (let i = 0; i < body.length; i++) {
        if (body[i].type === 'ImportDeclaration') insertAt = i + 1;
        else break;
      }
      body.splice(insertAt, 0, newImport);
    }
  }

  const out = generate(ast, { retainLines: false, comments: true }, source);
  return out.code.endsWith('\n') ? out.code : out.code + '\n';
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
 * - { status: 'applied', changed: boolean } — preferred form: `changed`
 *   surfaces to the migration.<id>.applied event so Loki dashboards can
 *   distinguish "wrote bytes" from "already converged." A migration that
 *   returns bare 'applied' omits the field.
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
      if (!existsSync(gitignorePath)) return { status: 'skipped', reason: 'gitignore_missing' };

      const content = readFileSync(gitignorePath, 'utf8');
      // Remove the "# Public Assets" comment and "public/assets" entry independently
      // so we catch cases where the comment was removed but the entry remains.
      // Match whole lines in multiline mode so both LF and CRLF files are handled,
      // and tolerate an optional trailing slash on "public/assets/".
      const updated = content
        .replace(/^# Public Assets\s*$\r?\n?/gm, '')
        .replace(/^public\/assets\/?\s*$\r?\n?/gm, '');
      const changed = updated !== content;
      if (changed) {
        writeFileSync(gitignorePath, updated, 'utf8');
        console.log('  Removed public/assets from .gitignore');
      }

      return { status: 'applied', changed };
    }
  },
  {
    // entry-server.tsx is a member of the ssrMigration sync group, which is all-or-nothing:
    // if any sibling (App.tsx / main.tsx / vite.config.ts) carries an unknown hash, the
    // whole group stays blocked and entry-server.tsx never lands. migrate-to-ssr-entry
    // below guards on its presence, so the two would deadlock on pre-SSR legacy apps.
    // This migration breaks the cycle by seeding the file directly from the base template
    // whenever it's absent — decoupled from hash-group atomicity, same pattern as the
    // force:true CookieBannerErrorBoundary.tsx sync entry. Runs before
    // ensure-helmet-provider so the SSR foundation is in place before AST
    // transforms on main.tsx.
    id: 'seed-entry-server-tsx',
    description: 'Seed src/entry-server.tsx from the base template when absent',
    run(customerDir, _syncedFiles, baseDir) {
      // Disabled unconditionally (not gated on vite-plugin-api-routes presence):
      // force-seeding entry-server.tsx onto apps whose ssrMigration sync group is
      // blocked causes migrate-to-ssr-entry to run on those apps. That migration
      // deletes configure.js while vite-plugin-api-routes is still active, crashing
      // Vite on the next restart. A conditional gate on isVitePluginApiRoutesReferenced
      // would be functionally equivalent — if vite-plugin-api-routes is already gone,
      // the ssrMigration group has landed and entry-server.tsx already exists, so the
      // existsSync check below would skip anyway. Unconditional disable is simpler and
      // avoids any risk from edge cases in that detection logic.
      // Revisit once the cohort of apps broken by the configure.js deletion clears up.
      return { status: 'skipped', reason: 'seeding_disabled' };

      const entryServerPath = join(customerDir, 'src/entry-server.tsx');
      if (existsSync(entryServerPath)) {
        return { status: 'skipped', reason: 'entry_server_exists' };
      }
      const templatePath = join(baseDir, 'src/entry-server.tsx');
      // Guard an unstructured crash: if the base template ever renames or drops
      // entry-server.tsx, a raw readFileSync ENOENT would abort the whole sync
      // pass via runMigrations' re-raise. Structured skip keeps startup alive
      // and the reason is greppable in Loki alongside other skip paths.
      if (!existsSync(templatePath)) {
        console.log(`  ⏭️  Template src/entry-server.tsx not found at ${templatePath}`);
        return { status: 'skipped', reason: 'template_entry_server_missing' };
      }
      const content = readFileSync(templatePath, 'utf8');
      mkdirSync(join(customerDir, 'src'), { recursive: true });
      writeFileSync(entryServerPath, content, 'utf8');
      // Include the source path so a misconfigured allocation pointing at the
      // wrong base template dir is distinguishable from the correct case.
      console.log(`  Seeded src/entry-server.tsx from ${templatePath}`);
      console.log(JSON.stringify({
        event: 'sync.file.seeded',
        seededFile: 'src/entry-server.tsx',
        migration: 'seed-entry-server-tsx',
      }));
      // Always changed on the apply path: the migration only runs when the
      // file was absent, so a successful return implies a fresh write.
      return { status: 'applied', changed: true };
    }
  },
  {
    id: 'ensure-helmet-provider',
    description: 'Wrap render tree in <HelmetProvider> so <Helmet> usages in children/layouts do not throw',
    run(customerDir, _syncedFiles) {
      const mainPath = join(customerDir, 'src/main.tsx');
      if (!existsSync(mainPath)) return { status: 'skipped', reason: 'main_tsx_missing' };

      const mainSrc = readFileSync(mainPath, 'utf8');
      const stubTarget = resolveEntryStub(mainSrc, dirname(mainPath));
      const targetPath = stubTarget ?? mainPath;
      const targetSrc = stubTarget ? readFileSync(targetPath, 'utf8') : mainSrc;

      const result = applyHelmetProviderTransform(targetSrc);
      if (typeof result !== 'string') {
        // Converged state (provider already wraps the tree) maps to applied/
        // no-op rather than skipped — matches inject-ssr-markers and keeps
        // the "still mutating trees" dashboard query consistent across
        // migrations.
        if (result.reason === 'helmet_already_wraps_tree') {
          return { status: 'applied', changed: false };
        }
        return {
          status: 'skipped',
          reason: result.reason,
          ...(result.error ? { extra: { parseError: result.error } } : {}),
        };
      }
      writeFileSync(targetPath, result, 'utf8');
      console.log(`  Wrapped render tree in <HelmetProvider> in ${relative(customerDir, targetPath)}`);
      return { status: 'applied', changed: true };
    }
  },
  {
    // Recovery is two-phase: this migration writes the dep to package.json,
    // but npm install already ran earlier in nomad_setup.sh (gated on missing
    // node_modules). The dep lands in node_modules on the next allocation
    // (image release triggers realloc → fresh npm install).
    id: 'restore-vite-plugin-api-routes-dep',
    description: 'Re-add vite-plugin-api-routes to package.json when vite.config still references it (crash-loop recovery)',
    run(customerDir) {
      if (!isVitePluginApiRoutesReferenced(customerDir)) {
        return { status: 'skipped', reason: 'no_vite_plugin_reference' };
      }
      const pkgPath = join(customerDir, 'package.json');
      if (!existsSync(pkgPath)) {
        return { status: 'skipped', reason: 'package_json_missing' };
      }
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      } catch (err) {
        console.error(JSON.stringify({
          event: 'restore-vite-plugin-api-routes-dep.parse-failed',
          error: err instanceof Error ? err.message : String(err),
        }));
        return { status: 'skipped', reason: 'package_json_unparseable' };
      }
      const inDeps = !!(pkg.dependencies && 'vite-plugin-api-routes' in pkg.dependencies);
      const inDevDeps = !!(pkg.devDependencies && 'vite-plugin-api-routes' in pkg.devDependencies);
      if (inDeps || inDevDeps) {
        return { status: 'skipped', reason: 'dep_already_present' };
      }
      if (!pkg.devDependencies) pkg.devDependencies = {};
      pkg.devDependencies['vite-plugin-api-routes'] = '1.2.6';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log('  Restored vite-plugin-api-routes to devDependencies (recovery completes on next allocation)');
      return { status: 'applied', changed: true };
    }
  },
  {
    id: 'migrate-to-ssr-entry',
    description: 'Generate src/server/entry.ts API registrations, drop vite-plugin-api-routes/esbuild, delete configure.js',
    run(customerDir, _syncedFiles) {
      const entryPath = join(customerDir, 'src/server/entry.ts');
      const apiDir = join(customerDir, 'src/server/api');
      const entryServerPath = join(customerDir, 'src/entry-server.tsx');
      const configurePath = join(customerDir, 'src/server/configure.js');
      const vitePluginReferenced = isVitePluginApiRoutesReferenced(customerDir);

      // SSR foundation must exist on disk before we touch any of the other
      // files. entry-server.tsx is the render entry that entry.ts imports at
      // runtime - without it the SSR branch will always throw.
      if (!existsSync(entryServerPath)) {
        console.log('  ⏭️  src/entry-server.tsx not present (SSR foundation not in place)');
        return { status: 'skipped', reason: 'entry_server_missing' };
      }
      if (!existsSync(entryPath) || !existsSync(apiDir)) {
        console.log('  ⏭️  src/server/entry.ts or src/server/api not present');
        return { status: 'skipped', reason: 'server_entry_or_api_missing' };
      }

      if (existsSync(configurePath) && vitePluginReferenced) {
        console.log('  ⚠️  vite-plugin-api-routes still referenced while configure.js is present; skipping SSR migration');
        return {
          status: 'skipped',
          reason: 'legacy_vite_plugin_active',
          extra: { vitePluginApiRoutesPreserved: true },
        };
      }

      let anyChanges = false;

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
          anyChanges = true;
          console.log(`  Regenerated ${entries.length} API registration(s) in src/server/entry.ts`);
        }
        entryHasMarkers = true;
      } else if (bareTemplate) {
        if (entries.length === 0) {
          // Rewriting bare → marked with no routes would drop the health
          // import and leave entry.ts unrunnable.
          console.log('  No API handlers found in src/server/api; leaving bare entry.ts untouched');
          return { status: 'skipped', reason: 'bare_entry_no_api_handlers' };
        }
        const { imports, registrations } = generateEntryApiBlocks(entries);
        const importBlock = `// <api-imports>\n${imports}\n// </api-imports>`;
        const regBlock = `// <api-registrations>\n${registrations}\n// </api-registrations>`;
        const updated = content.replace(bareImportRe, importBlock).replace(bareRegRe, regBlock);
        if (updated !== content) {
          writeFileSync(entryPath, updated, 'utf8');
          anyChanges = true;
          console.log(`  Generated ${entries.length} API registration(s) in src/server/entry.ts`);
        }
        entryHasMarkers = true;
      } else {
        console.log('  entry.ts does not match expected template markers; leaving as-is');
        return { status: 'skipped', reason: 'entry_ts_custom_shape' };
      }

      // 2. package.json cleanup + SSR build script. Runs whenever entry.ts
      // is in marked state, so a partial-crash where step 1 landed but step 2
      // didn't will self-heal on the next restart. Each inspection is
      // idempotent (checking for presence before removal / rewrite).
      let buildHasSsr = false;
      let vitePluginPreserved = false;
      if (entryHasMarkers) {
        const pkgPath = join(customerDir, 'package.json');
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
          let changed = false;

          // Preservation guard: only prune vite-plugin-api-routes when no
          // source still imports it. A customer-modified vite.config.* that we
          // left un-synced (hash miss) may still reference the plugin; deleting
          // the dep would crash vite startup with `Cannot find package
          // 'vite-plugin-api-routes'`. The source reference remains authoritative
          // even if package.json is already missing the dep from an earlier
          // partial migration.
          const depPresent =
            !!(pkg.dependencies && 'vite-plugin-api-routes' in pkg.dependencies) ||
            !!(pkg.devDependencies && 'vite-plugin-api-routes' in pkg.devDependencies);
          if (vitePluginReferenced) {
            vitePluginPreserved = true;
            console.log('  ⚠️  vite-plugin-api-routes still referenced in source; preserving legacy plugin state');
          } else if (depPresent) {
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
          }
          if (!vitePluginReferenced) {
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
          }

          if (changed) {
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
            anyChanges = true;
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
          return { status: 'skipped', reason: 'package_json_missing' };
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
      if (entryHasMarkers && buildHasSsr && !vitePluginPreserved) {
        if (existsSync(configurePath)) {
          unlinkSync(configurePath);
          anyChanges = true;
          console.log('  Deleted src/server/configure.js');
        }
        const bundlePath = join(customerDir, 'bundle.js');
        if (existsSync(bundlePath)) {
          unlinkSync(bundlePath);
          anyChanges = true;
          console.log('  Deleted bundle.js');
        }
      }

      return {
        status: 'applied',
        changed: anyChanges,
        extra: { vitePluginApiRoutesPreserved: vitePluginPreserved },
      };
    }
  },
  {
    id: 'normalize-vite-html-entry',
    description: 'Restore static Vite main entry; add CSS-link fallback for customized boot scripts',
    run(customerDir, syncedFiles) {
      if (syncedFiles.has('index.html')) return { status: 'skipped', reason: 'index_html_synced_fresh' };

      const htmlPath = join(customerDir, 'index.html');
      if (!existsSync(htmlPath)) return { status: 'skipped', reason: 'index_html_missing' };

      const original = readFileSync(htmlPath, 'utf8');
      const { html: staticEntryHtml, replaced } = replaceKnownDevRetryEntry(original);
      let updated = staticEntryHtml;

      if (replaced) {
        console.log('  Restored static Vite main entry in index.html');
      } else if (!updated.includes(STATIC_MAIN_ENTRY)) {
        if (!MODULE_SCRIPT_RE.test(updated)) {
          console.log('  ⚠️  No module boot script found in index.html; skipping CSS-link fallback');
          return { status: 'skipped', reason: 'no_module_boot_script' };
        }

        if (GLOBALS_CSS_LINK_RE.test(updated)) {
          // The customized boot path already has the stylesheet fallback,
          // so the migration target is present without another write.
          return { status: 'applied', changed: false };
        }

        const globalsPath = join(customerDir, 'src/styles/globals.css');
        if (!existsSync(globalsPath)) {
          console.log('  ⚠️  src/styles/globals.css not found; skipping CSS-link fallback');
          return { status: 'skipped', reason: 'globals_css_missing' };
        }

        const result = injectGlobalsCssLink(updated);
        updated = result.html;
        if (result.injected) {
          console.log('  Injected globals.css stylesheet link into index.html');
        } else {
          console.log('  ⚠️  Could not locate <head> for CSS-link fallback');
          return { status: 'skipped', reason: 'head_tag_missing' };
        }
      }

      // Returning applied for the already-static-entry state is intentional:
      // the migration's target shape is present, so dashboards can treat this
      // app as converged without requiring a filesystem write.
      const changed = updated !== original;
      if (changed) {
        writeFileSync(htmlPath, updated, 'utf8');
      }

      return { status: 'applied', changed };
    }
  },
  {
    id: 'inject-ssr-markers',
    description: 'Inject <!--app-head--> and <!--app-html--> into customer-modified index.html',
    run(customerDir, syncedFiles) {
      if (syncedFiles.has('index.html')) return { status: 'skipped', reason: 'index_html_synced_fresh' };
      const htmlPath = join(customerDir, 'index.html');
      if (!existsSync(htmlPath)) return { status: 'skipped', reason: 'index_html_missing' };

      // Don't inject markers when SSR isn't fully installed — otherwise an
      // app whose ssrMigration sync group was blocked (e.g. customer-modified
      // vite.config.ts) or whose migrate-to-ssr-entry took the customized-
      // build branch ends up with dead marker comments that no server ever
      // replaces, and later agent edits of index.html get confused by them.
      if (!isSsrInstalled(customerDir)) {
        console.log('  ⏭️  SSR not installed; skipping marker injection');
        return { status: 'skipped', reason: 'ssr_not_installed' };
      }

      const original = readFileSync(htmlPath, 'utf8');
      const hasHead = original.includes('<!--app-head-->');
      const hasHtml = original.includes('<!--app-html-->');
      if (hasHead && hasHtml) {
        return { status: 'applied', changed: false };
      }

      const appDivRe = /<div id="app"([^>]*)><\/div>/;
      if (!hasHtml && !appDivRe.test(original)) {
        console.log('  ⚠️  Could not locate empty <div id="app"></div>; skipping both markers (ambiguous)');
        return { status: 'skipped', reason: 'app_div_missing' };
      }

      let updated = original;
      if (!hasHead) {
        const headCloseIdx = updated.indexOf('</head>');
        if (headCloseIdx < 0) {
          console.log('  ⚠️  No </head> found; skipping injection (ambiguous)');
          return { status: 'skipped', reason: 'head_tag_missing' };
        }
        updated = updated.slice(0, headCloseIdx) + '<!--app-head-->' + updated.slice(headCloseIdx);
      }
      if (!hasHtml) {
        updated = updated.replace(appDivRe, '<div id="app"$1><!--app-html--></div>');
      }

      const changed = updated !== original;
      if (changed) {
        writeFileSync(htmlPath, updated, 'utf8');
        console.log('  Injected SSR markers into index.html');
      }

      return { status: 'applied', changed };
    }
  },
  {
    id: 'strip-stale-index-title',
    description: 'Strip bare <title> from customer index.html once SSR + Helmet own head metadata',
    run(customerDir, _syncedFiles) {
      const htmlPath = join(customerDir, 'index.html');
      if (!existsSync(htmlPath)) return { status: 'skipped', reason: 'index_html_missing' };

      // Gate on SSR being fully installed. Without SSR wired end-to-end,
      // Helmet isn't driving the head and stripping the static <title>
      // would leave the page titleless.
      if (!isSsrInstalled(customerDir)) return { status: 'skipped', reason: 'ssr_not_installed' };

      const original = readFileSync(htmlPath, 'utf8');
      if (!original.includes('<!--app-head-->')) return { status: 'skipped', reason: 'app_head_marker_missing' };

      const titleRe = /[ \t]*<title(?:\s[^>]*)?>[\s\S]*?<\/title>\r?\n?/i;
      if (!titleRe.test(original)) return { status: 'skipped', reason: 'no_stale_title' };

      const updated = original.replace(titleRe, '');
      const changed = updated !== original;
      if (changed) {
        writeFileSync(htmlPath, updated, 'utf8');
        console.log('  Stripped stale <title> from index.html (Helmet owns <head>)');
      }

      return { status: 'applied', changed };
    }
  },
  {
    id: 'add-eslint-security-plugins',
    description: 'Add eslint-plugin-security and eslint-plugin-no-unsanitized devDependencies for SAST scanning',
    run(customerDir, _syncedFiles) {
      const pkgPath = join(customerDir, 'package.json');
      if (!existsSync(pkgPath)) return { status: 'skipped', reason: 'package_json_missing' };

      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      } catch {
        return { status: 'skipped', reason: 'package_json_parse_error' };
      }
      if (!pkg.devDependencies) pkg.devDependencies = {};

      let changed = false;
      if (!('eslint-plugin-security' in pkg.devDependencies)) {
        pkg.devDependencies['eslint-plugin-security'] = '^3.0.1';
        changed = true;
        console.log('  Added devDependencies.eslint-plugin-security');
      }
      if (!('eslint-plugin-no-unsanitized' in pkg.devDependencies)) {
        pkg.devDependencies['eslint-plugin-no-unsanitized'] = '^4.1.2';
        changed = true;
        console.log('  Added devDependencies.eslint-plugin-no-unsanitized');
      }

      if (!changed) return { status: 'skipped', reason: 'already_present' };

      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      return { status: 'applied', changed: true };
    }
  },
  {
    id: 'add-lockfile-lint',
    description: 'Add lockfile-lint devDependency for supply-chain integrity checks',
    run(customerDir, _syncedFiles) {
      const pkgPath = join(customerDir, 'package.json');
      if (!existsSync(pkgPath)) return { status: 'skipped', reason: 'package_json_missing' };

      let pkg;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      } catch {
        return { status: 'skipped', reason: 'package_json_parse_error' };
      }
      if (!pkg.devDependencies) pkg.devDependencies = {};

      if ('lockfile-lint' in pkg.devDependencies) return { status: 'skipped', reason: 'already_present' };

      pkg.devDependencies['lockfile-lint'] = '~4.13.2';
      console.log('  Added devDependencies.lockfile-lint');
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      return { status: 'applied', changed: true };
    }
  },
  {
    id: 'delete-eslint-security-config-from-workspace',
    description: 'Remove eslint.security.config.js from customer workspace — scanner now reads from /app-template (read-only image layer)',
    run(customerDir, _syncedFiles) {
      const target = join(customerDir, 'eslint.security.config.js');
      if (!existsSync(target)) return { status: 'skipped', reason: 'already_absent' };
      unlinkSync(target);
      console.log('  Deleted eslint.security.config.js (now read from /app-template)');
      return { status: 'applied', changed: true };
    }
  }
];

function md5(content) {
  return createHash('md5').update(content).digest('hex');
}

const ALREADY_CURRENT = 'already_current';

/**
 * Decide for each manifest entry whether we would sync it (without writing).
 * Returns Map<index, boolean | 'already_current'>. Also returns { baseContents: Map<index, string> } for use in second pass.
 */
function computeWouldSync(baseDir, customerDir) {
  const wouldSync = new Map();
  const baseContents = new Map();
  const customerHashes = new Map();

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
      // Intentionally no customerHashes entry: force skips the customer read
      // entirely. A future manifest entry that combines { force: true,
      // syncGroup: '...' } would therefore emit sync.file.blocked without
      // customerHash if the group is blocked by a sibling. Prefer not
      // combining those flags — force is meant to sidestep hash gating.
      wouldSync.set(i, true);
      continue;
    }

    if (!existsSync(customerPath)) {
      wouldSync.set(i, true);
      continue;
    }

    const customerContent = readFileSync(customerPath, 'utf8');
    const customerHash = md5(customerContent);
    customerHashes.set(i, customerHash);
    const baseHash = md5(baseContent);
    if (customerHash === baseHash) {
      wouldSync.set(i, ALREADY_CURRENT);
    } else {
      wouldSync.set(i, known_hashes.includes(customerHash));
    }
  }

  // Apply sync groups: only sync a group if every file in the group would be synced.
  // A group where all files are already at the current version (ALREADY_CURRENT) is also
  // considered resolved — skip without noise rather than logging as blocked.
  const groupToIndices = new Map();
  for (let i = 0; i < SYNC_MANIFEST.length; i++) {
    const group = SYNC_MANIFEST[i].syncGroup;
    if (!group) continue;
    if (!groupToIndices.has(group)) groupToIndices.set(group, []);
    groupToIndices.get(group).push(i);
  }
  for (const indices of groupToIndices.values()) {
    const allWouldSync = indices.every((idx) => wouldSync.get(idx) === true || wouldSync.get(idx) === ALREADY_CURRENT);
    if (!allWouldSync) {
      for (const idx of indices) {
        if (wouldSync.get(idx) !== ALREADY_CURRENT) {
          wouldSync.set(idx, false);
        }
      }
    }
  }

  return { wouldSync, baseContents, customerHashes };
}

export function runMigrations(baseDir, customerDir, syncedFiles) {
  // Fail fast on a missing baseDir instead of letting seed-entry-server-tsx
  // surface it as a confusing "Path must be a string. Received undefined"
  // inside readFileSync. The param is load-bearing for any migration that
  // reads from the template.
  if (typeof baseDir !== 'string' || baseDir.length === 0) {
    throw new Error('runMigrations: baseDir is required');
  }
  console.log('');
  console.log('=== Running Migrations ===');

  for (const migration of MIGRATIONS) {
    console.log(`Migration: ${migration.id} — ${migration.description}`);
    const start = Date.now();
    let status;
    let reason;
    let changed;
    let extra;
    try {
      const result = migration.run(customerDir, syncedFiles, baseDir);
      // Result contract: bare 'skipped' | 'applied' | undefined for backward-
      // compatible paths; { status, reason? } for skipped; { status: 'applied',
      // changed: boolean, extra?: Record<string, unknown> } for applied. `extra`
      // keys merge onto the applied event payload so migrations can surface
      // guard trips or other structured signals without new scalar params on
      // runMigrations — dashboards query those fields directly instead of
      // grepping free-text log lines.
      const resultStatus = typeof result === 'string' ? result : result?.status;
      status = resultStatus === 'skipped' ? 'skipped' : 'applied';
      if (status === 'skipped' && result?.reason) {
        reason = result.reason;
      }
      if (status === 'applied' && typeof result?.changed === 'boolean') {
        changed = result.changed;
      }
      if (result?.extra && typeof result.extra === 'object') {
        extra = result.extra;
      }
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
    // Canonical fields spread last so a migration that accidentally returns
    // `extra: { event, migrationId, durationMs }` can't displace them in Loki.
    console.log(JSON.stringify({
      ...(extra ?? {}),
      event: `migration.${migration.id}.${status}`,
      migrationId: migration.id,
      durationMs: Date.now() - start,
      ...(reason ? { reason } : {}),
      ...(typeof changed === 'boolean' ? { changed } : {}),
    }));
  }
}

export function syncTemplateFiles(baseDir, customerDir) {
  console.log('=== Template File Sync ===');
  console.log(`Base template: ${baseDir}`);
  console.log(`Customer app:  ${customerDir}`);
  console.log('');

  const { wouldSync, baseContents, customerHashes } = computeWouldSync(baseDir, customerDir);

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

    const syncState = wouldSync.get(i);
    if (syncState === ALREADY_CURRENT) {
      const groupSuffix = syncGroup ? ` (sync group "${syncGroup}")` : '';
      console.log(`  ✅ Already at current version${groupSuffix}`);
      skipped++;
      continue;
    }
    if (!syncState) {
      const customerHash = customerHashes.get(i);
      if (customerHash) {
        console.log(`  Current hash: ${customerHash}`);
      }
      if (syncGroup) {
        console.log(`  ⏭️  Skipping (sync group "${syncGroup}": sync all or none to avoid inconsistent state)`);
      } else {
        console.log(`  ⏭️  Hash doesn't match known versions, skipping (customer modified)`);
      }
      // Structured telemetry: one event per blocked/unsynced file so Loki can
      // histogram which files are blocking which groups. customerHash tells
      // us whether to extend known_hashes (one dominant hash → backfill) or
      // accept it as real divergence (long tail of unique hashes).
      console.log(JSON.stringify({
        event: 'sync.file.blocked',
        file,
        reason: syncGroup ? 'sync_group_member_blocked' : 'customer_modified_unknown_hash',
        ...(syncGroup ? { syncGroup } : {}),
        ...(customerHash ? { customerHash } : {}),
      }));
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
  runMigrations(baseDir, customerDir, syncedFiles);

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
    syncTemplateFiles(baseDir, customerDir);
  } catch (error) {
    // Pass the Error object so Node formats the full stack, not just the
    // message - the migration.<id>.failed event already captures the
    // message; the stack is what points ops at the failing line.
    console.error('Error in sync-template-files:', error);
    process.exit(1);
  }
}
