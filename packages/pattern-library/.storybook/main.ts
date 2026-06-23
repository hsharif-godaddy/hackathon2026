import { createRequire } from 'node:module';

import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-a11y', '@ux/storybook-theming', '@storybook/addon-docs'],

  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },

  staticDirs: ['./public'],

  // Pre-bundle CJS-only deps so Vite's dep optimizer applies the CJS→ESM
  // interop shim for their default/named exports. Without pre-bundling,
  // `import x from 'cjs-pkg'` fails at runtime with "does not provide an
  // export named 'default'" / "named 'useSyncExternalStore'" etc., and the
  // preview iframe hangs on a spinner with no UI to indicate the error.
  //
  // Three clusters of deps need this:
  //
  // 1. `@ux/storybook-theming`'s runtime dependencies — `@ux/themes` and
  //    `use-sync-external-store/shim` (pulled in by swr). These are our
  //    own pre-existing entries; they were the first CJS interop issue
  //    we ran into when wiring up the UXCore2 theming addon. The shim is a
  //    transitive dep with no top-level node_modules entry under pnpm, so it
  //    is made resolvable by an alias in the resolve block (see below).
  //
  // 2. `@godaddy/antares` — antares@0.1.0 ships a single root entry
  //    point (no per-component subpath exports). The root barrel pulls
  //    in CJS descendants (`cva`, `prop-types`, `@bento/*` leaves) that
  //    need the interop shim, so we pre-bundle the whole package.
  //
  // 3. `@ux/*` peer deps that are CJS-only (`type: "commonjs"` in their
  //    package.json). Any `@ux/*` package added as a peer dep whose
  //    package.json lacks `"type": "module"` MUST be listed here, or
  //    Storybook's Vite preview fails with "Failed to fetch dynamically
  //    imported module". Check with:
  //    `node -e "console.log(require('./node_modules/@ux/<pkg>/package.json').type)"`
  //    — anything that prints `undefined` or `commonjs` needs an entry.
  viteFinal: (config) => {
    // Alias @react-spring/web to a local stub (same reason as vitest.config.ts:
    // @visx/xychart's AnimatedAnnotation statically imports it, but the
    // component is never rendered in stories and the package is not installed).
    // Use import.meta.url so we get an absolute path without importing
    // node:path. @types/node is in the package's devDependencies, but
    // tsconfig.json's `types: ["vitest/globals", "@testing-library/jest-dom"]`
    // allowlist excludes Node types here — broadening it would also surface
    // Node globals in component code, which we don't want.
    const reactSpringStub = decodeURIComponent(
      new URL('../src/__stubs__/react-spring-web.ts', import.meta.url).pathname,
    );
    config.resolve ??= {};
    config.resolve.alias ??= {};
    (config.resolve.alias as Record<string, string>)['@react-spring/web'] = reactSpringStub;

    // Make pnpm-hidden transitive CJS deps resolvable + pre-bundlable.
    //
    // Several deps that the Storybook preview pulls in transitively — the
    // `@ux/storybook-theming` addon's `@ux/themes` (→ swr →
    // `use-sync-external-store/shim`) and `react-rnd`'s `re-resizable` /
    // `react-draggable` — are CJS and live under pnpm's `.pnpm/` store with NO
    // top-level `node_modules` entry. Their bare specifiers therefore do not
    // resolve from this package's root, so Vite's dep optimizer can't pre-bundle
    // them: it serves the raw CJS file instead, whose named exports don't exist
    // as ESM (e.g. `useSyncExternalStore`, `generateFetchUrl`), and the preview
    // iframe hangs on a spinner with no error. (RAC's `useSyncExternalStore`
    // import is what surfaced this when SegmentedController was added.)
    //
    // Fix: resolve each one's real directory THROUGH a parent package that *is*
    // resolvable from root, then alias the bare package name to that directory.
    // We alias the package root (not a file) because Vite matches aliases by
    // prefix — a file alias would mangle callers importing an explicit subpath
    // like `use-sync-external-store/shim/index.js`. The matching `optimizeDeps`
    // include entries (clusters 1/4/6 below) then pre-bundle them with the
    // CJS→ESM interop applied.
    const rootRequire = createRequire(import.meta.url);
    const aliasMap = config.resolve.alias as Record<string, string>;
    const aliasTransitiveDep = (pkg: string, viaParent: string): void => {
      const parentRequire = createRequire(rootRequire.resolve(viaParent));
      const entry = parentRequire.resolve(pkg).replace(/\\/g, '/');
      const marker = `/node_modules/${pkg}`;
      // Last occurrence is this package's own dir (handles nested node_modules).
      aliasMap[pkg] = entry.slice(0, entry.lastIndexOf(marker) + marker.length);
    };
    aliasTransitiveDep('use-sync-external-store', 'react-aria-components');
    aliasTransitiveDep('@ux/themes', '@godaddy/antares');
    aliasTransitiveDep('re-resizable', 'react-rnd');
    aliasTransitiveDep('react-draggable', 'react-rnd');

    config.optimizeDeps ??= {};
    // Pin the dep-optimizer's esbuild target. Vite/Storybook otherwise hands
    // esbuild the default browser-target list, whose `safari14` entry resolves
    // to Safari 14.0 — which had a destructuring bug, so esbuild refuses to
    // emit (and cannot lower) destructuring for it. Every CJS `@ux/*` dep we
    // pre-bundle below destructures at module scope, so pre-bundling fails with
    // "Transforming destructuring to the configured target environment ... is
    // not supported yet" and the preview iframe hangs. `esnext` is Vite's own
    // default optimizer target; restoring it sidesteps the bad Safari target.
    config.optimizeDeps.esbuildOptions ??= {};
    config.optimizeDeps.esbuildOptions.target = 'esnext';
    // Same Safari-14.0 destructuring bug on the production build path
    // (`storybook build`): the `vite:esbuild-transpile` plugin transpiles the
    // emitted chunks against `build.target`, whose default `safari14` entry
    // trips the identical esbuild error. Keep Vite's default browser baseline
    // but pin Safari to 14.1, the first version without the bug.
    config.build ??= {};
    config.build.target = ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14.1'];
    config.optimizeDeps.include ??= [];
    const include = config.optimizeDeps.include;
    const deps = [
      // cluster 1 — storybook-theming runtime. `@ux/themes` pulls in
      // `use-sync-external-store/shim` via swr; both are pre-bundled here and
      // made resolvable by the shim alias in the resolve block above.
      '@ux/themes',
      'use-sync-external-store/shim',
      'use-sync-external-store/shim/with-selector',
      // cluster 2 — antares root + its CJS subtree
      '@godaddy/antares',
      // cluster 3 — CJS-only @ux/* peer deps
      '@ux/box',
      '@ux/card',
      '@ux/code',
      '@ux/field-frame',
      '@ux/flyout',
      '@ux/list-item',
      '@ux/menu',
      '@ux/modal',
      '@ux/tag',
      '@ux/text',
      '@ux/text-entry',
      // cluster 4 — react-rnd (and its deps) are CJS-only
      'react-rnd',
      're-resizable',
      'react-draggable',
      // cluster 5 — lexical (PromptBox editor). `@lexical/react` ships only
      // subpath exports (no `.` specifier), so a bare `@lexical/react` entry
      // is unresolvable; list each subpath PromptBox imports instead. Add a
      // new entry here if PromptBox starts importing another `@lexical/react/*`
      // subpath.
      'lexical',
      '@lexical/react/LexicalComposer',
      '@lexical/react/LexicalComposerContext',
      '@lexical/react/LexicalContentEditable',
      '@lexical/react/LexicalErrorBoundary',
      '@lexical/react/LexicalPlainTextPlugin',
      '@lexical/react/LexicalHistoryPlugin',
      '@lexical/react/LexicalOnChangePlugin',
      'lexical-beautiful-mentions',
      // cluster 6 — react-aria-components (SegmentedController). RAC is the
      // first consumer of `use-sync-external-store/shim` (see the shim alias in
      // the resolve block above, which makes that transitive dep resolvable).
      'react-aria-components',
    ];
    for (const dep of deps) {
      if (!include.includes(dep)) include.push(dep);
    }
    return config;
  },
};

export default config;
