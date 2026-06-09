import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'AiroSourceMapper',
      fileName: 'index'
    },
    rollupOptions: {
      external: ['vite', 'node:crypto'],
      output: {
        globals: {
          vite: 'vite'
        }
      }
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']
  }
})
