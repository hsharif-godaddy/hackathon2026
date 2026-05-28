import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * True when the root `package.json` `pnpm.overrides` points `@airo-ux/pattern-library`
 * (or any related `@airo/*`) at a `link:` path. In that dev setup the
 * components' peer deps (@ux/*, react) live in the linked repo's own
 * node_modules and get resolved through a symlink chain that vite's
 * default `realpath` rewriting breaks — so we flip `preserveSymlinks` to
 * keep the chain intact. For the normal catalog path this stays false
 * because `preserveSymlinks=true` breaks pnpm's `.pnpm` hoisting of
 * transitive peers (e.g. `use-isomorphic-layout-effect`, `@lexical/utils`).
 *
 * **Known trade-off on the link path:** a few unrelated suites that rely on
 * pnpm's symlink-walk to find transitive peers (useAppArchiveRestore,
 * LexicalChatEditor, useInitialization.test) will fail while the override
 * is active. Run those specific suites on the catalog path (remove the
 * override) or scope your `vitest run` to the suites you're iterating on.
 */
function hasLinkedAiroComponents(): boolean {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
      pnpm?: { overrides?: Record<string, string> };
    };
    const overrides = pkg.pnpm?.overrides ?? {};
    return Object.entries(overrides).some(
      ([name, value]) => name.startsWith('@airo/') && typeof value === 'string' && value.startsWith('link:'),
    );
  } catch {
    return false;
  }
}

const USING_LINKED_AIRO_COMPONENTS = hasLinkedAiroComponents();

const SCSS_STUB_PREFIX = '\0vitest-scss-stub:';

/**
 * Next.js expects PostCSS plugin names as strings; Vite 6 rejects that when it loads
 * postcss.config.mjs for imported `.scss`. Short-circuit SCSS to an empty module in tests.
 */
function vitestStubScss() {
  return {
    name: 'vitest-stub-scss',
    enforce: 'pre' as const,
    resolveId(id, importer) {
      if (id.startsWith(SCSS_STUB_PREFIX)) {
        return id;
      }
      const clean = id.split('?')[0];
      if (!clean.endsWith('.scss')) {
        return undefined;
      }
      const resolved = path.isAbsolute(clean)
        ? clean
        : importer
          ? path.resolve(path.dirname(importer), clean)
          : clean;
      // Virtual id must not end in `.scss` or Vite's CSS pipeline still runs PostCSS on it.
      const withoutExt = resolved.replace(/\.scss$/i, '');
      return `${SCSS_STUB_PREFIX}${withoutExt}`;
    },
    load(id) {
      if (id.startsWith(SCSS_STUB_PREFIX)) {
        return 'export default {}';
      }
    },
  };
}

/**
 * Vitest configuration
 *
 * To use:
 * 1. pnpm --filter website add -D vitest @vitest/ui @vitest/coverage-v8
 * 2. pnpm --filter website test
 * 3. pnpm --filter website test --coverage
 */

// Dynamically determine optimal fork count based on available CPU cores
// For jsdom tests, cap at 3 to avoid memory pressure (jsdom is memory-heavy)
// Use cores/2 to balance parallelism with memory overhead, minimum 1
const availableCores = os.cpus().length;
const optimalForks = Math.max(1, Math.min(3, Math.floor(availableCores / 2)));

export default defineConfig({
  plugins: [vitestStubScss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@cds/deps-esm': path.resolve(__dirname, './cds/deps-esm.js'),
      // Hard-alias react entrypoints to the consumer's copy so any linked /
      // overridden dep (e.g. `@airo-ux/pattern-library` via pnpm.overrides `link:` to
      // a sibling repo with its own node_modules) resolves every `react` /
      // `react/jsx-runtime` import to this single React instance.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
    },
    conditions: ['import', 'module', 'browser', 'default'],
    dedupe: ['react', 'react-dom'],
    // Only enabled when a dev has overridden @airo-ux/pattern-library to a local
    // link (see `hasLinkedAiroComponents` above). Never set on the catalog
    // path because it breaks pnpm's `.pnpm` hoisting of transitive peers.
    preserveSymlinks: USING_LINKED_AIRO_COMPONENTS,
  },
  test: {
    globals: true,
    // Default to lightweight node environment (35% of tests don't need jsdom)
    // Component/hook tests specify @vitest-environment jsdom at file top
    environment: 'node',
    globalSetup: ['./vitest.globalSetup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.integration.test.ts',
      'src/**/*.integration.test.tsx',
    ],
    // Use forks pool to isolate memory per test file (prevents OOM)
    pool: 'forks',
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: optimalForks, // Dynamically set based on CPU cores
        isolate: true, // Each test file runs in fresh process
      },
    },
    // Limit concurrent tests within each file
    maxConcurrency: 5,
    // Inline workspace packages so Vitest resolves subpath exports correctly.
    // @airo-ux/pattern-library is included so its (linked/overridden) dist reuses the
    // app's single React instance via vite's module graph. @ux/* is also
    // included because when @airo-ux/pattern-library resolves from a linked repo
    // (pnpm.overrides `link:`), its @ux/* peer deps live under the linked
    // repo's node_modules and must go through vite's transform to share
    // React with the consumer — otherwise Node resolves a second copy.
    server: {
      deps: {
        inline: [
          '@airo/ai-lib',
          '@airo/ai-transport',
          '@airo-ux/pattern-library',
          /^@ux\//,
        ],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.integration.test.ts',
        '**/*.integration.test.tsx',
        '**/types.ts',
        '**/index.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
      ],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50
      }
    },
    // Ensure cleanup hooks have time to complete before vitest exits
    teardownTimeout: 15000,
  }
});

