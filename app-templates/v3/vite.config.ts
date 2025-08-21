import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sourceMapperPlugin } from './plugins/source-mapper';
import path from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    mode === 'development' && sourceMapperPlugin(),
  ].filter(Boolean),
  
  resolve: {
    alias: {
      '@/': path.resolve(__dirname, './src/'),
      '@/components': path.resolve(__dirname, './src/frontend/components'),
      '@/lib': path.resolve(__dirname, './src/frontend/lib'),
      '@/api': path.resolve(__dirname, './src/frontend/api'),
      '@/backend': path.resolve(__dirname, './src/backend'),
      '@/shared': path.resolve(__dirname, './src/shared'),
    },
  },
  
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  
  build: {
    // Manual chunks will be configured later if needed
  },
  
  ssr: {
    noExternal: ['@tanstack/react-query'],
  },
}));
