import { defineConfig } from 'tsup';

/**
 * Multi-entry JS/CSS build: one entry per public subpath declared in
 * `package.json#exports`.
 *
 * When adding a new component (e.g. `./input/new-thing`):
 *   1. Add `src/input/new-thing/index.ts` + sibling `styles.css`.
 *   2. Add the code entry to `entry` below.
 *   3. Add the CSS entry to `entry` below (tsup handles `.css` entries via
 *      esbuild's CSS loader and emits a plain `.css` file).
 *   4. Mirror both subpaths in `package.json#exports`.
 *
 * Memory note: this config emits ESM + CJS + CSS only. Declarations are
 * emitted by a separate `tsc -p tsconfig.build.json` pass invoked from
 * `npm run build:dts`. The previous tsup-driven DTS pass routed every
 * entry through `rollup-plugin-dts`, which loads the transitive type
 * graph (incl. `@godaddy/antares`, `react-aria-components`, `@ux/*`) for
 * every entry into a single Node worker — that scaled linearly with
 * entry count and OOM-killed CI's runner above 25 entries. tsc compiles
 * the program once and emits per-file declarations, so peak memory is
 * an order of magnitude lower (~550 MB vs ~3.6 GB) and the build
 * survives on standard runners without `--max-old-space-size`.
 *
 * Because the tsc pass writes additional sibling `.d.ts` files into the
 * same `dist/` tree, `clean` is `false` here; `build:clean` wipes
 * `dist/` once up front so neither pass stomps the other's output.
 *
 * `*.figma.tsx` files are deliberately NOT in the `entry` map: they are
 * Figma Code Connect mappings consumed only by the `@figma/code-connect`
 * CLI (configured in `figma.config.json`), never bundled or published.
 * They are also excluded from `tsconfig.json` / `tsconfig.build.json` and
 * ESLint, since `@figma/code-connect` is intentionally not a dependency.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'chat/agent-message/index': 'src/chat/agent-message/index.ts',
    'input/choice-list/index': 'src/input/choice-list/index.ts',
    'input/cta-button/index': 'src/input/cta-button/index.ts',
    'chat/milestone/index': 'src/chat/milestone/index.ts',
    'chat/thinker/index': 'src/chat/thinker/index.ts',
    'chat/user-message/index': 'src/chat/user-message/index.ts',
    'chat/chat-layout/index': 'src/chat/chat-layout/index.ts',
    'input/prompt-box/index': 'src/input/prompt-box/index.ts',
    'input/secrets-form/index': 'src/input/secrets-form/index.ts',
    'input/prompt-stage/index': 'src/input/prompt-stage/index.ts',
    'surfaces/panel/index': 'src/surfaces/panel/index.ts',
    'surfaces/panel-chrome/index': 'src/surfaces/panel-chrome/index.ts',
    'surfaces/floating-panel/index': 'src/surfaces/floating-panel/index.ts',
    'surfaces/floating-footer/index': 'src/surfaces/floating-footer/index.ts',
    'surfaces/fullscreen-dialog/index': 'src/surfaces/fullscreen-dialog/index.ts',
    'surfaces/builder-header/index': 'src/surfaces/builder-header/index.ts',
    'surfaces/builder-chat-footer/index': 'src/surfaces/builder-chat-footer/index.ts',
    'primitives/chiclet/index': 'src/primitives/chiclet/index.ts',
    'surfaces/canvas/index': 'src/surfaces/canvas/index.ts',
    'primitives/color-swatch/index': 'src/primitives/color-swatch/index.ts',
    'primitives/color-swatch-group/index': 'src/primitives/color-swatch-group/index.ts',
    'primitives/thinking-indicator/index': 'src/primitives/thinking-indicator/index.ts',
    'primitives/drag-handle/index': 'src/primitives/drag-handle/index.ts',
    'primitives/mention-chip/index': 'src/primitives/mention-chip/index.ts',
    '_vendor/segmented-controller/index': 'src/_vendor/segmented-controller/index.ts',
    styles: 'src/styles.css',
    'chat/agent-message/styles': 'src/chat/agent-message/styles.css',
    'input/choice-list/styles': 'src/input/choice-list/styles.css',
    'input/cta-button/styles': 'src/input/cta-button/styles.css',
    'chat/milestone/styles': 'src/chat/milestone/styles.css',
    'chat/thinker/styles': 'src/chat/thinker/styles.css',
    'chat/user-message/styles': 'src/chat/user-message/styles.css',
    'chat/chat-layout/styles': 'src/chat/chat-layout/styles.css',
    'input/prompt-box/styles': 'src/input/prompt-box/styles.css',
    'input/secrets-form/styles': 'src/input/secrets-form/styles.css',
    'input/prompt-stage/styles': 'src/input/prompt-stage/styles.css',
    'surfaces/panel/styles': 'src/surfaces/panel/styles.css',
    'surfaces/panel-chrome/styles': 'src/surfaces/panel-chrome/styles.css',
    'surfaces/floating-panel/styles': 'src/surfaces/floating-panel/styles.css',
    'surfaces/floating-footer/styles': 'src/surfaces/floating-footer/styles.css',
    'surfaces/fullscreen-dialog/styles': 'src/surfaces/fullscreen-dialog/styles.css',
    'surfaces/builder-header/styles': 'src/surfaces/builder-header/styles.css',
    'surfaces/builder-chat-footer/styles': 'src/surfaces/builder-chat-footer/styles.css',
    'primitives/chiclet/styles': 'src/primitives/chiclet/styles.css',
    'surfaces/canvas/styles': 'src/surfaces/canvas/styles.css',
    'primitives/color-swatch/styles': 'src/primitives/color-swatch/styles.css',
    'primitives/color-swatch-group/styles': 'src/primitives/color-swatch-group/styles.css',
    'primitives/thinking-indicator/styles': 'src/primitives/thinking-indicator/styles.css',
    'primitives/drag-handle/styles': 'src/primitives/drag-handle/styles.css',
    'primitives/mention-chip/styles': 'src/primitives/mention-chip/styles.css',
    '_vendor/segmented-controller/styles': 'src/_vendor/segmented-controller/styles.css',
  },
  format: ['esm', 'cjs'],
  outDir: 'dist',
  clean: false,
  sourcemap: true,
  target: 'es2020',
  external: [
    'react',
    'react-dom',
    '@godaddy/antares',
    '@ux/box',
    '@ux/button',
    '@ux/card',
    '@ux/code',
    '@ux/corner-actions',
    '@ux/disrupt',
    '@ux/field-frame',
    '@ux/flyout',
    '@ux/icon',
    '@ux/icon/async-icon.js',
    '@ux/intents',
    '@ux/list-item',
    '@ux/listbox',
    '@ux/menu',
    '@ux/modal',
    '@ux/tag',
    '@ux/text',
    '@ux/text-entry',
    '@ux/text-lockup',
    '@ux/tooltip',
    // Required by `src/_vendor/segmented-controller/`. Already a transitive
    // dep of `@godaddy/antares`; kept external here so we don't ship a
    // second copy. Drop alongside the vendor folder when antares PR #187 ships.
    'react-aria-components',
    'react-markdown',
    'rehype-sanitize',
    'remark-gfm',
    // react-rnd and its CJS transitive deps — runtime dependencies for
    // surfaces/floating-panel; kept external so they are not bundled.
    'react-rnd',
    're-resizable',
    'react-draggable',
  ],
});
