import { describe, it, expect } from 'vitest';

import {
  processAndGenerateViteConfig,
  createPortExpression,
  isEnvPortExpression,
  extractPortFallback,
} from '../ViteConfigModifier.js';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import _generate from '@babel/generator';

const generate = _generate.default || _generate;

/**
 * Helper to parse an expression string into an AST node
 */
function parseExpr(code: string): t.Expression {
  const ast = parse(code, { sourceType: 'module' });
  const stmt = ast.program.body[0];
  if (t.isExpressionStatement(stmt)) {
    return stmt.expression;
  }
  throw new Error('Expected expression statement');
}

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

      it('should still modify port when allowedHosts is already true', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    allowedHosts: true
  }
});
`;
        const result = processAndGenerateViteConfig(input);

        // Modified because port is added even though allowedHosts was already true
        expect(result.modified).toBe(true);
        expect(result.code).toContain('parseInt(process.env.PORT');
      });

      it('should not modify when both allowedHosts and port are already set correctly', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    allowedHosts: true,
    port: parseInt(process.env.PORT || "5173")
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

  describe('Port Injection', () => {
    describe('createPortExpression', () => {
      it('should create parseInt(process.env.PORT || "8080", 10) with radix', () => {
        const expr = createPortExpression('8080');
        const code = generate(expr).code;
        expect(code).toBe('parseInt(process.env.PORT || "8080", 10)');
      });

      it('should use provided fallback port with radix', () => {
        const expr = createPortExpression('3000');
        const code = generate(expr).code;
        expect(code).toBe('parseInt(process.env.PORT || "3000", 10)');
      });

      it('should always include radix parameter 10 to prevent edge case bugs', () => {
        // Radix prevents issues with leading zeros (e.g., "08" or "09")
        const expr = createPortExpression('0800');
        const code = generate(expr).code;
        expect(code).toContain(', 10)');
      });
    });

    describe('isEnvPortExpression', () => {
      it('should return true for process.env.PORT', () => {
        const expr = parseExpr('process.env.PORT');
        expect(isEnvPortExpression(expr)).toBe(true);
      });

      it('should return true for parseInt(process.env.PORT)', () => {
        const expr = parseExpr('parseInt(process.env.PORT)');
        expect(isEnvPortExpression(expr)).toBe(true);
      });

      it('should return true for parseInt(process.env.PORT || "3000")', () => {
        const expr = parseExpr('parseInt(process.env.PORT || "3000")');
        expect(isEnvPortExpression(expr)).toBe(true);
      });

      it('should return true for Number(process.env.PORT)', () => {
        const expr = parseExpr('Number(process.env.PORT)');
        expect(isEnvPortExpression(expr)).toBe(true);
      });

      it('should return false for numeric literal', () => {
        const expr = parseExpr('8080');
        expect(isEnvPortExpression(expr)).toBe(false);
      });

      it('should return false for other variables', () => {
        const expr = parseExpr('somePort');
        expect(isEnvPortExpression(expr)).toBe(false);
      });

      it('should return false for process.env.OTHER', () => {
        const expr = parseExpr('process.env.OTHER');
        expect(isEnvPortExpression(expr)).toBe(false);
      });
    });

    describe('extractPortFallback', () => {
      it('should extract number from numeric literal', () => {
        const expr = parseExpr('8080');
        expect(extractPortFallback(expr)).toBe('8080');
      });

      it('should extract decimal port', () => {
        const expr = parseExpr('3000');
        expect(extractPortFallback(expr)).toBe('3000');
      });

      it('should return null for string literal', () => {
        // Create a string literal AST node directly
        const expr = t.stringLiteral('8080');
        expect(extractPortFallback(expr)).toBeNull();
      });

      it('should return null for expression', () => {
        const expr = parseExpr('process.env.PORT');
        expect(extractPortFallback(expr)).toBeNull();
      });
    });

    describe('modifyPort integration', () => {
      it('should add port when server exists but port does not', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: "::"
  }
});
`;
        const result = processAndGenerateViteConfig(input);
        expect(result.modified).toBe(true);
        expect(result.code).toContain('parseInt(process.env.PORT || "5173", 10)');
      });

      it('should replace hardcoded port with env expression', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 8080
  }
});
`;
        const result = processAndGenerateViteConfig(input);
        expect(result.modified).toBe(true);
        expect(result.code).toContain('parseInt(process.env.PORT || "8080", 10)');
      });

      it('should use user-provided port as fallback', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 8080
  }
});
`;
        const result = processAndGenerateViteConfig(input, false, { port: '3000' });
        expect(result.modified).toBe(true);
        expect(result.code).toContain('parseInt(process.env.PORT || "3000", 10)');
      });

      it('should skip if already using process.env.PORT', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "8080")
  }
});
`;
        const result = processAndGenerateViteConfig(input);
        // Should still be modified because allowedHosts is added
        expect(result.code).toContain('parseInt(process.env.PORT || "8080")');
        // But should not double-wrap the port
        expect(result.code).not.toContain('parseInt(parseInt');
      });

      it('should handle defineConfig with arrow function', () => {
        const input = `
export default defineConfig(({ mode }) => ({
  server: { host: "::", port: 8080 }
}));
`;
        const result = processAndGenerateViteConfig(input);
        expect(result.modified).toBe(true);
        expect(result.code).toContain('parseInt(process.env.PORT || "8080", 10)');
      });

      it('should add both port and allowedHosts when server does not exist', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: []
});
`;
        const result = processAndGenerateViteConfig(input);
        expect(result.modified).toBe(true);
        expect(result.code).toContain('parseInt(process.env.PORT || "5173", 10)');
        expect(result.code).toContain('allowedHosts');
        expect(result.code).toContain('true');
      });

      it('should preserve host and other server properties', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    strictPort: true
  }
});
`;
        const result = processAndGenerateViteConfig(input);
        expect(result.modified).toBe(true);
        expect(result.code).toContain('host');
        expect(result.code).toContain('"::"');
        expect(result.code).toContain('strictPort');
        expect(result.code).toContain('parseInt(process.env.PORT || "8080", 10)');
      });

      it('should handle Lovable-style config', () => {
        const input = `
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080, allowedHosts: true
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  }
}));
`;
        const result = processAndGenerateViteConfig(input, true);
        expect(result.modified).toBe(true);
        expect(result.code).toContain('parseInt(process.env.PORT || "8080", 10)');
        expect(result.code).toContain('host');
        expect(result.code).toContain('"::"');
      });
    });
  });
});
