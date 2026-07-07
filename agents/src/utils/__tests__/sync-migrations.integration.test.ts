import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../../..');
const baseTemplateDir = join(repoRoot, 'app-templates/v8');
const originalSyncScriptPath = join(repoRoot, 'container-scripts/preview/sync-template-files.js');

// In production the script lives at /management-scripts/sync-template-files.js
// inside the v8 preview container and resolves @babel/* from the customer
// app's /node_modules. Locally, container-scripts/preview/ isn't a workspace
// package and the workspace root only hoists a partial @babel set — so
// spawned `node` can't find @babel/generator. NODE_PATH doesn't apply to ESM,
// so instead we copy the script under agents/ where Node's ESM resolver
// finds agents/node_modules naturally. Source-of-truth for the script
// remains container-scripts/preview/sync-template-files.js.
const agentsRoot = resolve(__dirname, '../../..');
const scriptCopyDir = join(agentsRoot, '.test-runner');
const syncScriptPath = join(scriptCopyDir, 'sync-template-files.js');

interface ScriptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface MigrationEvent {
  event: string;
  migrationId?: string;
  durationMs?: number;
  error?: string;
}

type BaseJsonEvent = { event: string } & Record<string, unknown>;

const tempRoots: string[] = [];

beforeAll(() => {
  // Stage the production script under agents/ so its ESM imports resolve
  // against agents/node_modules. This mirrors the production resolution
  // (script in /management-scripts/, node_modules at /node_modules) without
  // requiring a workspace-level change. Re-copied each run so changes to the
  // source script are picked up.
  mkdirSync(scriptCopyDir, { recursive: true });
  cpSync(originalSyncScriptPath, syncScriptPath);
});

afterAll(() => {
  rmSync(scriptCopyDir, { recursive: true, force: true });
});

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function writeFile(root: string, path: string, content: string): void {
  const abs = join(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseJsonEvents(stream: string): BaseJsonEvent[] {
  return stream
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .map((line) => {
      try {
        return JSON.parse(line) as BaseJsonEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is BaseJsonEvent => event !== null && typeof event.event === 'string');
}

function parseMigrationEvents(stream: string): MigrationEvent[] {
  return parseJsonEvents(stream).filter((event): event is MigrationEvent => event.event.startsWith('migration.'));
}

function expectNoStderr(stream: string): void {
  expect(stream.trim()).toBe('');
}

async function runSync(customerDir: string): Promise<ScriptResult> {
  const result = await execa('node', [syncScriptPath, baseTemplateDir, customerDir], {
    reject: false,
  });
  return {
    exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function copyHistoricalTemplate(commit: string, customerDir: string): Promise<void> {
  const extractDir = tempDir('sync-migrations-archive-');
  const archivePath = join(extractDir, 'template.tar');

  await execa('git', ['archive', '--format=tar', `--output=${archivePath}`, commit, 'app-templates/v8'], {
    cwd: repoRoot,
  });
  await execa('tar', ['-xf', archivePath, '-C', extractDir]);

  const extractedTemplateDir = join(extractDir, 'app-templates/v8');
  if (!existsSync(extractedTemplateDir)) {
    throw new Error(`git archive for commit ${commit} produced no app-templates/v8 directory`);
  }
  cpSync(extractedTemplateDir, customerDir, { recursive: true });
}

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}

function md5(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

function treeHash(root: string): string {
  const hash = createHash('sha256');

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs);
      if (rel === '.git' || rel.startsWith(`.git/`)) continue;

      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }

      if (!entry.isFile()) continue;
      const stat = statSync(abs);
      hash.update(rel);
      hash.update('\0');
      hash.update(String(stat.mode & 0o777));
      hash.update('\0');
      hash.update(readFileSync(abs));
      hash.update('\0');
    }
  }

  walk(root);
  return hash.digest('hex');
}

const bareLegacyEntry = `import express from "express";
import healthGet from "./api/health/GET";

const app = express();
app.get("/api/health", healthGet);

export default app;
`;

const markedEntry = `import express from "express";
// <api-imports>
import healthGet from "./api/health/GET";
// </api-imports>

const app = express();
// <api-registrations>
app.get("/api/health", healthGet);
// </api-registrations>

export default app;
`;

const entryServerStub = 'export function render() { return { html: "", head: "", status: 200 }; }\n';

function seedLegacyCustomerApp(root: string): void {
  writeFile(root, 'src/server/api/health/GET.ts', 'export default (_req, res) => res.json({ ok: true });\n');
  writeFile(root, 'src/server/configure.js', 'export default function configure() {}\n');
  writeFile(root, 'bundle.js', 'console.log("legacy bundle");\n');
  writeFile(root, '.gitignore', 'node_modules\n# Public Assets\npublic/assets\n');
  writeFile(
    root,
    'index.html',
    [
      '<!doctype html>',
      '<html lang="en">',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <title>Legacy Title</title>',
      '  </head>',
      '  <body>',
      '    <div id="app"></div>',
      '    <script type="module" src="/src/main.tsx"></script>',
      '  </body>',
      '</html>',
      '',
    ].join('\n'),
  );

  writeFile(
    root,
    'package.json',
    JSON.stringify(
      {
        name: 'fixture-app',
        version: '1.0.0',
        type: 'module',
        scripts: {
          build: 'vite build && node dist/bundle.js',
          bundle: 'node dist/bundle.js',
        },
        dependencies: {
          express: '^5.1.0',
          'vite-plugin-api-routes': '^0.1.0',
        },
        devDependencies: {
          esbuild: '^0.20.0',
        },
      },
      null,
      2,
    ) + '\n',
  );
}

function mutatePackageJson(root: string, mutate: (pkg: Record<string, any>) => void): void {
  const pkgPath = join(root, 'package.json');
  const pkg = readJson(pkgPath);
  mutate(pkg);
  writeFile(root, 'package.json', JSON.stringify(pkg, null, 2) + '\n');
}

function seedInstalledSsrApp(root: string, html?: string): void {
  writeFile(root, 'src/entry-server.tsx', entryServerStub);
  writeFile(root, 'src/server/entry.ts', markedEntry);
  writeFile(root, 'src/server/api/health/GET.ts', 'export default (_req, res) => res.json({ ok: true });\n');
  writeFile(
    root,
    'package.json',
    JSON.stringify(
      {
        name: 'fixture-app',
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'vite build && vite build --ssr src/server/entry.ts' },
        dependencies: {},
        devDependencies: {},
      },
      null,
      2,
    ) + '\n',
  );
  writeFile(
    root,
    'index.html',
    html ??
      [
        '<!doctype html>',
        '<html lang="en">',
        '  <head>',
        '    <title>Installed SSR</title>',
        '  </head>',
        '  <body>',
        '    <div id="app"></div>',
        '  </body>',
        '</html>',
        '',
      ].join('\n'),
  );
}

function seedSsrCandidateApp(
  root: string,
  options: {
    entry?: string;
    apiFiles?: Record<string, string>;
    packageJson?: Record<string, any>;
    configureJs?: boolean;
    bundleJs?: boolean;
  } = {},
): void {
  writeFile(root, 'src/entry-server.tsx', entryServerStub);
  writeFile(root, 'src/server/entry.ts', options.entry ?? bareLegacyEntry);

  const apiFiles = options.apiFiles ?? {
    'health/GET.ts': 'export default (_req, res) => res.json({ ok: true });\n',
  };
  // Keep the directory present even when apiFiles is {}, so tests can
  // distinguish an empty API tree from a missing API tree.
  mkdirSync(join(root, 'src/server/api'), { recursive: true });
  for (const [path, content] of Object.entries(apiFiles)) {
    writeFile(root, `src/server/api/${path}`, content);
  }

  writeFile(
    root,
    'package.json',
    JSON.stringify(
      options.packageJson ?? {
        name: 'fixture-app',
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'vite build && node dist/bundle.js', bundle: 'node dist/bundle.js' },
        dependencies: { 'vite-plugin-api-routes': '^0.1.0' },
        devDependencies: { esbuild: '^0.20.0' },
      },
      null,
      2,
    ) + '\n',
  );
  if (options.configureJs !== false) {
    writeFile(root, 'src/server/configure.js', 'export default function configure() {}\n');
  }
  if (options.bundleJs !== false) {
    writeFile(root, 'bundle.js', 'console.log("legacy bundle");\n');
  }
  writeFile(root, 'index.html', '<html><head><title>Legacy</title></head><body><div id="app"></div></body></html>\n');
}

function seedPartialMigrationFailureRepo(root: string): void {
  writeFile(root, 'src/entry-server.tsx', entryServerStub);
  writeFile(root, 'src/server/entry.ts', bareLegacyEntry);
  writeFile(root, 'src/server/api/health/GET.ts', 'export default (_req, res) => res.json({ ok: true });\n');
  writeFile(root, 'src/server/configure.js', 'export default function configure() {}\n');
  writeFile(root, 'index.html', '<html><head><title>Legacy</title></head><body><div id="app"></div></body></html>\n');
  writeFile(root, 'package.json', '{ "scripts": { "build": "vite build" },');
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}

describe.skip('sync-template-files black-box migration harness', () => {
  // Declared order mirrors MIGRATIONS in container-scripts/preview/sync-template-files.js.
  // seed-entry-server-tsx must run before migrate-to-ssr-entry — the latter guards on
  // existsSync(entry-server.tsx) and would skip with `entry_server_missing` for any app
  // whose ssrMigration sync group is blocked (pre-SSR legacy apps, ~1,300 in prod).
  const migrationOrder = [
    'remove-public-assets-gitignore',
    'seed-entry-server-tsx',
    'ensure-helmet-provider',
    'restore-vite-plugin-api-routes-dep',
    'migrate-to-ssr-entry',
    'normalize-vite-html-entry',
    'inject-ssr-markers',
    'strip-stale-index-title',
    'add-eslint-security-plugins',
    'add-lockfile-lint',
  ];

  // Every historical template below predates `src/entry-server.tsx` (see `git cat-file -e
  // <commit>:app-templates/v8/src/entry-server.tsx` — all six miss the file). With the
  // PR #3525 known_hashes backfill, the ssrMigration sync group stays green for each
  // of these templates, so the hash-sync phase creates entry-server.tsx from the base
  // before migrations run. By the time seed-entry-server-tsx runs the file exists and
  // it skips with reason=entry_server_exists.
  const historicalTemplateCheckpoints = [
    {
      commit: 'fd075bd82bfa77f2c6d9f5d93c6e99b85e64c0ff',
      label: '2026-03-12 closeBundle plugin era',
      expectedEvents: [
        'migration.remove-public-assets-gitignore.applied',
        'migration.seed-entry-server-tsx.skipped',
        'migration.ensure-helmet-provider.applied',
        'migration.restore-vite-plugin-api-routes-dep.skipped',
        'migration.migrate-to-ssr-entry.applied',
        'migration.normalize-vite-html-entry.skipped',
        'migration.inject-ssr-markers.skipped',
        'migration.strip-stale-index-title.skipped',
        'migration.add-eslint-security-plugins.applied',
        'migration.add-lockfile-lint.applied',
      ],
    },
    {
      commit: 'ed8aa4445573979b078e4dbdc6f48f7309c2b480',
      label: '2026-04-14 tsc Vite plugin era',
      expectedEvents: [
        'migration.remove-public-assets-gitignore.applied',
        'migration.seed-entry-server-tsx.skipped',
        'migration.ensure-helmet-provider.applied',
        'migration.restore-vite-plugin-api-routes-dep.skipped',
        'migration.migrate-to-ssr-entry.applied',
        'migration.normalize-vite-html-entry.skipped',
        'migration.inject-ssr-markers.skipped',
        'migration.strip-stale-index-title.skipped',
        'migration.add-eslint-security-plugins.applied',
        'migration.add-lockfile-lint.applied',
      ],
    },
    {
      commit: '9ec21710e6fd1da06fea27579a2c1fff1e3bc15e',
      label: '2026-04-23 pinned vite-plugin-api-routes',
      expectedEvents: [
        'migration.remove-public-assets-gitignore.applied',
        'migration.seed-entry-server-tsx.skipped',
        'migration.ensure-helmet-provider.applied',
        'migration.restore-vite-plugin-api-routes-dep.skipped',
        'migration.migrate-to-ssr-entry.applied',
        'migration.normalize-vite-html-entry.skipped',
        'migration.inject-ssr-markers.skipped',
        'migration.strip-stale-index-title.skipped',
        'migration.add-eslint-security-plugins.applied',
        'migration.add-lockfile-lint.applied',
      ],
    },
    {
      commit: 'f4097ef83f52f7d023eb785f4bbbf4459eb94c84',
      label: '2026-04-23 optional db import suppression',
      expectedEvents: [
        'migration.remove-public-assets-gitignore.applied',
        'migration.seed-entry-server-tsx.skipped',
        'migration.ensure-helmet-provider.applied',
        'migration.restore-vite-plugin-api-routes-dep.skipped',
        'migration.migrate-to-ssr-entry.applied',
        'migration.normalize-vite-html-entry.skipped',
        'migration.inject-ssr-markers.skipped',
        'migration.strip-stale-index-title.skipped',
        'migration.add-eslint-security-plugins.applied',
        'migration.add-lockfile-lint.applied',
      ],
    },
    {
      commit: '01d44e870ebc2267eb1c04859bd5c69c1bdbfbf9',
      label: '2026-04-24 latest pre-branch template hash backfill',
      expectedEvents: [
        'migration.remove-public-assets-gitignore.applied',
        'migration.seed-entry-server-tsx.skipped',
        'migration.ensure-helmet-provider.applied',
        'migration.restore-vite-plugin-api-routes-dep.skipped',
        'migration.migrate-to-ssr-entry.applied',
        'migration.normalize-vite-html-entry.skipped',
        'migration.inject-ssr-markers.skipped',
        'migration.strip-stale-index-title.skipped',
        'migration.add-eslint-security-plugins.applied',
        'migration.add-lockfile-lint.applied',
      ],
    },
    {
      commit: '497ffb01ce569381625f5a12d1ea7850fd4b9421',
      label: '2026-04-30 latest origin/main template',
      expectedEvents: [
        'migration.remove-public-assets-gitignore.applied',
        'migration.seed-entry-server-tsx.skipped',
        'migration.ensure-helmet-provider.applied',
        'migration.restore-vite-plugin-api-routes-dep.skipped',
        'migration.migrate-to-ssr-entry.applied',
        'migration.normalize-vite-html-entry.skipped',
        'migration.inject-ssr-markers.skipped',
        'migration.strip-stale-index-title.skipped',
        'migration.add-eslint-security-plugins.applied',
        'migration.add-lockfile-lint.applied',
      ],
    },
  ];

  it.each(historicalTemplateCheckpoints)(
    'migrates historical app-template checkpoint: $label ($commit)',
    async ({ commit, expectedEvents }) => {
      const customerDir = tempDir(`sync-migrations-history-${commit}-`);
      await copyHistoricalTemplate(commit, customerDir);

      const first = await runSync(customerDir);
      expect(first.exitCode).toBe(0);
      expectNoStderr(first.stderr);

      const stdoutEvents = parseMigrationEvents(first.stdout).map((event) => event.event);
      expect(stdoutEvents).toEqual(expectedEvents);

      const pkg = readJson(join(customerDir, 'package.json'));
      expect(pkg.scripts.build).toContain('--ssr');
      expect(pkg.dependencies ?? {}).not.toHaveProperty('vite-plugin-api-routes');
      expect(pkg.devDependencies ?? {}).not.toHaveProperty('vite-plugin-api-routes');
      expect(pkg.devDependencies ?? {}).not.toHaveProperty('esbuild');

      expect(existsSync(join(customerDir, 'src/entry-server.tsx'))).toBe(true);
      expect(existsSync(join(customerDir, 'src/server/entry.ts'))).toBe(true);
      expect(existsSync(join(customerDir, 'src/server/configure.js'))).toBe(false);

      const entry = readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8');
      expect(entry).toContain('// <api-imports>');
      expect(entry).toContain('// <api-registrations>');

      const html = readFileSync(join(customerDir, 'index.html'), 'utf8');
      expect(countOccurrences(html, '<!--app-head-->')).toBe(1);
      expect(countOccurrences(html, '<!--app-html-->')).toBe(1);

      const tailwindConfig = readFileSync(join(customerDir, 'tailwind.config.js'), 'utf8');
      expect(tailwindConfig).toContain("import tailwindcssAnimate from 'tailwindcss-animate'");
      expect(tailwindConfig).toContain('plugins: [tailwindcssAnimate]');
      expect(tailwindConfig).not.toContain('require("tailwindcss-animate")');

      const beforeSecondRun = treeHash(customerDir);
      const second = await runSync(customerDir);
      expect(second.exitCode).toBe(0);
      expectNoStderr(second.stderr);
      expect(treeHash(customerDir)).toBe(beforeSecondRun);
      expect(second.stdout).not.toContain('sync group blocked');
      expect(second.stdout).toContain('Already at current version');
    },
  );

  it('migrates a legacy app to SSR and is filesystem-idempotent on the second run', async () => {
    const customerDir = tempDir('sync-migrations-legacy-');
    seedLegacyCustomerApp(customerDir);

    const first = await runSync(customerDir);
    expect(first.exitCode).toBe(0);

    const stdoutEvents = parseMigrationEvents(first.stdout);
    expectNoStderr(first.stderr);
    expect(stdoutEvents.map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'migration.remove-public-assets-gitignore.applied',
        'migration.migrate-to-ssr-entry.applied',
        'migration.inject-ssr-markers.applied',
        'migration.strip-stale-index-title.applied',
      ]),
    );

    const pkg = readJson(join(customerDir, 'package.json'));
    expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
    expect(pkg.scripts).not.toHaveProperty('bundle');
    expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
    expect(pkg.devDependencies).not.toHaveProperty('esbuild');
    expect(existsSync(join(customerDir, 'src/server/configure.js'))).toBe(false);
    expect(existsSync(join(customerDir, 'bundle.js'))).toBe(false);
    expect(readFileSync(join(customerDir, '.gitignore'), 'utf8')).not.toContain('public/assets');

    const html = readFileSync(join(customerDir, 'index.html'), 'utf8');
    expect(countOccurrences(html, '<!--app-head-->')).toBe(1);
    expect(countOccurrences(html, '<!--app-html-->')).toBe(1);
    expect(html).not.toMatch(/<title/i);

    const beforeSecondRun = treeHash(customerDir);
    const second = await runSync(customerDir);
    expect(second.exitCode).toBe(0);
    expectNoStderr(second.stderr);
    expect(treeHash(customerDir)).toBe(beforeSecondRun);
  });

  it('emits success events on stdout with migrationId, durationMs, and declared order', async () => {
    const customerDir = tempDir('sync-migrations-observability-');
    seedLegacyCustomerApp(customerDir);

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const stdoutEvents = parseMigrationEvents(result.stdout);
    expectNoStderr(result.stderr);
    expect(stdoutEvents).toHaveLength(migrationOrder.length);
    expect(stdoutEvents.map((event) => event.migrationId)).toEqual(migrationOrder);

    // On this legacy fixture, ssrMigration group members are all absent so the
    // hash-sync phase creates them from the base (group is trivially green) — which
    // means seed-entry-server-tsx runs after entry-server.tsx is already in place
    // and skips. Every other migration applies.
    const skippedMigrations = ['seed-entry-server-tsx', 'restore-vite-plugin-api-routes-dep'];
    for (const event of stdoutEvents) {
      const suffix = skippedMigrations.includes(event.migrationId) ? 'skipped' : 'applied';
      expect(event.event).toBe(`migration.${event.migrationId}.${suffix}`);
      expect(typeof event.durationMs).toBe('number');
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('preserves non-legacy scripts.bundle while stripping legacy bundle build steps', async () => {
    const customerDir = tempDir('sync-migrations-bundle-preserve-');
    seedLegacyCustomerApp(customerDir);
    const pkg = readJson(join(customerDir, 'package.json'));
    pkg.scripts.bundle = 'node src/bundle/index.js';
    writeFile(customerDir, 'package.json', JSON.stringify(pkg, null, 2) + '\n');

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const migrated = readJson(join(customerDir, 'package.json'));
    expect(migrated.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
    expect(migrated.scripts.bundle).toBe('node src/bundle/index.js');
    expect(existsSync(join(customerDir, 'bundle.js'))).toBe(false);
  });

  it.each([
    {
      name: 'missing app-html marker',
      html: '<html><head><!--app-head--></head><body><div id="app"></div></body></html>\n',
    },
    {
      name: 'missing app-head marker',
      html: '<html><head></head><body><div id="app"><!--app-html--></div></body></html>\n',
    },
  ])('injects only missing SSR marker for $name', async ({ html }) => {
    const customerDir = tempDir('sync-migrations-partial-markers-');
    seedInstalledSsrApp(customerDir, html);

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const migrated = readFileSync(join(customerDir, 'index.html'), 'utf8');
    expect(countOccurrences(migrated, '<!--app-head-->')).toBe(1);
    expect(countOccurrences(migrated, '<!--app-html-->')).toBe(1);
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.inject-ssr-markers.applied');
  });

  it.each([
    {
      name: 'non-empty app root',
      html: '<html><head></head><body><div id="app">client content</div></body></html>\n',
    },
    {
      name: 'missing head close',
      html: '<html><head><body><div id="app"></div></body></html>\n',
    },
    {
      name: 'missing app root',
      html: '<html><head></head><body><main></main></body></html>\n',
    },
  ])('skips ambiguous SSR marker injection without mutating index.html: $name', async ({ html }) => {
    const customerDir = tempDir('sync-migrations-ambiguous-markers-');
    seedInstalledSsrApp(customerDir, html);

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(customerDir, 'index.html'), 'utf8')).toBe(html);
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.inject-ssr-markers.skipped');
  });

  it('skips marker injection when manifest sync provides index.html with base SSR markers', async () => {
    const customerDir = tempDir('sync-migrations-index-created-');
    seedInstalledSsrApp(customerDir);
    rmSync(join(customerDir, 'index.html'));

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const html = readFileSync(join(customerDir, 'index.html'), 'utf8');
    expect(countOccurrences(html, '<!--app-head-->')).toBe(1);
    expect(countOccurrences(html, '<!--app-html-->')).toBe(1);
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.inject-ssr-markers.skipped');
  });

  it('strips title variants once SSR markers are present', async () => {
    const customerDir = tempDir('sync-migrations-title-variant-');
    seedInstalledSsrApp(
      customerDir,
      '<html>\r\n<head>\r\n<!--app-head-->\r\n  <title data-owner="legacy">\r\nLegacy\r\nTitle\r\n</title>\r\n</head>\r\n<body><div id="app"><!--app-html--></div></body>\r\n</html>\r\n',
    );

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const html = readFileSync(join(customerDir, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<title/i);
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.strip-stale-index-title.applied');
  });

  it('rewrites already-marked entry.ts to empty marker blocks when api dir is empty', async () => {
    const customerDir = tempDir('sync-migrations-marked-empty-api-');
    seedSsrCandidateApp(customerDir, { entry: markedEntry, apiFiles: {} });

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const entry = readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8');
    expect(entry).toContain('// <api-imports>\n\n// </api-imports>');
    expect(entry).toContain('// <api-registrations>\n\n// </api-registrations>');
    expect(entry).not.toContain('healthGet');
    expect(readJson(join(customerDir, 'package.json')).scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
  });

  it('skips bare entry.ts with an empty api dir without clobbering the health route import', async () => {
    const customerDir = tempDir('sync-migrations-bare-empty-api-');
    seedSsrCandidateApp(customerDir, { apiFiles: {} });

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    expect(readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8')).toBe(bareLegacyEntry);
    expect(existsSync(join(customerDir, 'src/server/configure.js'))).toBe(true);
    expect(readJson(join(customerDir, 'package.json')).scripts.build).toBe('vite build && node dist/bundle.js');
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.migrate-to-ssr-entry.skipped');
  });

  it('skips bare entry.ts with a missing api dir before attempting route generation', async () => {
    const customerDir = tempDir('sync-migrations-missing-api-dir-');
    seedSsrCandidateApp(customerDir);
    rmSync(join(customerDir, 'src/server/api'), { recursive: true, force: true });

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    expect(readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8')).toBe(bareLegacyEntry);
    expect(existsSync(join(customerDir, 'src/server/configure.js'))).toBe(true);
    expect(readJson(join(customerDir, 'package.json')).dependencies).toHaveProperty('vite-plugin-api-routes');
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.migrate-to-ssr-entry.skipped');
  });

  it('skips customized entry.ts without mutating it', async () => {
    const customerDir = tempDir('sync-migrations-custom-entry-');
    const customEntry = 'import express from "express";\nconst app = express();\napp.get("/custom", (_req, res) => res.send("ok"));\nexport default app;\n';
    seedSsrCandidateApp(customerDir, { entry: customEntry });

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    expect(readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8')).toBe(customEntry);
    expect(readJson(join(customerDir, 'package.json')).dependencies).toHaveProperty('vite-plugin-api-routes');
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.migrate-to-ssr-entry.skipped');
  });

  it('cleans dependencies but preserves customized build scripts and legacy build files', async () => {
    const customerDir = tempDir('sync-migrations-custom-build-asymmetry-');
    seedSsrCandidateApp(customerDir, {
      packageJson: {
        name: 'fixture-app',
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'tsc && vite build && node bundle.js', bundle: 'node dist/bundle.js' },
        dependencies: { 'vite-plugin-api-routes': '^0.1.0' },
        devDependencies: { esbuild: '^0.20.0' },
      },
    });

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const pkg = readJson(join(customerDir, 'package.json'));
    expect(pkg.scripts.build).toBe('tsc && vite build && node bundle.js');
    expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
    expect(pkg.devDependencies).not.toHaveProperty('esbuild');
    expect(existsSync(join(customerDir, 'src/server/configure.js'))).toBe(true);
    expect(existsSync(join(customerDir, 'bundle.js'))).toBe(true);
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'migration.migrate-to-ssr-entry.applied',
        'migration.inject-ssr-markers.skipped',
      ]),
    );
  });

  it('returns skipped after entry rewrite when package.json is missing and preserves legacy build files', async () => {
    const customerDir = tempDir('sync-migrations-missing-package-');
    seedSsrCandidateApp(customerDir);
    rmSync(join(customerDir, 'package.json'));

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const entry = readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8');
    expect(entry).toContain('// <api-imports>');
    expect(entry).toContain('// <api-registrations>');
    expect(existsSync(join(customerDir, 'src/server/configure.js'))).toBe(true);
    expect(existsSync(join(customerDir, 'bundle.js'))).toBe(true);
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain('migration.migrate-to-ssr-entry.skipped');
  });

  it.skip('seeds entry-server.tsx and fully installs SSR even when the ssrMigration sync group is blocked by customer-edited vite.config.ts', async () => {
    // This is the Bucket A scenario that Work Item A targets. The customer's
    // vite.config.ts carries a hash outside `known_hashes`, which blocks every
    // member of the ssrMigration sync group (all-or-nothing), so the hash-sync
    // phase refuses to place entry-server.tsx. Pre-fix, that cascaded into
    // migrate-to-ssr-entry skipping with `entry_server_missing`, which left
    // isSsrInstalled=false and suppressed the HTML marker migrations — the app
    // stayed pre-SSR forever. Post-fix, seed-entry-server-tsx bypasses the
    // hash-group gating by reading directly from the base template, so SSR
    // installs fully and the HTML migrations run. The customer's vite.config.ts
    // itself stays untouched — group atomicity is still honored for the
    // customer-modified member; only the always-template file is force-seeded.
    const customerDir = tempDir('sync-migrations-blocked-ssr-group-');
    await copyHistoricalTemplate('497ffb01ce569381625f5a12d1ea7850fd4b9421', customerDir);
    writeFile(customerDir, 'vite.config.ts', 'export default { custom: true };\n');
    writeFile(
      customerDir,
      'index.html',
      '<html><head><title>Custom</title></head><body><div id="app"></div><script type="module">import("/custom-entry.tsx")</script></body></html>\n',
    );

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    // Seed landed entry-server.tsx verbatim from the base template.
    const entryServerPath = join(customerDir, 'src/entry-server.tsx');
    expect(existsSync(entryServerPath)).toBe(true);
    expect(readFileSync(entryServerPath, 'utf8')).toBe(
      readFileSync(join(repoRoot, 'app-templates/v8/src/entry-server.tsx'), 'utf8'),
    );

    // Customer's vite.config.ts is preserved — seed only touches the file it owns.
    expect(readFileSync(join(customerDir, 'vite.config.ts'), 'utf8')).toBe(
      'export default { custom: true };\n',
    );

    // HTML migrations all ran now that isSsrInstalled is true: CSS-link fallback
    // injected (customer boot script stayed), SSR markers injected, stale
    // <title> stripped.
    const html = readFileSync(join(customerDir, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="stylesheet" href="/src/styles/globals.css" />');
    expect(html).toContain('import("/custom-entry.tsx")');
    expect(html).toContain('<!--app-head-->');
    expect(html).toContain('<!--app-html-->');
    expect(html).not.toMatch(/<title[\s>]/i);

    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'migration.seed-entry-server-tsx.applied',
        'migration.migrate-to-ssr-entry.applied',
        'migration.normalize-vite-html-entry.applied',
        'migration.inject-ssr-markers.applied',
        'migration.strip-stale-index-title.applied',
      ]),
    );
  });

  it('preserved vite-plugin-api-routes dep does not block HTML migrations when SSR is otherwise installed', async () => {
    const customerDir = tempDir('sync-migrations-preserved-dep-');
    seedSsrCandidateApp(customerDir, {
      entry: markedEntry,
      configureJs: false,
      bundleJs: false,
      packageJson: {
        name: 'fixture-app',
        version: '1.0.0',
        type: 'module',
        scripts: { build: 'vite build && vite build --ssr src/server/entry.ts' },
        dependencies: { 'vite-plugin-api-routes': '^0.1.0' },
        devDependencies: {},
      },
    });
    writeFile(
      customerDir,
      'vite.config.ts',
      `import apiRoutes from 'vite-plugin-api-routes';\nimport react from '@vitejs/plugin-react';\nexport default { plugins: [react(), apiRoutes()] };\n`,
    );

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);
    expectNoStderr(result.stderr);

    const events = parseMigrationEvents(result.stdout);
    const byId = Object.fromEntries(events.map((e) => [e.migrationId, e]));

    // Plugin preserved because vite.config.ts imports it.
    expect(byId['migrate-to-ssr-entry']?.event).toBe('migration.migrate-to-ssr-entry.applied');
    const pkg = readJson(join(customerDir, 'package.json'));
    expect(pkg.dependencies['vite-plugin-api-routes']).toBe('^0.1.0');

    // HTML migrations run despite preserved dep — the regression this PR fixes.
    expect(byId['inject-ssr-markers']?.event).toBe('migration.inject-ssr-markers.applied');
    expect(byId['strip-stale-index-title']?.event).toBe('migration.strip-stale-index-title.applied');

    const html = readFileSync(join(customerDir, 'index.html'), 'utf8');
    expect(html).toContain('<!--app-head-->');
    expect(html).toContain('<!--app-html-->');
    expect(html).not.toMatch(/<title[\s>]/i);
  });

  it('emits isSsrInstalled read errors on stderr without failing the sync run', async () => {
    const customerDir = tempDir('sync-migrations-ssr-read-error-');
    seedInstalledSsrApp(customerDir);
    rmSync(join(customerDir, 'src/server/api'), { recursive: true, force: true });
    writeFile(customerDir, 'package.json', '{ "scripts": { "build": "vite build && vite build --ssr src/server/entry.ts" },');

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    expect(parseJsonEvents(result.stderr)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'isSsrInstalled.read-error',
        }),
      ]),
    );
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'migration.migrate-to-ssr-entry.skipped',
        'migration.inject-ssr-markers.skipped',
      ]),
    );
  });

  it('removes public/assets gitignore variants while preserving unrelated entries', async () => {
    const customerDir = tempDir('sync-migrations-gitignore-');
    seedLegacyCustomerApp(customerDir);
    writeFile(customerDir, '.gitignore', 'node_modules\r\n# Public Assets\r\npublic/assets/\r\ndist\r\n');

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const gitignore = readFileSync(join(customerDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules');
    expect(gitignore).toContain('dist');
    expect(gitignore).not.toContain('Public Assets');
    expect(gitignore).not.toContain('public/assets');
  });

  it('preserves customized build pipelines and skips HTML SSR markers when SSR is not fully installed', async () => {
    const customerDir = tempDir('sync-migrations-custom-build-');
    seedLegacyCustomerApp(customerDir);
    mutatePackageJson(customerDir, (pkg) => {
      pkg.scripts.build = 'vite build && node scripts/custom-build.js';
    });

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    const events = parseMigrationEvents(result.stdout);
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining([
        'migration.migrate-to-ssr-entry.applied',
        'migration.inject-ssr-markers.skipped',
        'migration.strip-stale-index-title.skipped',
      ]),
    );

    const pkg = readJson(join(customerDir, 'package.json'));
    expect(pkg.scripts.build).toBe('vite build && node scripts/custom-build.js');
    expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
    expect(pkg.devDependencies).not.toHaveProperty('esbuild');
    expect(existsSync(join(customerDir, 'src/server/configure.js'))).toBe(true);

    const html = readFileSync(join(customerDir, 'index.html'), 'utf8');
    expect(html).not.toContain('<!--app-head-->');
    expect(html).not.toContain('<!--app-html-->');
    expect(html).toMatch(/<title>Legacy Title<\/title>/);
  });

  it('creates entry-server.tsx and runs migration when entry.ts has been agent-modified but entry-server.tsx is missing', async () => {
    // Regression test for the Pattern 2 circular dependency:
    // migrate-to-ssr-entry rewrites entry.ts with per-app API routes, giving it a unique hash.
    // Before this fix, entry.ts was in the ssrMigration group, so its unknown hash blocked
    // the entire group — meaning entry-server.tsx could never be created, and without
    // entry-server.tsx the migration couldn't run. Circular.
    //
    // Pattern 2 apps have: main.tsx / App.tsx / vite.config.ts at old known-hash versions
    // (they were synced before the SSR group was added), entry-server.tsx absent, and
    // entry.ts at an agent-modified unknown hash.
    const customerDir = tempDir('sync-migrations-pattern2-');

    // Start from the pre-SSR-foundation template: main.tsx, App.tsx, vite.config.ts are all
    // at known hashes (13101631, 9be50c9e, 641596ec respectively) and entry-server.tsx is
    // absent. Commit 4b725393f is the commit immediately before 42c8f2c16 (SSR foundation).
    await copyHistoricalTemplate('4b725393f2ed5ab1cceff46097c2d447ddd220dc', customerDir);

    // Overwrite entry.ts with agent-modified content: marked blocks with unique per-app routes.
    // This hash does not appear in known_hashes and is not the current template version.
    const agentModifiedEntry =
      'import express from "express";\n' +
      '// <api-imports>\n' +
      'import healthGet from "./api/health/GET";\n' +
      'import itemsGet from "./api/items/GET";\n' +
      '// </api-imports>\n\n' +
      'const app = express();\n' +
      '// <api-registrations>\n' +
      'app.get("/api/health", healthGet);\n' +
      'app.get("/api/items", itemsGet);\n' +
      '// </api-registrations>\n\n' +
      'export default app;\n';
    writeFile(customerDir, 'src/server/entry.ts', agentModifiedEntry);
    writeFile(customerDir, 'src/server/api/health/GET.ts', 'export default (_req, res) => res.json({ ok: true });\n');
    writeFile(customerDir, 'src/server/api/items/GET.ts', 'export default (_req, res) => res.json([]);\n');

    // entry-server.tsx does NOT exist — the key Pattern 2 condition.

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(0);

    // The fix: entry-server.tsx is created because entry.ts no longer blocks the group.
    expect(existsSync(join(customerDir, 'src/entry-server.tsx'))).toBe(true);

    // entry.ts was NOT overwritten with the template version (unknown hash → skipped by sync).
    // The migration may subsequently regenerate its marked blocks, which is correct behaviour.
    const finalEntry = readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8');
    const baseEntry = readFileSync(join(baseTemplateDir, 'src/server/entry.ts'), 'utf8');
    expect(finalEntry).not.toBe(baseEntry);

    // With entry-server.tsx now present the migration can run.
    expect(parseMigrationEvents(result.stdout).map((e: MigrationEvent) => e.event)).toContain(
      'migration.migrate-to-ssr-entry.applied',
    );
  });

  it('emits migration failures on stderr and stops before later migrations', async () => {
    const customerDir = tempDir('sync-migrations-corrupt-package-');
    seedLegacyCustomerApp(customerDir);
    writeFile(customerDir, 'package.json', '{ "scripts": { "build": "vite build" },');

    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(1);

    const stderrEvents = parseMigrationEvents(result.stderr);
    expect(stderrEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'migration.migrate-to-ssr-entry.failed',
          migrationId: 'migrate-to-ssr-entry',
        }),
      ]),
    );

    const stdoutEvents = parseMigrationEvents(result.stdout);
    expect(stdoutEvents.map((event) => event.event)).toContain('migration.remove-public-assets-gitignore.applied');
    expect(stdoutEvents.map((event) => event.event)).not.toContain('migration.inject-ssr-markers.applied');
    expect(stdoutEvents.map((event) => event.event)).not.toContain('migration.inject-ssr-markers.skipped');
    expect(stdoutEvents.map((event) => event.event)).not.toContain('migration.migrate-to-ssr-entry.failed');
    expect(result.stderr).toContain('Error in sync-template-files:');
  });

  it('validates the restart transaction boundary: failed partial writes are not committed and a later run can converge', async () => {
    const customerDir = tempDir('sync-migrations-git-transaction-');
    seedPartialMigrationFailureRepo(customerDir);

    await git(customerDir, ['init', '-b', 'main']);
    await git(customerDir, ['config', 'user.email', 'test@example.com']);
    await git(customerDir, ['config', 'user.name', 'Migration Test']);
    await git(customerDir, ['add', '.']);
    await git(customerDir, ['commit', '-m', 'baseline']);

    const baselineHead = await git(customerDir, ['rev-parse', 'HEAD']);
    const result = await runSync(customerDir);
    expect(result.exitCode).toBe(1);
    expect(parseMigrationEvents(result.stderr)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'migration.migrate-to-ssr-entry.failed' }),
      ]),
    );

    expect(await git(customerDir, ['rev-parse', 'HEAD'])).toBe(baselineHead);
    const failedStatus = (await git(customerDir, ['status', '--short'])).split('\n').sort();
    expect(failedStatus).toEqual(
      expect.arrayContaining([
        '?? public/',
        '?? src/components/',
        '?? src/layouts/',
        '?? src/lib/',
        '?? tailwind.config.js',
      ]),
    );
    expect(readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8')).toContain('// <api-imports>');

    await git(customerDir, ['reset', '--hard']);
    // reset --hard resets tracked files, but intentionally does not remove
    // untracked files created by the manifest sync before the failure. The
    // load-bearing invariant is that none of it is committed on failure, and
    // a later successful restart can commit the converged state.
    expect((await git(customerDir, ['status', '--short'])).split('\n').sort()).toEqual(
      expect.arrayContaining([
        '?? public/',
        '?? src/components/',
        '?? src/layouts/',
        '?? src/lib/',
        '?? tailwind.config.js',
      ]),
    );
    expect(readFileSync(join(customerDir, 'src/server/entry.ts'), 'utf8')).toBe(bareLegacyEntry);

    writeFile(
      customerDir,
      'package.json',
      JSON.stringify(
        {
          scripts: { build: 'vite build && node dist/bundle.js', bundle: 'node dist/bundle.js' },
          dependencies: { 'vite-plugin-api-routes': '^0.1.0' },
          devDependencies: { esbuild: '^0.20.0' },
        },
        null,
        2,
      ) + '\n',
    );

    const recovery = await runSync(customerDir);
    expect(recovery.exitCode).toBe(0);
    await git(customerDir, ['add', '.']);
    await git(customerDir, ['commit', '-m', 'sync upstream template files']);

    expect(await git(customerDir, ['rev-parse', 'HEAD'])).not.toBe(baselineHead);
    expect(await git(customerDir, ['status', '--short'])).toBe('');
    expect(readJson(join(customerDir, 'package.json')).scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
  });
});

describe('sync-template-files entrypoint', () => {
  it('syncs the format override manifest group for an existing app', async () => {
    const customerDir = tempDir('sync-template-entrypoint-format-overrides-');
    const currentPlugin = readFileSync(join(baseTemplateDir, 'format-overrides-plugin.ts'), 'utf8');
    const previousPlugin = currentPlugin
      .replace(
        [
          'function warnInvalidSidecar(scope: string, reason: string): void {',
          '  console.warn(JSON.stringify({',
          "    event: 'format-overrides.sidecar.invalid',",
          '    scope,',
          '    reason,',
          '  }))',
          '}',
        ].join('\n'),
        [
          'function warnInvalidSidecar(scope: string, reason: string): void {',
          '  console.warn(`[format-overrides] Ignoring ${scope}: ${reason}`)',
          '}',
        ].join('\n'),
      )
      .replace("export const FORMAT_OVERRIDES_UPDATE_EVENT = 'format-overrides:update'\n", '')
      .replace(
        [
          'function invalidateFormatOverridesModule(server: ViteDevServer, root: string): void {',
          '  const module = server.moduleGraph.getModuleById(RESOLVED_FORMAT_OVERRIDES_MODULE_ID)',
          '  if (module) server.moduleGraph.invalidateModule(module)',
          '  server.ws.send(FORMAT_OVERRIDES_UPDATE_EVENT, readSidecarBundle(root))',
          '}',
        ].join('\n'),
        [
          'function invalidateFormatOverridesModule(server: ViteDevServer): void {',
          '  const module = server.moduleGraph.getModuleById(RESOLVED_FORMAT_OVERRIDES_MODULE_ID)',
          '  if (module) server.moduleGraph.invalidateModule(module)',
          '  // V1 uses a full reload after sidecar writes. Module-level HMR can replace this later.',
          "  server.ws.send({ type: 'full-reload' })",
          '}',
        ].join('\n'),
      )
      .replaceAll('invalidateFormatOverridesModule(server, root)', 'invalidateFormatOverridesModule(server)');
    const currentBoundText = readFileSync(join(baseTemplateDir, 'src/components/FormattedBoundText.tsx'), 'utf8');
    const previousBoundText = currentBoundText
      .replace("\nimport { useFormatOverrideBundle } from '@/lib/format-overrides-store'", '')
      .replace(
        'import {\n  buildFormatOverrideStyle,',
        "import formatOverrideBundle from 'virtual:format-overrides'\n\nimport {\n  buildFormatOverrideStyle,",
      )
      .replace('  const formatOverrideBundle = useFormatOverrideBundle()\n', '');
    const currentViteEnv = readFileSync(join(baseTemplateDir, 'src/vite-env.d.ts'), 'utf8');
    const previousViteEnv = currentViteEnv
      .replace(/\ndeclare module 'virtual:format-overrides' \{[\s\S]*?\n\}\n?$/, '')
      .replace(/\ninterface Window \{[\s\S]*?\n\}\n/, '');

    expect(md5(previousPlugin)).toBe('f312fbeda3c4be4cad4d8cd6f07a9604');
    expect(md5(previousBoundText)).toBe('3dd3cd453d8c1e0354b864a857f3bd93');
    expect(md5(previousViteEnv)).toBe('7067a198d32f878907c1c1476ef8c4f2');
    writeFile(customerDir, 'format-overrides-plugin.ts', previousPlugin);
    writeFile(customerDir, 'src/components/FormattedBoundText.tsx', previousBoundText);
    writeFile(customerDir, 'src/vite-env.d.ts', previousViteEnv);

    const result = await runSync(customerDir);

    expect(result.exitCode).toBe(0);
    expectNoStderr(result.stderr);
    expect(readFileSync(join(customerDir, 'format-overrides-plugin.ts'), 'utf8')).toBe(
      readFileSync(join(baseTemplateDir, 'format-overrides-plugin.ts'), 'utf8'),
    );
    expect(readFileSync(join(customerDir, 'src/components/FormattedBoundText.tsx'), 'utf8')).toBe(
      readFileSync(join(baseTemplateDir, 'src/components/FormattedBoundText.tsx'), 'utf8'),
    );
    expect(readFileSync(join(customerDir, 'src/lib/format-overrides-store.ts'), 'utf8')).toBe(
      readFileSync(join(baseTemplateDir, 'src/lib/format-overrides-store.ts'), 'utf8'),
    );
    expect(result.stdout).toContain('Checking: format-overrides-plugin.ts');
    expect(result.stdout).toContain('✅ Synced: format-overrides-plugin.ts');
    expect(result.stdout).toContain('=== Running Migrations ===');
    expect(parseJsonEvents(result.stdout)).not.toContainEqual({
      event: 'sync.migrations.skipped',
      reason: 'entrypoint_disabled',
    });
    expect(parseMigrationEvents(result.stdout).map((event) => event.event)).toContain(
      'migration.seed-entry-server-tsx.skipped',
    );
  });

  it('keeps the Vite plugin available when a modified vite-env blocks the format runtime group', async () => {
    const customerDir = tempDir('sync-template-entrypoint-format-overrides-blocked-');
    writeFile(customerDir, 'src/vite-env.d.ts', '/// <reference types="vite/client" />\n// customer modified\n');

    const result = await runSync(customerDir);
    const events = parseJsonEvents(result.stdout);

    expect(result.exitCode).toBe(0);
    expectNoStderr(result.stderr);
    expect(readFileSync(join(customerDir, 'format-overrides-plugin.ts'), 'utf8')).toBe(
      readFileSync(join(baseTemplateDir, 'format-overrides-plugin.ts'), 'utf8'),
    );
    expect(existsSync(join(customerDir, 'src/components/FormattedBoundText.tsx'))).toBe(false);
    expect(existsSync(join(customerDir, 'src/lib/format-overrides.ts'))).toBe(false);
    expect(existsSync(join(customerDir, 'src/lib/format-overrides-store.ts'))).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      event: 'sync.file.blocked',
      file: 'src/vite-env.d.ts',
      syncGroup: 'formatOverrides',
    }));
    expect(events).toContainEqual(expect.objectContaining({
      event: 'sync.file.blocked',
      file: 'src/components/FormattedBoundText.tsx',
      syncGroup: 'formatOverrides',
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      event: 'sync.file.blocked',
      file: 'format-overrides-plugin.ts',
    }));
  });
});
