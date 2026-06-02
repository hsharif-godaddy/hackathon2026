import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // @godaddy/antares pulls in @visx/xychart, which statically imports
      // @react-spring/web in its AnimatedAnnotation component. That component
      // is never rendered in this repo's tests, but Vite's module graph walk
      // still tries to resolve the import. Alias to a minimal inert stub so
      // the suite doesn't require the real package to be installed.
      '@react-spring/web': path.resolve('./src/__stubs__/react-spring-web.ts'),
    },
  },
  test: {
    setupFiles: ['./vitest-setup.ts'],
    environment: 'jsdom',
    globals: true,
    css: true,
    // vitest 4 no longer clears vi.fn() call history on restoreAllMocks.
    clearMocks: true,
    // `@godaddy/antares` and its `@bento/*` dependencies ship plain `.css`
    // side-effect imports alongside their JS chunks. Without inlining these
    // packages here, Vitest externalizes them and hands the `.css` specifiers
    // to Node's ESM loader, which throws `Unknown file extension ".css"`.
    // Inlining routes both packages through Vite's transform pipeline, where
    // `css: true` above absorbs the side-effect CSS as a no-op for JSDOM.
    server: {
      deps: {
        inline: [/@godaddy[\\/]antares/, /@bento[\\/]/],
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.stories.{ts,tsx}',
        '**/index.{ts,tsx}',
        'src/**/__tests__/**',
        'src/**/__stubs__/**',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
