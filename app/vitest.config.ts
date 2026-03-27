import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import os from 'node:os';

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
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    conditions: ['import', 'module', 'browser', 'default']
  },
  test: {
    globals: true,
    // Default to lightweight node environment (35% of tests don't need jsdom)
    // Component/hook tests specify @vitest-environment jsdom at file top
    environment: 'node',
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
    // Inline workspace packages so Vitest resolves subpath exports correctly
    deps: {
      inline: ['@airo/ai-lib'],
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

