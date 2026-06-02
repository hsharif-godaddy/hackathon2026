import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.test.ts'],
    env: { NO_COLOR: '1' },
    // vitest 4 no longer clears vi.fn() call history on restoreAllMocks.
    clearMocks: true,
  },
});
