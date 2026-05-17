import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - .js import of plain ESM script outside the TS rootDir
import { MIGRATIONS, runMigrations, isSsrInstalled } from '../../../../container-scripts/preview/sync-template-files.js';

const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../app-templates/v8');

type MigrationResult = 'applied' | 'skipped' | undefined | { status: 'applied' | 'skipped'; reason?: string };

interface Migration {
  id: string;
  description: string;
  run: (customerDir: string, syncedFiles: Set<string>, baseDir: string) => MigrationResult;
}

function resultStatus(r: MigrationResult): 'applied' | 'skipped' | undefined {
  if (typeof r === 'string' || r === undefined) return r;
  return r.status;
}

function findMigration(id: string): Migration {
  const m = (MIGRATIONS as Migration[]).find((x) => x.id === id);
  if (!m) throw new Error(`Migration ${id} not registered`);
  return m;
}

interface MigrationEvent {
  event: string;
  migrationId: string;
  durationMs: number;
  error?: string;
  reason?: string;
  changed?: boolean;
  vitePluginApiRoutesPreserved?: boolean;
}

function parseMigrationEvents(spy: ReturnType<typeof vi.spyOn>): MigrationEvent[] {
  return spy.mock.calls
    .map((c) => c[0])
    .filter((s): s is string => typeof s === 'string' && s.startsWith('{'))
    .map((s) => {
      try {
        return JSON.parse(s) as MigrationEvent;
      } catch {
        return null;
      }
    })
    .filter((x): x is MigrationEvent => x !== null && typeof x.event === 'string' && x.event.startsWith('migration.'));
}

const BARE_ENTRY = `import express from "express";
import healthGet from "./api/health/GET";

const app = express();
app.get("/api/health", healthGet);

export default app;
`;

const MARKED_ENTRY = `import express from "express";
// <api-imports>
import healthGet from "./api/health/GET";
// </api-imports>

const app = express();
// <api-registrations>
app.get("/api/health", healthGet);
// </api-registrations>

export default app;
`;

/**
 * Seed a customer dir into a state where isSsrInstalled() returns true.
 * Used by HTML-migration tests that require SSR to be fully installed
 * (the dependency gate is the core regression fix for Task 6).
 */
function seedInstalledSsr(dir: string) {
  mkdirSync(join(dir, 'src/server'), { recursive: true });
  writeFileSync(join(dir, 'src/entry-server.tsx'), 'export function render() {}', 'utf8');
  writeFileSync(join(dir, 'src/server/entry.ts'), MARKED_ENTRY, 'utf8');
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        scripts: { build: 'vite build && vite build --ssr src/server/entry.ts' },
        dependencies: {},
        devDependencies: {},
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  // No configure.js on disk (would fail isSsrInstalled).
}

describe('sync-template-files migrations', () => {
  let dir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-migrations-'));
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('seed-entry-server-tsx', () => {
    const migration = findMigration('seed-entry-server-tsx');

    it.skip('seeds src/entry-server.tsx from the template when absent', () => {
      const entryServerPath = join(dir, 'src/entry-server.tsx');
      expect(existsSync(entryServerPath)).toBe(false);

      const result = resultStatus(migration.run(dir, new Set(), TEMPLATE_DIR));

      expect(result).toBe('applied');
      expect(existsSync(entryServerPath)).toBe(true);
      const templateContent = readFileSync(join(TEMPLATE_DIR, 'src/entry-server.tsx'), 'utf8');
      expect(readFileSync(entryServerPath, 'utf8')).toBe(templateContent);
    });

    it.skip('skips when src/entry-server.tsx is already present', () => {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/entry-server.tsx'), 'existing content', 'utf8');

      const result = migration.run(dir, new Set(), TEMPLATE_DIR);

      expect(result).toEqual({ status: 'skipped', reason: 'entry_server_exists' });
      expect(readFileSync(join(dir, 'src/entry-server.tsx'), 'utf8')).toBe('existing content');
    });

    it.skip('emits sync.file.seeded structured event when seeding', () => {
      migration.run(dir, new Set(), TEMPLATE_DIR);

      const seededEvents = consoleLogSpy.mock.calls
        .map((c) => c[0])
        .filter((s): s is string => typeof s === 'string' && s.startsWith('{'))
        .map((s) => { try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; } })
        .filter((x): x is Record<string, unknown> => x !== null && x['event'] === 'sync.file.seeded');

      expect(seededEvents).toHaveLength(1);
      expect(seededEvents[0]).toMatchObject({
        seededFile: 'src/entry-server.tsx',
        migration: 'seed-entry-server-tsx',
      });
    });

    it.skip('skips with template_entry_server_missing when the base template lacks src/entry-server.tsx', () => {
      // Simulates a template refactor/rename scenario: the base dir exists but
      // doesn't contain src/entry-server.tsx. A raw readFileSync would abort
      // the whole sync pass via runMigrations' re-raise; we want a structured
      // skip so startup stays alive and the skip reason is greppable in Loki.
      const emptyBaseDir = mkdtempSync(join(tmpdir(), 'sync-migrations-empty-base-'));
      try {
        const result = migration.run(dir, new Set(), emptyBaseDir);
        expect(result).toEqual({ status: 'skipped', reason: 'template_entry_server_missing' });
        expect(existsSync(join(dir, 'src/entry-server.tsx'))).toBe(false);
      } finally {
        rmSync(emptyBaseDir, { recursive: true, force: true });
      }
    });

    it.skip('leaves sibling files in src/ untouched when seeding', () => {
      // Production apps nearly always have a populated src/ when they hit
      // this migration (legacy App.tsx/main.tsx stay at pre-SSR shape because
      // the ssrMigration sync group is blocked). The seed's mkdirSync uses
      // { recursive: true } which is a no-op on existing dirs, but pin the
      // no-clobber guarantee with an explicit regression test — a future
      // rewrite that used rmSync or overwrite semantics would corrupt the
      // customer app silently.
      mkdirSync(join(dir, 'src'), { recursive: true });
      const customerAppContents = 'export default function App() { return null; /* customer */ }';
      writeFileSync(join(dir, 'src/App.tsx'), customerAppContents, 'utf8');

      const result = resultStatus(migration.run(dir, new Set(), TEMPLATE_DIR));

      expect(result).toBe('applied');
      expect(existsSync(join(dir, 'src/entry-server.tsx'))).toBe(true);
      expect(readFileSync(join(dir, 'src/App.tsx'), 'utf8')).toBe(customerAppContents);
    });
  });

  describe('restore-vite-plugin-api-routes-dep', () => {
    const migration = findMigration('restore-vite-plugin-api-routes-dep');

    it('restores dep when vite.config references plugin but package.json is missing it', () => {
      writeFileSync(join(dir, 'vite.config.ts'), `import apiRoutes from "vite-plugin-api-routes";\nexport default { plugins: [apiRoutes()] };\n`, 'utf8');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: {} }, null, 2) + '\n', 'utf8');
      const result = migration.run(dir, new Set());
      expect(result).toEqual({ status: 'applied', changed: true });
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.devDependencies['vite-plugin-api-routes']).toBe('1.2.6');
    });

    it('detects dynamic import with type cast (agent-generated bypass variant)', () => {
      writeFileSync(join(dir, 'vite.config.ts'), `const mod = await import("vite-plugin-api-routes" as string);\nexport default {};\n`, 'utf8');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: {} }, null, 2) + '\n', 'utf8');
      const result = migration.run(dir, new Set());
      expect(result).toEqual({ status: 'applied', changed: true });
    });

    it('skips when no vite.config references the plugin', () => {
      writeFileSync(join(dir, 'vite.config.ts'), `import react from "@vitejs/plugin-react";\nexport default { plugins: [react()] };\n`, 'utf8');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: {} }, null, 2) + '\n', 'utf8');
      const result = migration.run(dir, new Set());
      expect(result).toEqual({ status: 'skipped', reason: 'no_vite_plugin_reference' });
    });

    it('skips when dep already present in dependencies', () => {
      writeFileSync(join(dir, 'vite.config.ts'), `import apiRoutes from "vite-plugin-api-routes";\nexport default {};\n`, 'utf8');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'vite-plugin-api-routes': '1.2.6' } }, null, 2) + '\n', 'utf8');
      const result = migration.run(dir, new Set());
      expect(result).toEqual({ status: 'skipped', reason: 'dep_already_present' });
    });

    it('skips when dep already present in devDependencies', () => {
      writeFileSync(join(dir, 'vite.config.ts'), `import apiRoutes from "vite-plugin-api-routes";\nexport default {};\n`, 'utf8');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: { 'vite-plugin-api-routes': '^1.0.0' } }, null, 2) + '\n', 'utf8');
      const result = migration.run(dir, new Set());
      expect(result).toEqual({ status: 'skipped', reason: 'dep_already_present' });
    });

    it('skips when package.json is missing', () => {
      writeFileSync(join(dir, 'vite.config.ts'), `import apiRoutes from "vite-plugin-api-routes";\nexport default {};\n`, 'utf8');
      const result = migration.run(dir, new Set());
      expect(result).toEqual({ status: 'skipped', reason: 'package_json_missing' });
    });

    it('skips with structured error when package.json is malformed', () => {
      writeFileSync(join(dir, 'vite.config.ts'), `import apiRoutes from "vite-plugin-api-routes";\nexport default {};\n`, 'utf8');
      writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8');
      const result = migration.run(dir, new Set());
      expect(result).toEqual({ status: 'skipped', reason: 'package_json_unparseable' });
    });
  });

  describe('migrate-to-ssr-entry', () => {
    const migration = findMigration('migrate-to-ssr-entry');

    function setupBareAppWith(overrides: {
      entry?: string;
      apiFiles?: Record<string, string>;
      packageJson?: Record<string, unknown>;
      configureJs?: boolean;
      entryServer?: boolean;
    } = {}) {
      mkdirSync(join(dir, 'src/server/api/health'), { recursive: true });
      writeFileSync(
        join(dir, 'src/server/entry.ts'),
        overrides.entry ?? BARE_ENTRY,
        'utf8',
      );
      writeFileSync(
        join(dir, 'src/server/api/health/GET.ts'),
        'export default () => {};',
        'utf8',
      );
      for (const [path, body] of Object.entries(overrides.apiFiles ?? {})) {
        const abs = join(dir, 'src/server/api', path);
        mkdirSync(abs.substring(0, abs.lastIndexOf('/')), { recursive: true });
        writeFileSync(abs, body, 'utf8');
      }
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          overrides.packageJson ?? {
            scripts: { build: 'vite build' },
            dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
            devDependencies: { esbuild: '^0.20.0' },
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      if (overrides.configureJs !== false) {
        writeFileSync(
          join(dir, 'src/server/configure.js'),
          'export default () => {};',
          'utf8',
        );
      }
      if (overrides.entryServer !== false) {
        writeFileSync(
          join(dir, 'src/entry-server.tsx'),
          'export function render() { return { html: "", head: "" }; }',
          'utf8',
        );
      }
    }

    it('skips entirely when src/entry-server.tsx is not on disk', () => {
      setupBareAppWith({ entryServer: false });
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'src/server/entry.ts'), 'utf8')).toBe(BARE_ENTRY);
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(true);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies['vite-plugin-api-routes']).toBe('^1.0.0');
    });

    it('rewrites bare entry.ts with marked blocks and updates package.json', () => {
      setupBareAppWith();
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'src/server/entry.ts'), 'utf8');
      expect(content).toContain('// <api-imports>');
      expect(content).toContain('// </api-imports>');
      expect(content).toContain('import health_get_0 from "./api/health/GET";');
      expect(content).toContain('app.get("/api/health", health_get_0);');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
      expect(pkg.devDependencies).not.toHaveProperty('esbuild');
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(false);
    });

    it.each(['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'])(
      'preserves vite-plugin-api-routes dep when %s still references it',
      (configName) => {
        // Guard against the AIROBUILD-1591 regression across every supported
        // config extension — a regression that narrowed VITE_CONFIG_CANDIDATES
        // would silently let the dep-delete crash the preview container.
        setupBareAppWith({ entry: MARKED_ENTRY });
        writeFileSync(
          join(dir, configName),
          `import apiRoutes from 'vite-plugin-api-routes';\nexport default { plugins: [apiRoutes()] };\n`,
          'utf8',
        );
        const result = migration.run(dir, new Set());
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
        expect(pkg.dependencies['vite-plugin-api-routes']).toBe('^1.0.0');
        // Trip surfaces to telemetry so Loki can count affected apps without
        // grepping the ⚠️ warning log line.
        expect(typeof result === 'object' && result?.extra).toEqual({ vitePluginApiRoutesPreserved: true });
      },
    );

    it('still removes dep when vite.config.ts has been cleaned of the reference', () => {
      setupBareAppWith({ entry: MARKED_ENTRY });
      writeFileSync(
        join(dir, 'vite.config.ts'),
        `import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };\n`,
        'utf8',
      );
      const result = migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
      expect(typeof result === 'object' && result?.extra).toEqual({ vitePluginApiRoutesPreserved: false });
    });

    it('preserves dep when vite.config.ts mentions the plugin in any context', () => {
      // The preservation guard uses a plain string search rather than a regex
      // to avoid false negatives that cause crash loops. A false positive
      // (comment or string literal containing the package name) is harmless —
      // the dep stays but the app boots. The SEO skill handles full cleanup.
      setupBareAppWith({ entry: MARKED_ENTRY });
      writeFileSync(
        join(dir, 'vite.config.ts'),
        `// vite-plugin-api-routes removed 2026-04-01 in favor of entry.ts\n` +
        `import react from '@vitejs/plugin-react';\n` +
        `const name = 'vite-plugin-api-routes';\n` +
        `export default { plugins: [react()] };\n`,
        'utf8',
      );
      const result = migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies).toHaveProperty('vite-plugin-api-routes');
      expect(typeof result === 'object' && result?.extra).toEqual({ vitePluginApiRoutesPreserved: true });
    });

    it('is idempotent on already-marked entry.ts', () => {
      setupBareAppWith({ entry: MARKED_ENTRY });
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'src/server/entry.ts'), 'utf8');
      const importOpens = content.match(/\/\/ <api-imports>/g) ?? [];
      const regOpens = content.match(/\/\/ <api-registrations>/g) ?? [];
      expect(importOpens).toHaveLength(1);
      expect(regOpens).toHaveLength(1);
    });

    it('zeros out marked blocks when api dir is empty to purge stale imports', () => {
      // Pre-migrated entry.ts with a stale import to a handler that no longer
      // exists. Migration must rewrite the marked blocks to match the current
      // api dir — otherwise isSsrInstalled() would certify a broken app with
      // unresolvable imports.
      setupBareAppWith({ entry: MARKED_ENTRY });
      rmSync(join(dir, 'src/server/api/health'), { recursive: true });
      mkdirSync(join(dir, 'src/server/api'), { recursive: true });
      migration.run(dir, new Set());
      const entry = readFileSync(join(dir, 'src/server/entry.ts'), 'utf8');
      expect(entry).toContain('// <api-imports>\n\n// </api-imports>');
      expect(entry).toContain('// <api-registrations>\n\n// </api-registrations>');
      expect(entry).not.toContain('import healthGet');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(false);
    });

    it("returns 'skipped' when package.json is absent (core deliverable can't run)", () => {
      // The primary work plan — dep cleanup, SSR build-script normalisation,
      // configure.js/bundle.js unlink — all require package.json. Step 1
      // (entry.ts rewrite) is idempotent and can still land, but the
      // migration hasn't achieved its SSR-install goal, so emit the
      // .skipped event so operators don't read it as success.
      setupBareAppWith();
      rmSync(join(dir, 'package.json'));
      expect(resultStatus(migration.run(dir, new Set()))).toBe('skipped');
    });

    it('strips scripts.bundle when it matches the legacy "node bundle.js" pattern', () => {
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'vite build', bundle: 'node bundle.js' },
          dependencies: {},
          devDependencies: {},
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts).not.toHaveProperty('bundle');
    });

    it('preserves scripts.bundle when it does not reference node bundle.js', () => {
      // Consistency with the adjacent build:vite value guard — don't
      // silently destroy a customer-repurposed script key.
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'vite build', bundle: 'webpack --config webpack.prod.js' },
          dependencies: {},
          devDependencies: {},
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.bundle).toBe('webpack --config webpack.prod.js');
    });

    it('preserves scripts.bundle when value is a node script under a bundle path', () => {
      // Pins the regex anchoring. An un-anchored `\bnode\b.*\bbundle\b`
      // pattern would false-positive-match `node src/bundle/index.js`
      // because `/` counts as a word boundary for `\b`, and silently
      // delete a customer build step.
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'vite build', bundle: 'node src/bundle/index.js' },
          dependencies: {},
          devDependencies: {},
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.bundle).toBe('node src/bundle/index.js');
    });

    it('strips scripts.bundle when value is "node dist/bundle.js"', () => {
      // The other legacy form the migration should remove — asserts the
      // anchored regex still handles the real pipelines we shipped.
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'vite build', bundle: 'node dist/bundle.js' },
          dependencies: {},
          devDependencies: {},
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts).not.toHaveProperty('bundle');
    });

    it('lands --ssr even when src/App.tsx uses a legacy module-top-level createBrowserRouter', () => {
      // Pins the design decision: there is no App.tsx SSR-safety gate on
      // the --ssr build-script rewrite. A legacy App.tsx will crashloop the
      // publish container, and the develop agent is expected to rewrite it
      // when that happens. Gating here would leave stripe-skilled apps
      // (CartProvider etc.) on CSR indefinitely with no forcing function.
      setupBareAppWith();
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'src/App.tsx'),
        "import { createBrowserRouter, RouterProvider } from 'react-router-dom';\nconst router = createBrowserRouter([]);\nexport default function App(){ return <RouterProvider router={router} />; }",
        'utf8',
      );

      migration.run(dir, new Set());

      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
    });

    it('returns skipped when src/server/entry.ts is missing', () => {
      setupBareAppWith();
      rmSync(join(dir, 'src/server/entry.ts'));
      expect(resultStatus(migration.run(dir, new Set()))).toBe('skipped');
    });

    it('returns skipped when src/server/api dir is missing', () => {
      setupBareAppWith();
      rmSync(join(dir, 'src/server/api'), { recursive: true });
      expect(resultStatus(migration.run(dir, new Set()))).toBe('skipped');
    });

    it('leaves everything alone when entry.ts has unexpected shape', () => {
      setupBareAppWith({ entry: 'import express from "express";\nconst app = express();\n' });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies['vite-plugin-api-routes']).toBe('^1.0.0');
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(true);
    });

    it('propagates a JSON parse error from package.json through runMigrations and leaves configure.js in place', () => {
      // New transactional contract: unexpected errors (JSON parse failures
      // mid-rewrite) propagate. Step 3 is gated by buildHasSsr so configure.js
      // stays put when step 2 throws before setting it.
      setupBareAppWith();
      writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8');

      expect(() => runMigrations(TEMPLATE_DIR, dir, new Set())).toThrow();

      // migration.*.failed goes to stderr so transport-level log splitters
      // route it to the error stream alongside the raw stack.
      const events = parseMigrationEvents(consoleErrorSpy);
      const failed = events.find((e) => e.event === 'migration.migrate-to-ssr-entry.failed');
      expect(failed).toBeDefined();
      expect(failed!.migrationId).toBe('migrate-to-ssr-entry');
      expect(typeof failed!.durationMs).toBe('number');
      expect(typeof failed!.error).toBe('string');

      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(true);
    });

    it('propagates JSON parse error when called directly on the migration', () => {
      setupBareAppWith();
      writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8');
      expect(() => migration.run(dir, new Set())).toThrow();
    });

    it('normalises legacy "&& node bundle.js" build scripts to SSR build and removes bundle.js on disk', () => {
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'vite build && node bundle.js' },
          dependencies: {},
          devDependencies: {},
        },
      });
      writeFileSync(join(dir, 'bundle.js'), '// legacy', 'utf8');
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
      expect(existsSync(join(dir, 'bundle.js'))).toBe(false);
    });

    it('removes redundant scripts.bundle and scripts["build:vite"] when folded into scripts.build', () => {
      setupBareAppWith({
        packageJson: {
          scripts: {
            build: 'vite build',
            bundle: 'node bundle.js',
            'build:vite': 'vite build',
          },
          dependencies: {},
          devDependencies: {},
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
      expect(pkg.scripts).not.toHaveProperty('bundle');
      expect(pkg.scripts).not.toHaveProperty('build:vite');
    });

    it('preserves scripts["build:vite"] when it does not mirror scripts.build', () => {
      // Only delete build:vite when it was a trivial alias for the legacy
      // build script. A divergent value is customer logic.
      setupBareAppWith({
        packageJson: {
          scripts: {
            build: 'vite build',
            'build:vite': 'vite build --mode staging',
          },
          dependencies: {},
          devDependencies: {},
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts['build:vite']).toBe('vite build --mode staging');
    });

    it('leaves bundle.js on disk when scripts.build is customised (buildHasSsr is false)', () => {
      // Parallel to the configure.js behaviour: if we can't safely produce an
      // SSR bundle, don't delete legacy build artefacts.
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'custom-tool && node bundle.js' },
          dependencies: {},
          devDependencies: {},
        },
      });
      writeFileSync(join(dir, 'bundle.js'), '// legacy', 'utf8');
      migration.run(dir, new Set());
      expect(existsSync(join(dir, 'bundle.js'))).toBe(true);
    });

    it('preserves customised build scripts and keeps configure.js to avoid breaking the build', () => {
      // If the build script is customised and doesn't normalise to the SSR
      // form, deleting configure.js would leave the legacy pipeline pointing
      // at a missing file. App must stay runnable.
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'custom-tool --flag && node src/server/configure.js' },
          dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
          devDependencies: { esbuild: '^0.20.0' },
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBe('custom-tool --flag && node src/server/configure.js');
      // Deps still cleaned (idempotent, no risk to build).
      expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
      expect(pkg.devDependencies).not.toHaveProperty('esbuild');
      // But configure.js must remain since the build still references it.
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(true);
    });

    it('preserves configure.js when vite-plugin-api-routes is still referenced', () => {
      setupBareAppWith({ entry: MARKED_ENTRY });
      writeFileSync(
        join(dir, 'vite.config.ts'),
        `import apiRoutes from 'vite-plugin-api-routes';\nexport default { plugins: [apiRoutes()] };\n`,
        'utf8',
      );
      migration.run(dir, new Set());
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(true);
    });

    it('customised-build app: migrate applies, then HTML migrations skip because isSsrInstalled=false', () => {
      // Task 7: on a customized-build app, migrate-to-ssr-entry finishes as
      // 'applied' (the safe writes ran — dep cleanup, marker injection), but
      // isSsrInstalled() is false because configure.js is still on disk and
      // build script has no --ssr. So the downstream HTML migrations must
      // skip, not inject dead markers.
      setupBareAppWith({
        packageJson: {
          scripts: { build: 'custom-tool --flag && node src/server/configure.js' },
          dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
          devDependencies: { esbuild: '^0.20.0' },
        },
      });
      writeFileSync(
        join(dir, 'index.html'),
        '<html><head><title>T</title></head><body><div id="app"></div></body></html>',
        'utf8',
      );

      runMigrations(TEMPLATE_DIR, dir, new Set());

      const events = parseMigrationEvents(consoleLogSpy);
      const byId = Object.fromEntries(events.map((e) => [e.migrationId, e.event]));
      expect(byId['migrate-to-ssr-entry']).toBe('migration.migrate-to-ssr-entry.applied');
      expect(byId['inject-ssr-markers']).toBe('migration.inject-ssr-markers.skipped');
      expect(byId['strip-stale-index-title']).toBe('migration.strip-stale-index-title.skipped');

      // Index.html untouched — no dead markers.
      const html = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(html).not.toContain('<!--app-head-->');
      expect(html).not.toContain('<!--app-html-->');
    });

    it('does not write or unlink when the app is already fully migrated', () => {
      // Task 7: on an already-migrated app, migrate-to-ssr-entry should be a
      // pure no-op in terms of filesystem side effects. Use an entry whose
      // content exactly matches what the migration would regenerate from the
      // api dir; combined with a converged package.json + absent configure.js,
      // every step short-circuits without writing.
      mkdirSync(join(dir, 'src/server/api/health'), { recursive: true });
      writeFileSync(
        join(dir, 'src/server/api/health/GET.ts'),
        'export default () => {};',
        'utf8',
      );
      writeFileSync(join(dir, 'src/entry-server.tsx'), 'export function render() {}', 'utf8');
      const convergedEntry = `import express from "express";
// <api-imports>
import health_get_0 from "./api/health/GET";
// </api-imports>

const app = express();
// <api-registrations>
app.get("/api/health", health_get_0);
// </api-registrations>

export default app;
`;
      writeFileSync(join(dir, 'src/server/entry.ts'), convergedEntry, 'utf8');
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          {
            scripts: { build: 'vite build && vite build --ssr src/server/entry.ts' },
            dependencies: {},
            devDependencies: {},
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );

      // Pre-flight sanity: the seeded state is already fully installed.
      expect(isSsrInstalled(dir)).toBe(true);

      // ESM bindings can't be spied; snapshot contents instead. mtime is flaky
      // across filesystems, and byte-identical rewrites aren't correctness bugs.
      const entryPath = join(dir, 'src/server/entry.ts');
      const pkgPath = join(dir, 'package.json');
      const entryBefore = readFileSync(entryPath, 'utf8');
      const pkgBefore = readFileSync(pkgPath, 'utf8');

      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');

      expect(readFileSync(entryPath, 'utf8')).toBe(entryBefore);
      expect(readFileSync(pkgPath, 'utf8')).toBe(pkgBefore);
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(false);
    });

    it('returns skipped when bare entry.ts has an empty api dir', () => {
      // Rewriting bare → marked with no routes would drop the health import
      // and leave entry.ts unrunnable. Must leave entry.ts untouched.
      setupBareAppWith();
      rmSync(join(dir, 'src/server/api/health'), { recursive: true });
      mkdirSync(join(dir, 'src/server/api'), { recursive: true });
      const entryBefore = readFileSync(join(dir, 'src/server/entry.ts'), 'utf8');

      expect(resultStatus(migration.run(dir, new Set()))).toBe('skipped');
      expect(readFileSync(join(dir, 'src/server/entry.ts'), 'utf8')).toBe(entryBefore);
    });

    it('recovers from a partial-crash where step 1 landed but step 2 did not', () => {
      // Simulate the exact partial-crash state: marked entry.ts, old
      // package.json still has vite-plugin-api-routes and no --ssr build,
      // configure.js still present. Re-running should converge to E1.
      setupBareAppWith({
        entry: MARKED_ENTRY,
        packageJson: {
          scripts: { build: 'vite build' },
          dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
          devDependencies: { esbuild: '^0.20.0' },
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.dependencies).not.toHaveProperty('vite-plugin-api-routes');
      expect(pkg.devDependencies).not.toHaveProperty('esbuild');
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(false);
    });

    it('treats an already-SSR build script as a converged state', () => {
      setupBareAppWith({
        entry: MARKED_ENTRY,
        packageJson: {
          scripts: { build: 'vite build && vite build --ssr src/server/entry.ts' },
          dependencies: {},
          devDependencies: {},
        },
      });
      migration.run(dir, new Set());
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(false);
    });

    it('runMigrations full run on a partial state (marked entry + legacy build) converges to fully-migrated', () => {
      // Task 8: partial state with markers already on entry.ts but build script
      // still the legacy vite build. Full runMigrations converges and
      // isSsrInstalled() returns true afterwards.
      setupBareAppWith({
        entry: MARKED_ENTRY,
        packageJson: {
          scripts: { build: 'vite build' },
          dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
          devDependencies: { esbuild: '^0.20.0' },
        },
      });

      expect(() => runMigrations(TEMPLATE_DIR, dir, new Set())).not.toThrow();

      expect(isSsrInstalled(dir)).toBe(true);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      expect(pkg.scripts.build).toBe('vite build && vite build --ssr src/server/entry.ts');
      expect(existsSync(join(dir, 'src/server/configure.js'))).toBe(false);
    });
  });

  describe('ensure-helmet-provider', () => {
    const migration = findMigration('ensure-helmet-provider');

    function writeMain(content: string) {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/main.tsx'), content, 'utf8');
    }

    function writeAppEntry(content: string) {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/app-entry.tsx'), content, 'utf8');
    }

    it('skips when src/main.tsx is missing', () => {
      const result = migration.run(dir, new Set());
      expect(resultStatus(result)).toBe('skipped');
      expect(typeof result === 'object' && result?.reason).toBe('main_tsx_missing');
    });

    it('wraps a createRoot(...).render(<App/>) tree and adds the import', () => {
      writeMain(
        `import { createRoot } from 'react-dom/client';\n` +
        `import App from './App';\n` +
        `createRoot(document.getElementById('app')!).render(<App />);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      expect(out).toContain('@dr.pogodin/react-helmet');
      expect(out).toContain('HelmetProvider');
      expect(out).toMatch(/<HelmetProvider>[\s\S]*<App[\s\S]*<\/HelmetProvider>/);
    });

    it('wraps a hydrateRoot(el, <App/>) tree', () => {
      writeMain(
        `import { hydrateRoot } from 'react-dom/client';\n` +
        `import App from './App';\n` +
        `hydrateRoot(document.getElementById('app')!, <App />);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      expect(out).toMatch(/hydrateRoot\([^,]+,\s*<HelmetProvider>/);
    });

    it('wraps a tree bound to a const before the render call', () => {
      writeMain(
        `import { hydrateRoot, createRoot } from 'react-dom/client';\n` +
        `import App from './App';\n` +
        `const tree = <App />;\n` +
        `const el = document.getElementById('app')!;\n` +
        `if (el.hasChildNodes()) hydrateRoot(el, tree);\n` +
        `else createRoot(el).render(tree);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      expect(out).toMatch(/const tree = <HelmetProvider>[\s\S]*<\/HelmetProvider>/);
      // Shared declarator must be wrapped exactly once even though two
      // separate render calls reference it.
      expect(out.match(/<HelmetProvider>/g)?.length).toBe(1);
    });

    it('wraps both render calls when hydrateRoot/createRoot use separate inline JSX branches', () => {
      // Customer pattern: inline JSX in each branch rather than a shared
      // `const tree`. Stopping after the first wrap would leave the other
      // branch rendering unwrapped at runtime (`<Helmet>` crash persists).
      writeMain(
        `import { hydrateRoot, createRoot } from 'react-dom/client';\n` +
        `import App from './App';\n` +
        `const el = document.getElementById('app')!;\n` +
        `if (el.hasChildNodes()) hydrateRoot(el, <App />);\n` +
        `else createRoot(el).render(<App />);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      expect(out.match(/<HelmetProvider>/g)?.length).toBe(2);
      expect(out).toMatch(/hydrateRoot\([^,]+,\s*<HelmetProvider>/);
      expect(out).toMatch(/createRoot\([^)]+\)\.render\(<HelmetProvider>/);
    });

    it('returns applied with changed=false when HelmetProvider already wraps the tree', () => {
      writeMain(
        `import { createRoot } from 'react-dom/client';\n` +
        `import { HelmetProvider } from '@dr.pogodin/react-helmet';\n` +
        `import App from './App';\n` +
        `createRoot(document.getElementById('app')!).render(<HelmetProvider><App /></HelmetProvider>);\n`
      );
      const before = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      const result = migration.run(dir, new Set());
      expect(resultStatus(result)).toBe('applied');
      expect(typeof result === 'object' && result?.changed).toBe(false);
      expect(readFileSync(join(dir, 'src/main.tsx'), 'utf8')).toBe(before);
    });

    it('augments an existing @dr.pogodin/react-helmet import with HelmetProvider specifier', () => {
      writeMain(
        `import { createRoot } from 'react-dom/client';\n` +
        `import { Helmet } from '@dr.pogodin/react-helmet';\n` +
        `import App from './App';\n` +
        `createRoot(document.getElementById('app')!).render(<App />);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      // A single import line with both specifiers, not a duplicate import.
      const importLines = out.split('\n').filter((l) => l.includes('@dr.pogodin/react-helmet'));
      expect(importLines.length).toBe(1);
      expect(importLines[0]).toContain('Helmet');
      expect(importLines[0]).toContain('HelmetProvider');
    });

    it('recurses into app-entry.tsx when main.tsx is a stub wrapper', () => {
      writeMain(`import './app-entry';\n`);
      writeAppEntry(
        `import { createRoot } from 'react-dom/client';\n` +
        `import App from './App';\n` +
        `createRoot(document.getElementById('app')!).render(<App />);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      // main.tsx unchanged
      expect(readFileSync(join(dir, 'src/main.tsx'), 'utf8')).toBe(`import './app-entry';\n`);
      // app-entry.tsx wrapped
      expect(readFileSync(join(dir, 'src/app-entry.tsx'), 'utf8')).toContain('HelmetProvider');
    });

    it('skips when render tree cannot be located', () => {
      writeMain(
        `import { createRoot } from 'react-dom/client';\n` +
        `// render call commented out\n` +
        `// createRoot(document.getElementById('app')!).render(<App />);\n`
      );
      const result = migration.run(dir, new Set());
      expect(resultStatus(result)).toBe('skipped');
      expect(typeof result === 'object' && result?.reason).toBe('render_tree_not_found');
    });

    it('skips on parse failure and surfaces the babel error on the skipped event', () => {
      writeMain(`import x from ;;;broken(\n`);
      const result = migration.run(dir, new Set());
      expect(resultStatus(result)).toBe('skipped');
      expect(typeof result === 'object' && result?.reason).toBe('parse_failed');
      // Parse error detail surfaces via `extra` so Loki shows the underlying
      // babel SyntaxError (line/col) instead of an opaque parse_failed count.
      const extra = typeof result === 'object' ? (result as { extra?: Record<string, unknown> }).extra : undefined;
      expect(extra?.parseError).toEqual(expect.stringMatching(/./));
    });

    it('honors an aliased HelmetProvider import when emitting JSX', () => {
      // Aliased import: local binding is HP, not HelmetProvider. Emitting a
      // hardcoded <HelmetProvider> tag would reference an unbound identifier
      // and also defeat the idempotency check (which anchors on local name).
      writeMain(
        `import { createRoot } from 'react-dom/client';\n` +
        `import { HelmetProvider as HP } from '@dr.pogodin/react-helmet';\n` +
        `import App from './App';\n` +
        `createRoot(document.getElementById('app')!).render(<App />);\n`
      );
      const first = migration.run(dir, new Set());
      expect(resultStatus(first)).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      expect(out).toContain('<HP>');
      expect(out).toContain('</HP>');
      expect(out).not.toContain('<HelmetProvider>');

      // Idempotent: the JSX-presence scan must recognize the aliased local name.
      const second = migration.run(dir, new Set());
      expect(resultStatus(second)).toBe('applied');
      expect(typeof second === 'object' && second?.changed).toBe(false);
    });

    it('adds a sibling named import when the only HELMET_PKG import is a namespace import', () => {
      // ESM disallows mixing ImportNamespaceSpecifier with named specifiers in
      // a single declaration; mutating the existing import would produce
      // invalid syntax. A separate `import { HelmetProvider } from ...` decl
      // is the only legal shape.
      writeMain(
        `import { createRoot } from 'react-dom/client';\n` +
        `import * as Helmet from '@dr.pogodin/react-helmet';\n` +
        `import App from './App';\n` +
        `createRoot(document.getElementById('app')!).render(<App />);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      expect(out).toContain(`import * as Helmet from`);
      const named = out.match(/import\s*\{[^}]*HelmetProvider[^}]*\}\s*from\s*['"]@dr\.pogodin\/react-helmet['"]/);
      expect(named, 'expected a separate named-specifier import for HelmetProvider').toBeTruthy();
    });

    it('wraps even when a foreign-package HelmetProvider (e.g. react-helmet-async) already wraps', () => {
      // react-helmet-async's provider doesn't satisfy @dr.pogodin/react-helmet's
      // <Helmet> (independent heaps). Detection must be anchored to HELMET_PKG
      // so we still wrap with ours.
      writeMain(
        `import { createRoot } from 'react-dom/client';\n` +
        `import { HelmetProvider } from 'react-helmet-async';\n` +
        `import App from './App';\n` +
        `createRoot(document.getElementById('app')!).render(<HelmetProvider><App /></HelmetProvider>);\n`
      );
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const out = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
      expect(out).toContain(`from 'react-helmet-async'`);
      expect(out).toContain(`from "@dr.pogodin/react-helmet"`);
    });
  });

  describe('inject-ssr-markers', () => {
    const migration = findMigration('inject-ssr-markers');

    function writeHtml(content: string) {
      writeFileSync(join(dir, 'index.html'), content, 'utf8');
    }

    it('skips injection when src/entry-server.tsx is absent (SSR not installed)', () => {
      const html = '<html><head></head><body><div id="app"></div></body></html>';
      writeHtml(html);
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('skips injection when entry-server.tsx is present but SSR is not fully installed (configure.js still on disk)', () => {
      // Task 6 regression test: core dependency-gate bug. Previously the
      // migration only checked for entry-server.tsx, so a half-migrated app
      // (customized build, configure.js still there) would get dead markers.
      mkdirSync(join(dir, 'src/server'), { recursive: true });
      writeFileSync(join(dir, 'src/entry-server.tsx'), 'export function render() {}', 'utf8');
      writeFileSync(join(dir, 'src/server/configure.js'), '// legacy', 'utf8');
      const html = '<html><head></head><body><div id="app"></div></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set()));

      expect(status).toBe('skipped');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('is a no-op when index.html was synced from the template', () => {
      seedInstalledSsr(dir);
      writeHtml('<html><head></head><body><div id="app"></div></body></html>');
      migration.run(dir, new Set(['index.html']));
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(
        '<html><head></head><body><div id="app"></div></body></html>',
      );
    });

    it('is a no-op when both markers are already present', () => {
      seedInstalledSsr(dir);
      const html =
        '<html><head><!--app-head--></head><body><div id="app"><!--app-html--></div></body></html>';
      writeHtml(html);
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('injects both markers into a bare customer index.html', () => {
      seedInstalledSsr(dir);
      writeHtml(
        '<html><head><title>X</title></head><body><div id="app"></div></body></html>',
      );
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(content).toContain('<title>X</title><!--app-head--></head>');
      expect(content).toContain('<div id="app"><!--app-html--></div>');
    });

    it('preserves pre-existing attributes on <div id="app">', () => {
      seedInstalledSsr(dir);
      writeHtml(
        '<html><head></head><body><div id="app" class="root"></div></body></html>',
      );
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(content).toContain('<div id="app" class="root"><!--app-html--></div>');
    });

    it('injects only the missing marker when one already exists', () => {
      seedInstalledSsr(dir);
      writeHtml(
        '<html><head><!--app-head--></head><body><div id="app"></div></body></html>',
      );
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'index.html'), 'utf8');
      expect((content.match(/<!--app-head-->/g) ?? []).length).toBe(1);
      expect(content).toContain('<div id="app"><!--app-html--></div>');
    });

    it('skips injection when the empty app div is missing (ambiguous)', () => {
      seedInstalledSsr(dir);
      const html =
        '<html><head></head><body><div id="app"><h1>customer content</h1></div></body></html>';
      writeHtml(html);
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('skips injection when </head> is missing', () => {
      seedInstalledSsr(dir);
      const html = '<html><body><div id="app"></div></body></html>';
      writeHtml(html);
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('is a no-op when index.html does not exist', () => {
      expect(() => migration.run(dir, new Set())).not.toThrow();
    });
  });

  describe('normalize-vite-html-entry', () => {
    const migration = findMigration('normalize-vite-html-entry');

    function writeHtml(content: string) {
      writeFileSync(join(dir, 'index.html'), content, 'utf8');
    }

    it('restores the static Vite entry when the known retry wrapper is present', () => {
      writeHtml(`<html>
  <head>
    <!--app-head-->
  </head>
  <body>
    <div id="app"><!--app-html--></div>
    <script type="module">
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
    </script>
  </body>
</html>`);

      const status = resultStatus(migration.run(dir, new Set()));
      const content = readFileSync(join(dir, 'index.html'), 'utf8');

      expect(status).toBe('applied');
      expect(content).toContain('<script type="module" src="/src/main.tsx"></script>');
      expect(content).not.toContain('let mainLoaded = false');
      expect(content).not.toContain('/src/styles/globals.css');
    });

    it('injects the globals.css fallback when custom boot code has no known retry wrapper', () => {
      mkdirSync(join(dir, 'src/styles'), { recursive: true });
      writeFileSync(join(dir, 'src/styles/globals.css'), '@tailwind utilities;\n', 'utf8');
      writeHtml(
        '<html><head><!--app-head--></head><body><div id="app"></div><script type="module">import("/custom-entry.tsx")</script></body></html>',
      );

      const status = resultStatus(migration.run(dir, new Set()));
      const content = readFileSync(join(dir, 'index.html'), 'utf8');

      expect(status).toBe('applied');
      expect(content).toContain('<link rel="stylesheet" href="/src/styles/globals.css" />\n    <!--app-head-->');
      expect(content).toContain('import("/custom-entry.tsx")');
    });

    it('preserves customer code added around the old retry wrapper and uses the CSS fallback', () => {
      mkdirSync(join(dir, 'src/styles'), { recursive: true });
      writeFileSync(join(dir, 'src/styles/globals.css'), '@tailwind utilities;\n', 'utf8');
      writeHtml(`<html>
  <head><!--app-head--></head>
  <body>
    <script type="module">
      window.__customBoot = true
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
    </script>
  </body>
</html>`);

      const status = resultStatus(migration.run(dir, new Set()));
      const content = readFileSync(join(dir, 'index.html'), 'utf8');

      expect(status).toBe('applied');
      expect(content).toContain('window.__customBoot = true');
      expect(content).toContain('let mainLoaded = false');
      expect(content).toContain('<link rel="stylesheet" href="/src/styles/globals.css" />');
      expect(content).not.toContain('<script type="module" src="/src/main.tsx"></script>');
    });

    it('injects the globals.css fallback before </head> when SSR markers are absent', () => {
      mkdirSync(join(dir, 'src/styles'), { recursive: true });
      writeFileSync(join(dir, 'src/styles/globals.css'), '@tailwind utilities;\n', 'utf8');
      writeHtml(
        '<html><head><title>Custom</title></head><body><script type="module">import("/custom-entry.tsx")</script></body></html>',
      );

      const status = resultStatus(migration.run(dir, new Set()));
      const content = readFileSync(join(dir, 'index.html'), 'utf8');

      expect(status).toBe('applied');
      expect(content).toContain(
        '<title>Custom</title><link rel="stylesheet" href="/src/styles/globals.css" />\n</head>',
      );
    });

    it('does not duplicate an existing globals.css fallback link', () => {
      mkdirSync(join(dir, 'src/styles'), { recursive: true });
      writeFileSync(join(dir, 'src/styles/globals.css'), '@tailwind utilities;\n', 'utf8');
      const html =
        '<html><head><link rel="stylesheet" href="/src/styles/globals.css" /><!--app-head--></head><body><script type="module">import("/custom-entry.tsx")</script></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set()));

      expect(status).toBe('applied');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('skips the CSS fallback when no module boot script is present', () => {
      mkdirSync(join(dir, 'src/styles'), { recursive: true });
      writeFileSync(join(dir, 'src/styles/globals.css'), '@tailwind utilities;\n', 'utf8');
      const html = '<html><head><!--app-head--></head><body><div id="app"></div></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set()));

      expect(status).toBe('skipped');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('skips the CSS fallback when no head insertion point is present', () => {
      mkdirSync(join(dir, 'src/styles'), { recursive: true });
      writeFileSync(join(dir, 'src/styles/globals.css'), '@tailwind utilities;\n', 'utf8');
      const html = '<html><body><script type="module">import("/custom-entry.tsx")</script></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set()));

      expect(status).toBe('skipped');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('skips when the fallback is needed but globals.css is absent', () => {
      const html =
        '<html><head><!--app-head--></head><body><script type="module">import("/custom-entry.tsx")</script></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set()));

      expect(status).toBe('skipped');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('is idempotent after injecting the globals.css fallback', () => {
      mkdirSync(join(dir, 'src/styles'), { recursive: true });
      writeFileSync(join(dir, 'src/styles/globals.css'), '@tailwind utilities;\n', 'utf8');
      writeHtml(
        '<html><head><!--app-head--></head><body><script type="module">import("/custom-entry.tsx")</script></body></html>',
      );

      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');
      const afterFirstRun = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(resultStatus(migration.run(dir, new Set()))).toBe('applied');

      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(afterFirstRun);
      expect((afterFirstRun.match(/\/src\/styles\/globals\.css/g) ?? []).length).toBe(1);
    });

    it('is a no-op when the static Vite entry is already present', () => {
      const html =
        '<html><head><!--app-head--></head><body><script type="module" src="/src/main.tsx"></script></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set()));

      expect(status).toBe('applied');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('is a no-op when index.html was synced from the template', () => {
      const html =
        '<html><head><!--app-head--></head><body><script type="module">import("/custom-entry.tsx")</script></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set(['index.html'])));

      expect(status).toBe('skipped');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });
  });

  describe('strip-stale-index-title', () => {
    const migration = findMigration('strip-stale-index-title');

    function writeHtml(content: string) {
      writeFileSync(join(dir, 'index.html'), content, 'utf8');
    }

    it('is a no-op when index.html does not exist', () => {
      expect(() => migration.run(dir, new Set())).not.toThrow();
    });

    it('skips when src/entry-server.tsx is absent (SSR not installed)', () => {
      const html = '<html><head><title>Stale</title><!--app-head--></head><body></body></html>';
      writeHtml(html);
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('skips when entry-server.tsx is present but SSR is not fully installed (configure.js still on disk)', () => {
      // Task 6 regression test for strip-stale-index-title: dependency gate
      // against half-migrated state.
      mkdirSync(join(dir, 'src/server'), { recursive: true });
      writeFileSync(join(dir, 'src/entry-server.tsx'), 'export function render() {}', 'utf8');
      writeFileSync(join(dir, 'src/server/configure.js'), '// legacy', 'utf8');
      const html = '<html><head><title>Stale</title><!--app-head--></head><body></body></html>';
      writeHtml(html);

      const status = resultStatus(migration.run(dir, new Set()));

      expect(status).toBe('skipped');
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('skips when <!--app-head--> marker is absent (pre-SSR app)', () => {
      seedInstalledSsr(dir);
      const html = '<html><head><title>Stale</title></head><body></body></html>';
      writeHtml(html);
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('strips a stale <title> when SSR foundation and marker are present', () => {
      seedInstalledSsr(dir);
      writeHtml(
        '<html><head>\n  <title>Maison Élite</title>\n  <!--app-head--></head><body></body></html>',
      );
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(content).not.toContain('<title>');
      expect(content).toContain('<!--app-head-->');
    });

    it('is a no-op when no <title> is present', () => {
      seedInstalledSsr(dir);
      const html = '<html><head><!--app-head--></head><body></body></html>';
      writeHtml(html);
      migration.run(dir, new Set());
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(html);
    });

    it('strips only the first <title> block (title tags cannot legitimately repeat in head)', () => {
      // Pins the non-global regex: we intentionally only strip the first match.
      // A duplicate-title state is already pathological; we don't want to cascade
      // into mass deletion on a malformed file.
      seedInstalledSsr(dir);
      writeHtml(
        '<html><head><title>One</title><title>Two</title><!--app-head--></head><body></body></html>',
      );
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(content).toContain('<title>Two</title>');
      expect(content).not.toContain('<title>One</title>');
    });

    it('handles <title> with attributes', () => {
      seedInstalledSsr(dir);
      writeHtml(
        '<html><head><title data-foo="bar">Stale</title><!--app-head--></head><body></body></html>',
      );
      migration.run(dir, new Set());
      const content = readFileSync(join(dir, 'index.html'), 'utf8');
      expect(content).not.toMatch(/<title[^>]*>/i);
    });
  });

  describe('runMigrations', () => {
    // Induces a real JSON parse failure in migrate-to-ssr-entry by seeding a
    // malformed package.json alongside a bare entry.ts. ESM bindings aren't
    // configurable so we can't spy on writeFileSync; a real parse error on
    // real disk is the cleanest way to trigger the re-raise path.
    function seedMigrateToSsrEntryFailure(): Set<string> {
      mkdirSync(join(dir, 'src/server/api/health'), { recursive: true });
      writeFileSync(join(dir, 'src/server/entry.ts'), BARE_ENTRY, 'utf8');
      writeFileSync(
        join(dir, 'src/server/api/health/GET.ts'),
        'export default () => {};',
        'utf8',
      );
      writeFileSync(join(dir, 'src/entry-server.tsx'), 'export function render() {}', 'utf8');
      writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8');
      return new Set();
    }

    it('re-throws when a migration fails and logs a migration.<id>.failed event on stderr', () => {
      const syncedFiles = seedMigrateToSsrEntryFailure();
      expect(() => runMigrations(TEMPLATE_DIR, dir, syncedFiles)).toThrow();

      // migration.*.failed is emitted via console.error so transport-level
      // log splitters (Loki / Docker --log-driver) route it to the error
      // stream. The success-path events (.applied / .skipped) still go to
      // console.log.
      const events = parseMigrationEvents(consoleErrorSpy);
      const failed = events.find((e) => e.event.endsWith('.failed'));
      expect(failed).toBeDefined();
      expect(failed!.migrationId).toBe('migrate-to-ssr-entry');
      expect(failed!.event).toBe('migration.migrate-to-ssr-entry.failed');
      expect(typeof failed!.durationMs).toBe('number');
      expect(typeof failed!.error).toBe('string');
      expect(failed!.error!.length).toBeGreaterThan(0);
    });

    it('does not run later migrations after a mid-run migration throws', () => {
      const syncedFiles = seedMigrateToSsrEntryFailure();
      // index.html would be rewritten by inject-ssr-markers / strip-stale-index-title
      // if they ran. Seeding both a stale <title> and no head marker gives each
      // later migration something observable to NOT do.
      writeFileSync(
        join(dir, 'index.html'),
        '<html><head><title>Stale</title></head><body><div id="app"></div></body></html>',
        'utf8',
      );
      const htmlBefore = readFileSync(join(dir, 'index.html'), 'utf8');

      expect(() => runMigrations(TEMPLATE_DIR, dir, syncedFiles)).toThrow();

      const events = parseMigrationEvents(consoleLogSpy);
      const laterIds = ['inject-ssr-markers', 'strip-stale-index-title'];
      for (const id of laterIds) {
        const match = events.find((e) => e.migrationId === id);
        expect(match, `migration ${id} should not have emitted an event`).toBeUndefined();
      }
      // index.html untouched proves later migrations didn't run.
      expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(htmlBefore);
    });

    it('emits migration.<id>.applied with durationMs on success', () => {
      // Already-fully-migrated app: migrate-to-ssr-entry runs as a no-op
      // and returns 'applied' (target state reached).
      seedInstalledSsr(dir);
      mkdirSync(join(dir, 'src/server/api/health'), { recursive: true });
      writeFileSync(
        join(dir, 'src/server/api/health/GET.ts'),
        'export default () => {};',
        'utf8',
      );

      runMigrations(TEMPLATE_DIR, dir, new Set());

      const events = parseMigrationEvents(consoleLogSpy);
      const applied = events.find((e) => e.event === 'migration.migrate-to-ssr-entry.applied');
      expect(applied).toBeDefined();
      expect(applied!.migrationId).toBe('migrate-to-ssr-entry');
      expect(typeof applied!.durationMs).toBe('number');
      expect(applied!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('emits migration.<id>.skipped with durationMs and reason when precondition unmet', () => {
      // Empty dir: remove-public-assets-gitignore skips (no .gitignore file).
      runMigrations(TEMPLATE_DIR, dir, new Set());

      const events = parseMigrationEvents(consoleLogSpy);
      const skipped = events.find((e) => e.event === 'migration.remove-public-assets-gitignore.skipped');
      expect(skipped).toBeDefined();
      expect(skipped!.migrationId).toBe('remove-public-assets-gitignore');
      expect(typeof skipped!.durationMs).toBe('number');
      // reason is the primary telemetry deliverable of this event. Without
      // this assertion, a regression like renaming `result.reason` in the
      // runner would pass all other tests while silently dropping the field.
      expect(skipped!.reason).toBe('gitignore_missing');
    });

    it('surfaces changed=true on applied events that wrote bytes', () => {
      // remove-public-assets-gitignore + a gitignore containing the legacy
      // entry: migration mutates the file → changed=true.
      writeFileSync(join(dir, '.gitignore'), 'node_modules\n# Public Assets\npublic/assets\n', 'utf8');

      runMigrations(TEMPLATE_DIR, dir, new Set());

      const events = parseMigrationEvents(consoleLogSpy);
      const applied = events.find((e) => e.event === 'migration.remove-public-assets-gitignore.applied');
      expect(applied).toBeDefined();
      expect(applied!.changed).toBe(true);
    });

    it('surfaces changed=false on applied events that were converged no-ops', () => {
      // gitignore without the legacy entry: migration returns applied with no write.
      writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\n', 'utf8');

      runMigrations(TEMPLATE_DIR, dir, new Set());

      const events = parseMigrationEvents(consoleLogSpy);
      const applied = events.find((e) => e.event === 'migration.remove-public-assets-gitignore.applied');
      expect(applied).toBeDefined();
      expect(applied!.changed).toBe(false);
    });

    it('protects canonical event/migrationId/durationMs from being overwritten by extra', () => {
      // A future migration could accidentally return extra keys that collide
      // with the canonical fields; runner must keep its own fields authoritative
      // so Loki dashboards keyed on event name don't lose rows.
      const original = (MIGRATIONS as unknown as Array<{ id: string; description: string; run: unknown }>).find((m) => m.id === 'remove-public-assets-gitignore');
      const save = original!.run;
      (original as unknown as { run: () => unknown }).run = () => ({
        status: 'applied',
        changed: true,
        extra: { event: 'hijacked', migrationId: 'other', durationMs: -1, custom: 'ok' },
      });
      try {
        runMigrations(TEMPLATE_DIR, dir, new Set());
      } finally {
        (original as unknown as { run: unknown }).run = save;
      }
      const events = parseMigrationEvents(consoleLogSpy);
      const applied = events.find((e) => e.migrationId === 'remove-public-assets-gitignore');
      expect(applied?.event).toBe('migration.remove-public-assets-gitignore.applied');
      expect(applied?.durationMs).toBeGreaterThanOrEqual(0);
      expect((applied as unknown as { custom?: string }).custom).toBe('ok');
    });

    it('merges extra telemetry fields onto applied events', () => {
      // migrate-to-ssr-entry emits vitePluginApiRoutesPreserved via its extra bag.
      mkdirSync(join(dir, 'src/server/api/health'), { recursive: true });
      writeFileSync(join(dir, 'src/server/entry.ts'), MARKED_ENTRY, 'utf8');
      writeFileSync(join(dir, 'src/server/api/health/GET.ts'), 'export default () => {};', 'utf8');
      writeFileSync(join(dir, 'src/entry-server.tsx'), 'export function render() {}', 'utf8');
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        scripts: { build: 'vite build && vite build --ssr src/server/entry.ts' },
        dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
      }, null, 2) + '\n', 'utf8');
      writeFileSync(join(dir, 'vite.config.ts'),
        `import apiRoutes from 'vite-plugin-api-routes';\nexport default { plugins: [apiRoutes()] };\n`, 'utf8');

      runMigrations(TEMPLATE_DIR, dir, new Set());

      const events = parseMigrationEvents(consoleLogSpy);
      const applied = events.find((e) => e.event === 'migration.migrate-to-ssr-entry.applied');
      expect(applied?.vitePluginApiRoutesPreserved).toBe(true);
    });

    it('omits changed on skipped events', () => {
      runMigrations(TEMPLATE_DIR, dir, new Set());
      const events = parseMigrationEvents(consoleLogSpy);
      for (const e of events) {
        if (e.event.endsWith('.skipped')) {
          expect(e.changed, `skipped events must not carry changed (${e.migrationId})`).toBeUndefined();
        }
      }
    });

    it('omits reason on applied events and preserves it across all skip paths', () => {
      // One parameterized sweep covers every skip path's reason at once so
      // the next time a migration is added, the contributor only has to
      // extend this table rather than add a new test per migration.
      const skipCases: Array<{ migrationId: string; reason: string }> = [
        { migrationId: 'remove-public-assets-gitignore', reason: 'gitignore_missing' },
        // seed-entry-server-tsx is unconditionally disabled to prevent configure.js
        // deletion on apps whose ssrMigration sync group is blocked (see seeding_disabled).
        { migrationId: 'seed-entry-server-tsx', reason: 'seeding_disabled' },
        { migrationId: 'ensure-helmet-provider', reason: 'main_tsx_missing' },
        { migrationId: 'restore-vite-plugin-api-routes-dep', reason: 'no_vite_plugin_reference' },
        { migrationId: 'migrate-to-ssr-entry', reason: 'entry_server_missing' },
        { migrationId: 'normalize-vite-html-entry', reason: 'index_html_missing' },
        { migrationId: 'inject-ssr-markers', reason: 'index_html_missing' },
        { migrationId: 'strip-stale-index-title', reason: 'index_html_missing' },
      ];

      runMigrations(TEMPLATE_DIR, dir, new Set());
      const events = parseMigrationEvents(consoleLogSpy);

      for (const { migrationId, reason } of skipCases) {
        const event = events.find((e) => e.event === `migration.${migrationId}.skipped`);
        expect(event, `expected skipped event for ${migrationId}`).toBeDefined();
        expect(event!.reason, `expected reason on ${migrationId} skip`).toBe(reason);
      }

      // Sanity: an applied event elsewhere (e.g. in other tests) must not
      // carry reason. Here the empty dir produces only skips, so check the
      // shape of one event directly: reason only appears on skipped status.
      for (const e of events) {
        if (e.event.endsWith('.applied')) {
          expect(e.reason, `applied events must not carry reason (${e.migrationId})`).toBeUndefined();
        }
      }
    });
  });

  describe('isSsrInstalled', () => {
    it('returns true when all conditions are met', () => {
      seedInstalledSsr(dir);
      expect(isSsrInstalled(dir)).toBe(true);
    });

    it('returns false when src/entry-server.tsx is missing', () => {
      seedInstalledSsr(dir);
      rmSync(join(dir, 'src/entry-server.tsx'));
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('returns false when src/server/entry.ts is missing', () => {
      seedInstalledSsr(dir);
      rmSync(join(dir, 'src/server/entry.ts'));
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('returns false when src/server/configure.js is still present', () => {
      seedInstalledSsr(dir);
      writeFileSync(join(dir, 'src/server/configure.js'), '// legacy', 'utf8');
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('returns false when entry.ts lacks <api-imports> markers', () => {
      seedInstalledSsr(dir);
      writeFileSync(
        join(dir, 'src/server/entry.ts'),
        'import express from "express";\nconst app = express();\n// <api-registrations>\n// </api-registrations>\nexport default app;\n',
        'utf8',
      );
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('returns false when entry.ts lacks <api-registrations> markers', () => {
      seedInstalledSsr(dir);
      writeFileSync(
        join(dir, 'src/server/entry.ts'),
        'import express from "express";\n// <api-imports>\n// </api-imports>\nconst app = express();\nexport default app;\n',
        'utf8',
      );
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it("returns false when package.json scripts.build doesn't include --ssr", () => {
      seedInstalledSsr(dir);
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          { scripts: { build: 'vite build' }, dependencies: {}, devDependencies: {} },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('returns true when vite-plugin-api-routes is intentionally preserved', () => {
      seedInstalledSsr(dir);
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          {
            scripts: { build: 'vite build && vite build --ssr src/server/entry.ts' },
            dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
            devDependencies: {},
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      expect(isSsrInstalled(dir)).toBe(true);
    });

    it('returns false when preserved dep is present but --ssr is missing from build', () => {
      seedInstalledSsr(dir);
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
          {
            scripts: { build: 'vite build' },
            dependencies: { 'vite-plugin-api-routes': '^1.0.0' },
            devDependencies: {},
          },
          null,
          2,
        ) + '\n',
        'utf8',
      );
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('returns false on malformed package.json without throwing', () => {
      seedInstalledSsr(dir);
      writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8');
      expect(() => isSsrInstalled(dir)).not.toThrow();
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('returns false when package.json is absent without throwing', () => {
      seedInstalledSsr(dir);
      rmSync(join(dir, 'package.json'));
      expect(() => isSsrInstalled(dir)).not.toThrow();
      expect(isSsrInstalled(dir)).toBe(false);
    });

    it('does not log a read-error event on ENOENT (legitimate "not installed" signal)', () => {
      // ENOENT on package.json is a valid "not installed" state, not a
      // permission/corruption problem. Logging would spam Loki for every
      // half-migrated app on every HTML-migration check.
      seedInstalledSsr(dir);
      rmSync(join(dir, 'package.json'));

      isSsrInstalled(dir);

      const readError = consoleErrorSpy.mock.calls
        .map((c) => c[0])
        .find(
          (s) => typeof s === 'string' && s.includes('isSsrInstalled.read-error'),
        );
      expect(readError).toBeUndefined();
    });

    it('emits isSsrInstalled.read-error on stderr on JSON parse failure (unexpected state)', () => {
      // Distinguishes corrupt-package.json from absent-package.json: the
      // former is unexpected and the root cause should surface at error
      // level (not warn) so Loki alert rules keyed on level=error fire.
      seedInstalledSsr(dir);
      writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8');

      expect(isSsrInstalled(dir)).toBe(false);

      const readError = consoleErrorSpy.mock.calls
        .map((c) => c[0])
        .filter((s): s is string => typeof s === 'string' && s.startsWith('{'))
        .map((s) => {
          try { return JSON.parse(s); } catch { return null; }
        })
        .find((e) => e && e.event === 'isSsrInstalled.read-error');
      expect(readError).toBeDefined();
      expect(typeof readError.error).toBe('string');
    });
  });

});
