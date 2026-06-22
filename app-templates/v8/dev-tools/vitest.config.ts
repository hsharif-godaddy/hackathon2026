import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environmentMatchGlobs: [
      ['**/__tests__/**', 'jsdom'],
      ['**/utils/__tests__/**', 'jsdom'],
    ],
  },
})
