import { describe, it, expect } from 'vitest';

import { processAndGenerateViteConfig } from '../ViteConfigModifier.js';

describe('ViteConfigModifier', () => {
  describe('processViteConfigAST', () => {
    describe('with defineConfig object argument', () => {
      it('should add server.allowedHosts when server property does not exist', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: []
});
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('server');
        expect(result.code).toContain('allowedHosts');
        expect(result.code).toContain('true');
      });

      it('should add allowedHosts when server exists but allowedHosts does not', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 3000
  }
});
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('allowedHosts');
        expect(result.code).toContain('true');
        expect(result.code).toContain('port');
      });

      it('should overwrite allowedHosts when set to array', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    allowedHosts: ['localhost']
  }
});
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('allowedHosts');
        expect(result.code).not.toContain("'localhost'");
      });

      it('should not modify when allowedHosts is already true', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    allowedHosts: true
  }
});
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(false);
      });
    });

    describe('with defineConfig arrow function', () => {
      it('should handle arrow function returning object directly', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig(() => ({
  plugins: []
}));
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('server');
        expect(result.code).toContain('allowedHosts');
      });

      it('should handle arrow function with mode parameter', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  plugins: []
}));
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('server');
        expect(result.code).toContain('allowedHosts');
      });

      it('should handle arrow function with block body and return', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig(() => {
  return {
    plugins: []
  };
});
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('server');
        expect(result.code).toContain('allowedHosts');
      });
    });

    describe('with direct object export', () => {
      it('should handle direct object export without defineConfig', () => {
        const input = `
export default {
  plugins: []
};
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('server');
        expect(result.code).toContain('allowedHosts');
      });
    });

    describe('with TypeScript config', () => {
      it('should handle TypeScript vite config', () => {
        const input = `
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  }
});
`;
        const result = processAndGenerateViteConfig(input, true);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('allowedHosts');
        expect(result.code).toContain('port');
      });
    });

    describe('edge cases', () => {
      it('should return error when no config found', () => {
        const input = `
const config = { plugins: [] };
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(false);
        expect(result.error).toContain('Could not find');
      });

      it('should preserve existing server properties', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true
  }
});
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).toContain('port');
        expect(result.code).toContain('host');
        expect(result.code).toContain('strictPort');
        expect(result.code).toContain('allowedHosts');
      });

      it('should overwrite allowedHosts string value', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    allowedHosts: 'all'
  }
});
`;
        const result = processAndGenerateViteConfig(input);

        expect(result.modified).toBe(true);
        expect(result.code).not.toContain("'all'");
      });
    });
  });
});
