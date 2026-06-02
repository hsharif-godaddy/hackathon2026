import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
    // vitest 4 no longer clears vi.fn() call history on restoreAllMocks.
    clearMocks: true,
  },
});
