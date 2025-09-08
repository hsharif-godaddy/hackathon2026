import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import sourceMapperPlugin from './source-mapper/src/index';
import { devToolsPlugin } from './dev-tools/src/vite-plugin';

let allowedHosts: string[] = [];
if (process.env.FRONTEND_DOMAIN) {
  allowedHosts.push(process.env.FRONTEND_DOMAIN, `http://${process.env.FRONTEND_DOMAIN}`, `https://${process.env.FRONTEND_DOMAIN}`);
}
if (process.env.ALLOWED_ORIGINS) {
  allowedHosts.push(...process.env.ALLOWED_ORIGINS.split(','));
}
if (allowedHosts.length === 0) {
  allowedHosts.push('*');
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      babel: {
        plugins: [sourceMapperPlugin],
      },
    }),
    ...(mode === 'development' ? [devToolsPlugin() as Plugin] : []),
  ],

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
    host: '0.0.0.0',
    allowedHosts,
    cors: {
      origin: allowedHosts,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'User-Agent']
    },
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PREFERRED_BACKEND_PORT || 3000}`,
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
