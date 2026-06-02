import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // vitest 4 no longer clears vi.fn() call history on restoreAllMocks.
    clearMocks: true,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/log-sources.ts'], // Only measure coverage for tested files
      exclude: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/types.ts',
        '**/index.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
      ],
      thresholds: {
        lines: 90,
        functions: 80,
        branches: 80,
        statements: 90
      }
    },
  }
});
