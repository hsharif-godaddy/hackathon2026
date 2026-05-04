import { describe, it, expect } from 'vitest';

import {
  processAndGenerateViteConfig,
  createPortExpression,
  isEnvPortExpression,
  extractPortFallback,
  addNodePackageExclusions,
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

      it('should not modify when allowedHosts, port, dedupe, and optimizeDeps are already set correctly', () => {
        const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    allowedHosts: true,
    port: parseInt(process.env.PORT || "5173")
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom"]
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"]
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

  describe('Resolve Dedupe', () => {
    it('should add resolve.dedupe when no resolve property exists', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: []
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('dedupe');
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
    });

    it('should add dedupe when resolve exists with only alias', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    alias: {
      "@": "/src"
    }
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('dedupe');
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
      // alias should be preserved
      expect(result.code).toContain('alias');
    });

    it('should append to existing dedupe array missing react/react-dom', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    dedupe: ["vue"]
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('"vue"');
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
    });

    it('should be a no-op when dedupe and optimizeDeps already contain all required packages', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom"]
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-router-dom"]
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(false);
    });

    it('should work with arrow function configs', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    alias: { "@": "/src" }
  }
}));
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('dedupe');
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
    });

    it('should add dedupe alongside port and allowedHosts modifications', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: 3000
  },
  resolve: {
    alias: { "@": "/src" }
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      // All three modifications should be present
      expect(result.code).toContain('parseInt(process.env.PORT');
      expect(result.code).toContain('allowedHosts');
      expect(result.code).toContain('dedupe');
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
    });

    it('should replace non-array dedupe value', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    dedupe: "react"
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
    });

    it('should skip resolve modification when resolve is not an object but still add optimizeDeps', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: getResolveConfig()
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('getResolveConfig()');
      expect(result.code).toContain('optimizeDeps');
    });

    it('should still add dedupe when server is not an object', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: serverOptions,
  resolve: {
    alias: { "@": "/src" }
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      // server should be left untouched
      expect(result.code).toContain('serverOptions');
      // dedupe should still be added
      expect(result.code).toContain('dedupe');
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
    });
  });

  describe('OptimizeDeps', () => {
    it('should append missing packages to existing optimizeDeps.include', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom"]
  },
  optimizeDeps: {
    include: ["react"]
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
      expect(result.code).toContain('"react-router-dom"');
    });

    it('should replace non-array optimizeDeps.include with full list', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom"]
  },
  optimizeDeps: {
    include: getIncludes()
  }
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('"react"');
      expect(result.code).toContain('"react-dom"');
      expect(result.code).toContain('"react-router-dom"');
    });

    it('should skip optimizeDeps modification when not an object', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    port: parseInt(process.env.PORT || "5173"),
    allowedHosts: true
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-router-dom"]
  },
  optimizeDeps: getOptimizeDepsConfig()
});
`;
      const result = processAndGenerateViteConfig(input);

      expect(result.modified).toBe(false);
      expect(result.code).toContain('getOptimizeDepsConfig()');
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

  describe('addNodePackageExclusions', () => {
    const packages = ['drizzle-orm', 'mysql2'] as const;

    it('should add optimizeDeps.exclude only, not ssr.external', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: []
});
`;
      const result = addNodePackageExclusions(input, true, packages);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('optimizeDeps');
      expect(result.code).toContain('exclude');
      expect(result.code).toContain('"drizzle-orm"');
      expect(result.code).toContain('"mysql2"');
      // ssr.external must NOT be added - would override ssr.noExternal:true
      expect(result.code).not.toContain('ssr');
      expect(result.code).not.toContain('external');
    });

    it('should merge into existing optimizeDeps.exclude', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: {
    exclude: ["some-package"]
  }
});
`;
      const result = addNodePackageExclusions(input, true, packages);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('"some-package"');
      expect(result.code).toContain('"drizzle-orm"');
      expect(result.code).toContain('"mysql2"');
    });

    it('should leave existing ssr.external untouched (not mutate it)', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  ssr: {
    external: ["other-pkg"]
  }
});
`;
      const result = addNodePackageExclusions(input, true, packages);

      expect(result.modified).toBe(true);
      // Existing ssr.external preserved as-is
      expect(result.code).toContain('"other-pkg"');
      // optimizeDeps.exclude gets the new packages
      expect(result.code).toContain('optimizeDeps');
      expect(result.code).toContain('"drizzle-orm"');
      expect(result.code).toContain('"mysql2"');
      // Packages must NOT be added to ssr.external
      expect(result.code).not.toMatch(/external:\s*\[[^\]]*"drizzle-orm"/);
      expect(result.code).not.toMatch(/external:\s*\[[^\]]*"mysql2"/);
    });

    it('should not modify when packages already present in optimizeDeps.exclude', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: {
    exclude: ["drizzle-orm", "mysql2"]
  }
});
`;
      const result = addNodePackageExclusions(input, true, packages);

      expect(result.modified).toBe(false);
    });

    it('should handle arrow function config', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  plugins: []
}));
`;
      const result = addNodePackageExclusions(input, true, packages);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('"drizzle-orm"');
    });

    it('should handle direct object export', () => {
      const input = `export default { plugins: [] };`;

      const result = addNodePackageExclusions(input, false, packages);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('"drizzle-orm"');
    });

    it('should return error when config object not found', () => {
      const input = `const x = 1;`;

      const result = addNodePackageExclusions(input, false, packages);

      expect(result.modified).toBe(false);
      expect(result.error).toContain('Could not find vite config');
    });

    it('should merge into optimizeDeps.exclude without mutating existing ssr.external', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: {
    include: ["react"],
    exclude: ["better-auth"]
  },
  ssr: {
    noExternal: ["some-ui-lib"],
    external: ["pg", "redis"]
  }
});
`;
      const result = addNodePackageExclusions(input, true, packages);

      expect(result.modified).toBe(true);
      // Existing entries preserved
      expect(result.code).toContain('"better-auth"');
      expect(result.code).toContain('"pg"');
      expect(result.code).toContain('"redis"');
      // New entries added to optimizeDeps.exclude
      expect(result.code).toContain('"drizzle-orm"');
      expect(result.code).toContain('"mysql2"');
      // Other properties untouched
      expect(result.code).toContain('include');
      expect(result.code).toContain('noExternal');
      // Packages must NOT appear in ssr.external
      expect(result.code).not.toMatch(/external:\s*\[[^\]]*"drizzle-orm"/);
      expect(result.code).not.toMatch(/external:\s*\[[^\]]*"mysql2"/);
    });

    it('should not modify when optimizeDeps.exclude is a non-array value and ssr is absent', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: {
    exclude: computeExcludes()
  }
});
`;
      const result = addNodePackageExclusions(input, true, packages);

      // optimizeDeps.exclude is a call expression - left alone. ssr.external is no longer added.
      expect(result.modified).toBe(false);
      expect(result.code).toContain('computeExcludes()');
      expect(result.code).not.toContain('ssr');
    });

    it('should handle block-body arrow function with return', () => {
      const input = `
import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => {
  return {
    plugins: []
  };
});
`;
      const result = addNodePackageExclusions(input, true, packages);

      expect(result.modified).toBe(true);
      expect(result.code).toContain('optimizeDeps');
      expect(result.code).not.toContain('ssr');
    });
  });
});
