import { defineConfig } from 'vitest/config';
import os from 'node:os';
import path from 'node:path';

// Dynamically determine optimal fork count based on available CPU cores
// Node environment is less memory-intensive than jsdom, so we can use more forks
// Use cores minus 1 (leave headroom for OS), capped at 6, minimum 1
const availableCores = os.cpus().length;
const optimalForks = Math.max(1, Math.min(6, availableCores - 1));

export default defineConfig({
  resolve: {
    alias: {
      // Point to source to avoid loading the broken dist/experimental-websocket-server.js
      '@airo/ai-transport': path.resolve(__dirname, '../packages/ai-transport/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
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
    // Set NODE_ENV=test to enable TestHandler (suppresses stderr logging)
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.integration.test.ts', // Exclude integration tests from coverage
      ],
    },
    // Test categorization
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Exclude skill template tests - they're meant to run in generated apps, not in agents package
    exclude: ['node_modules/**', 'dist/**', '**/skills/**/templates/**/__tests__/**'],
    // Timeout configuration
    testTimeout: 30000, // 30s for long-running integration tests
    teardownTimeout: 15000, // Ensure cleanup hooks complete
  },
});
