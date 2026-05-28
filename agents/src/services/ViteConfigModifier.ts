/**
 * ViteConfigModifier
 *
 * Modifies vite.config files to ensure server.allowedHosts is set to true.
 * This is necessary for uploaded apps to work properly with our proxy setup.
 */

import { parse } from '@babel/parser';
import _traverse, { NodePath } from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import { Logger } from '../logging/index.js';
import type { WorkspaceTasks } from '../workspace/tasks.js';

/** Vite config file names to check for */
export const VITE_CONFIG_FILES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs'] as const;

// Handle ES module default exports
const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

const logger = Logger.create({ component: 'vite-config-modifier' });

export interface ViteConfigModifyResult {
  success: boolean;
  modified: boolean;
  configFile?: string;
  error?: string;
}

/**
 * Find which vite config file exists in the container
 */
async function findViteConfigFile(
  tasks: WorkspaceTasks,
  containerPath: string
): Promise<string | null> {
  for (const configFile of VITE_CONFIG_FILES) {
    const checkResult = await tasks.runCommandSync({
      command: `test -f "${containerPath}/${configFile}" && echo "found" || echo "notfound"`,
      timeoutSeconds: 5,
    });
    if (checkResult.stdout?.trim() === 'found') {
      return configFile;
    }
  }
  return null;
}

/**
 * Read file content from container
 */
async function readFileFromContainer(
  tasks: WorkspaceTasks,
  containerPath: string,
  fileName: string
): Promise<string | null> {
  const result = await tasks.runCommandSync({
    command: `cat "${containerPath}/${fileName}"`,
    timeoutSeconds: 10,
  });

  if (result.exitCode !== 0 || !result.stdout) {
    return null;
  }

  return result.stdout;
}

/**
 * Write file content to container
 */
async function writeFileToContainer(
  tasks: WorkspaceTasks,
  containerPath: string,
  fileName: string,
  content: string
): Promise<boolean> {
  // Escape content for shell - use base64 to avoid escaping issues
  const base64Content = Buffer.from(content).toString('base64');

  const result = await tasks.runCommandSync({
    command: `echo "${base64Content}" | base64 -d > "${containerPath}/${fileName}"`,
    timeoutSeconds: 10,
  });

  return result.exitCode === 0;
}

// =====================================================
// AST Helper Functions (exported for testing)
// =====================================================

/**
 * Check if an object property has a specific key
 */
export function hasPropertyKey(prop: t.ObjectProperty | t.ObjectMethod | t.SpreadElement, key: string): boolean {
  if (t.isSpreadElement(prop)) return false;
  if (t.isObjectMethod(prop)) {
    return t.isIdentifier(prop.key) && prop.key.name === key;
  }
  return (t.isIdentifier(prop.key) && prop.key.name === key) ||
         (t.isStringLiteral(prop.key) && prop.key.value === key);
}

/**
 * Find a property in an object expression by key name
 */
export function findProperty(
  properties: (t.ObjectProperty | t.ObjectMethod | t.SpreadElement)[],
  key: string
): t.ObjectProperty | null {
  for (const prop of properties) {
    if (t.isObjectProperty(prop) && hasPropertyKey(prop, key)) {
      return prop;
    }
  }
  return null;
}

/**
 * Create an object property with allowedHosts: true
 */
export function createAllowedHostsProperty(): t.ObjectProperty {
  return t.objectProperty(
    t.identifier('allowedHosts'),
    t.booleanLiteral(true)
  );
}

/**
 * Create a server property with allowedHosts: true and port using env var
 */
export function createServerProperty(options?: ViteConfigModifyOptions): t.ObjectProperty {
  const fallbackPort = options?.port || DEFAULT_VITE_PORT;
  return t.objectProperty(
    t.identifier('server'),
    t.objectExpression([
      createPortProperty(fallbackPort),
      createAllowedHostsProperty(),
    ])
  );
}

/**
 * Check if allowedHosts is already set to true (boolean literal)
 */
export function isAllowedHostsTrue(value: t.Expression | t.PatternLike): boolean {
  return t.isBooleanLiteral(value) && value.value === true;
}

// =====================================================
// Port Injection Helpers
// =====================================================

/** Default Vite port if none specified */
const DEFAULT_VITE_PORT = '5173';

/**
 * Create: parseInt(process.env.PORT || 'fallback', 10)
 */
export function createPortExpression(fallbackPort: string): t.CallExpression {
  return t.callExpression(
    t.identifier('parseInt'),
    [
      t.logicalExpression(
        '||',
        t.memberExpression(
          t.memberExpression(
            t.identifier('process'),
            t.identifier('env')
          ),
          t.identifier('PORT')
        ),
        t.stringLiteral(fallbackPort)
      ),
      t.numericLiteral(10)
    ]
  );
}

/**
 * Create an object property with port: parseInt(process.env.PORT || 'fallback')
 */
export function createPortProperty(fallbackPort: string): t.ObjectProperty {
  return t.objectProperty(
    t.identifier('port'),
    createPortExpression(fallbackPort)
  );
}

/**
 * Check if an expression already uses process.env.PORT
 * Detects patterns like:
 * - process.env.PORT
 * - parseInt(process.env.PORT)
 * - parseInt(process.env.PORT || '...')
 * - Number(process.env.PORT)
 */
export function isEnvPortExpression(node: t.Expression | t.PatternLike): boolean {
  // Direct: process.env.PORT
  if (t.isMemberExpression(node)) {
    return isProcessEnvPort(node);
  }

  // Wrapped: parseInt(...) or Number(...)
  if (t.isCallExpression(node)) {
    const callee = node.callee;
    if (t.isIdentifier(callee) && (callee.name === 'parseInt' || callee.name === 'Number')) {
      const arg = node.arguments[0];
      if (!arg) return false;

      // parseInt(process.env.PORT)
      if (t.isMemberExpression(arg) && isProcessEnvPort(arg)) {
        return true;
      }

      // parseInt(process.env.PORT || '...')
      if (t.isLogicalExpression(arg) && arg.operator === '||') {
        if (t.isMemberExpression(arg.left) && isProcessEnvPort(arg.left)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Check if a MemberExpression is process.env.PORT
 */
function isProcessEnvPort(node: t.MemberExpression): boolean {
  // Check for process.env.PORT
  if (!t.isIdentifier(node.property) || node.property.name !== 'PORT') {
    return false;
  }

  // Check for process.env
  if (!t.isMemberExpression(node.object)) {
    return false;
  }

  const envObj = node.object;
  return (
    t.isIdentifier(envObj.object) && envObj.object.name === 'process' &&
    t.isIdentifier(envObj.property) && envObj.property.name === 'env'
  );
}

/**
 * Extract fallback port value from existing port config
 * Returns the string representation of a numeric literal, or null if not extractable
 */
export function extractPortFallback(node: t.Expression | t.PatternLike): string | null {
  if (t.isNumericLiteral(node)) {
    return String(node.value);
  }
  return null;
}

/**
 * Options for modifying vite config
 */
export interface ViteConfigModifyOptions {
  /** User-provided fallback port */
  port?: string;
}

/**
 * Modify server.port to use process.env.PORT
 * Returns true if modifications were made
 */
function modifyPort(serverObj: t.ObjectExpression, userPort?: string): boolean {
  const portProp = findProperty(serverObj.properties, 'port');

  if (!portProp) {
    // No port - add with default fallback
    const fallback = userPort || DEFAULT_VITE_PORT;
    serverObj.properties.push(createPortProperty(fallback));
    return true;
  }

  // Port exists - check if already using env var
  if (isEnvPortExpression(portProp.value)) {
    // Already uses process.env.PORT - skip
    return false;
  }

  // Determine fallback: user-provided > existing > default
  const existingFallback = extractPortFallback(portProp.value);
  const fallback = userPort || existingFallback || DEFAULT_VITE_PORT;

  // Replace with env-aware expression
  portProp.value = createPortExpression(fallback);
  return true;
}

/**
 * Modify server.allowedHosts to be true
 * Returns true if modifications were made
 */
function modifyAllowedHosts(serverObj: t.ObjectExpression): boolean {
  const allowedHostsProp = findProperty(serverObj.properties, 'allowedHosts');

  if (!allowedHostsProp) {
    // allowedHosts doesn't exist - add it
    serverObj.properties.push(createAllowedHostsProperty());
    return true;
  }

  // allowedHosts exists - check if it's already true
  if (isAllowedHostsTrue(allowedHostsProp.value)) {
    return false;
  }

  // Overwrite to true
  allowedHostsProp.value = t.booleanLiteral(true);
  return true;
}

// =====================================================
// Resolve Dedupe Helpers
// =====================================================

/** Packages that must be deduplicated to avoid dual-instance crashes */
const DEDUPE_PACKAGES = ['react', 'react-dom', 'react-router-dom'] as const;

/** Packages to pre-bundle in dev mode to prevent dual-instance issues in lazy chunks */
const OPTIMIZE_DEPS_PACKAGES = ['react', 'react-dom', 'react-router-dom'] as const;

/**
 * Create: dedupe: ["react", "react-dom"]
 */
export function createDedupeProperty(): t.ObjectProperty {
  return t.objectProperty(
    t.identifier('dedupe'),
    t.arrayExpression(DEDUPE_PACKAGES.map((pkg) => t.stringLiteral(pkg)))
  );
}

/**
 * Ensure resolve.dedupe includes react and react-dom.
 * Creates the dedupe array if missing, appends missing entries if partial.
 * Returns true if modifications were made.
 */
function modifyDedupe(resolveObj: t.ObjectExpression): boolean {
  const dedupeProp = findProperty(resolveObj.properties, 'dedupe');

  if (!dedupeProp) {
    resolveObj.properties.push(createDedupeProperty());
    return true;
  }

  if (!t.isArrayExpression(dedupeProp.value)) {
    // dedupe is not an array — replace it
    dedupeProp.value = t.arrayExpression(DEDUPE_PACKAGES.map((pkg) => t.stringLiteral(pkg)));
    return true;
  }

  const arr = dedupeProp.value;
  const existing = new Set(
    arr.elements
      .filter((el): el is t.StringLiteral => t.isStringLiteral(el))
      .map((el) => el.value)
  );

  let modified = false;
  for (const pkg of DEDUPE_PACKAGES) {
    if (!existing.has(pkg)) {
      arr.elements.push(t.stringLiteral(pkg));
      modified = true;
    }
  }
  return modified;
}

/**
 * Ensure the top-level resolve property exists and contains dedupe.
 * Returns true if modifications were made.
 */
function modifyResolve(configObj: t.ObjectExpression): boolean {
  const resolveProp = findProperty(configObj.properties, 'resolve');

  if (!resolveProp) {
    // No resolve property — add one with dedupe
    configObj.properties.push(
      t.objectProperty(
        t.identifier('resolve'),
        t.objectExpression([createDedupeProperty()])
      )
    );
    return true;
  }

  if (!t.isObjectExpression(resolveProp.value)) {
    logger.warn('vite-config.resolve-not-object', {
      valueType: resolveProp.value.type,
    });
    return false;
  }

  return modifyDedupe(resolveProp.value);
}

// =====================================================
// OptimizeDeps Helpers
// =====================================================

/**
 * Create: include: ["react", "react-dom", "react-router-dom"]
 */
function createOptimizeDepsIncludeProperty(): t.ObjectProperty {
  return t.objectProperty(
    t.identifier('include'),
    t.arrayExpression(OPTIMIZE_DEPS_PACKAGES.map((pkg) => t.stringLiteral(pkg)))
  );
}

/**
 * Ensure optimizeDeps.include contains required packages.
 * Creates the include array if missing, appends missing entries if partial.
 * Returns true if modifications were made.
 */
function modifyOptimizeDepsInclude(optimizeDepsObj: t.ObjectExpression): boolean {
  const includeProp = findProperty(optimizeDepsObj.properties, 'include');

  if (!includeProp) {
    optimizeDepsObj.properties.push(createOptimizeDepsIncludeProperty());
    return true;
  }

  if (!t.isArrayExpression(includeProp.value)) {
    includeProp.value = t.arrayExpression(OPTIMIZE_DEPS_PACKAGES.map((pkg) => t.stringLiteral(pkg)));
    return true;
  }

  const arr = includeProp.value;
  const existing = new Set(
    arr.elements
      .filter((el): el is t.StringLiteral => t.isStringLiteral(el))
      .map((el) => el.value)
  );

  let modified = false;
  for (const pkg of OPTIMIZE_DEPS_PACKAGES) {
    if (!existing.has(pkg)) {
      arr.elements.push(t.stringLiteral(pkg));
      modified = true;
    }
  }
  return modified;
}

/**
 * Ensure the top-level optimizeDeps property exists and contains include.
 * Returns true if modifications were made.
 */
function modifyOptimizeDeps(configObj: t.ObjectExpression): boolean {
  const optimizeDepsProp = findProperty(configObj.properties, 'optimizeDeps');

  if (!optimizeDepsProp) {
    configObj.properties.push(
      t.objectProperty(
        t.identifier('optimizeDeps'),
        t.objectExpression([createOptimizeDepsIncludeProperty()])
      )
    );
    return true;
  }

  if (!t.isObjectExpression(optimizeDepsProp.value)) {
    logger.warn('vite-config.optimizeDeps-not-object', {
      valueType: optimizeDepsProp.value.type,
    });
    return false;
  }

  return modifyOptimizeDepsInclude(optimizeDepsProp.value);
}

/**
 * Modify an object expression to ensure:
 * - server.port uses process.env.PORT
 * - server.allowedHosts is true
 * - resolve.dedupe includes react, react-dom, and react-router-dom
 * - optimizeDeps.include includes react, react-dom, and react-router-dom
 *
 * Returns true if any modifications were made (either to server, resolve, or optimizeDeps),
 * and false if no changes were needed. Note that server-specific modifications
 * may be skipped when server is not an object literal (e.g., a variable or
 * function call), while other modifications (like resolve.dedupe) can still apply.
 */
export function modifyConfigObject(
  objExpr: t.ObjectExpression,
  options?: ViteConfigModifyOptions
): boolean {
  const serverProp = findProperty(objExpr.properties, 'server');
  let modified = false;

  if (!serverProp) {
    // No server property - add it with port and allowedHosts
    objExpr.properties.push(createServerProperty(options));
    modified = true;
  } else if (!t.isObjectExpression(serverProp.value)) {
    // Server value is not an object expression (might be a variable or function call)
    // We can't safely modify it, so log a warning and skip
    logger.warn('vite-config.server-not-object', {
      valueType: serverProp.value.type,
    });
  } else {
    const serverObj = serverProp.value;

    // Handle port
    modified = modifyPort(serverObj, options?.port) || modified;

    // Handle allowedHosts
    modified = modifyAllowedHosts(serverObj) || modified;
  }

  // Handle resolve.dedupe
  modified = modifyResolve(objExpr) || modified;

  // Handle optimizeDeps.include
  modified = modifyOptimizeDeps(objExpr) || modified;

  return modified;
}

/**
 * Process the AST to find and modify the vite config
 * Handles both direct object export and defineConfig wrapper
 */
export function processViteConfigAST(
  ast: t.File,
  options?: ViteConfigModifyOptions
): { modified: boolean; error?: string } {
  let modified = false;
  let foundConfig = false;

  traverse(ast, {
    // Handle: export default { ... }
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const declaration = path.node.declaration;

      // Direct object expression: export default { server: ... }
      if (t.isObjectExpression(declaration)) {
        foundConfig = true;
        modified = modifyConfigObject(declaration, options);
        return;
      }

      // Function call: export default defineConfig({ ... }) or defineConfig(() => ({ ... }))
      if (t.isCallExpression(declaration)) {
        const callee = declaration.callee;

        // Check if it's defineConfig call
        if (t.isIdentifier(callee) && callee.name === 'defineConfig') {
          const arg = declaration.arguments[0];

          // defineConfig({ ... })
          if (t.isObjectExpression(arg)) {
            foundConfig = true;
            modified = modifyConfigObject(arg, options);
            return;
          }

          // defineConfig(() => ({ ... })) or defineConfig(({ mode }) => ({ ... }))
          if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
            const body = arg.body;

            // Arrow function with parenthesized object: () => ({ ... })
            if (t.isObjectExpression(body)) {
              foundConfig = true;
              modified = modifyConfigObject(body, options);
              return;
            }

            // Arrow/function with block body: () => { return { ... } }
            if (t.isBlockStatement(body)) {
              // Find the return statement
              for (const stmt of body.body) {
                if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
                  foundConfig = true;
                  modified = modifyConfigObject(stmt.argument, options);
                  return;
                }
              }
            }
          }
        }
      }
    },
  });

  if (!foundConfig) {
    return {
      modified: false,
      error: 'Could not find vite config object to modify',
    };
  }

  return { modified };
}

// =====================================================
// Node Package Exclusion Helpers
// =====================================================

/**
 * Ensure a string-array property on an object contains the given entries.
 * Creates the property if missing, appends missing entries if partial.
 * Returns true if modifications were made.
 */
export function ensureArrayPropertyContains(
  objExpr: t.ObjectExpression,
  propertyName: string,
  packages: readonly string[]
): boolean {
  const prop = findProperty(objExpr.properties, propertyName);

  if (!prop) {
    objExpr.properties.push(
      t.objectProperty(
        t.identifier(propertyName),
        t.arrayExpression(packages.map((pkg) => t.stringLiteral(pkg)))
      )
    );
    return true;
  }

  if (!t.isArrayExpression(prop.value)) {
    logger.warn(`vite-config.${propertyName}-not-array`, {
      valueType: prop.value.type,
    });
    return false;
  }

  const existing = new Set(
    prop.value.elements
      .filter((el): el is t.StringLiteral => t.isStringLiteral(el))
      .map((el) => el.value)
  );

  let modified = false;
  for (const pkg of packages) {
    if (!existing.has(pkg)) {
      prop.value.elements.push(t.stringLiteral(pkg));
      modified = true;
    }
  }
  return modified;
}

/**
 * Ensure a nested property path (parent.child) contains string array entries.
 * Creates the parent object if missing.
 * Returns true if modifications were made.
 */
export function ensureNestedArrayContains(
  configObj: t.ObjectExpression,
  parentKey: string,
  childKey: string,
  packages: readonly string[]
): boolean {
  const parentProp = findProperty(configObj.properties, parentKey);

  if (!parentProp) {
    configObj.properties.push(
      t.objectProperty(
        t.identifier(parentKey),
        t.objectExpression([
          t.objectProperty(
            t.identifier(childKey),
            t.arrayExpression(packages.map((pkg) => t.stringLiteral(pkg)))
          ),
        ])
      )
    );
    return true;
  }

  if (!t.isObjectExpression(parentProp.value)) {
    logger.warn(`vite-config.${parentKey}-not-object`, {
      valueType: parentProp.value.type,
    });
    return false;
  }

  return ensureArrayPropertyContains(parentProp.value, childKey, packages);
}

/**
 * Adds packages to optimizeDeps.exclude only. We intentionally do NOT add to
 * ssr.external because that would override ssr.noExternal:true and cause these
 * packages to be runtime imports the publish container cannot resolve (no
 * node_modules at runtime).
 *
 * Pure function - parses, modifies AST, and generates code.
 *
 * Used by skill onInstall hooks to prevent Node.js-only packages
 * (e.g. drizzle-orm, mysql2) from being bundled into the browser.
 */
export function addNodePackageExclusions(
  content: string,
  isTypeScript: boolean,
  packages: readonly string[]
): { code: string; modified: boolean; error?: string } {
  const ast = parse(content, {
    sourceType: 'module',
    plugins: isTypeScript ? ['typescript'] : [],
  });

  let modified = false;
  let foundConfig = false;

  const visitor = {
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const declaration = path.node.declaration;

      let configObj: t.ObjectExpression | null = null;

      if (t.isObjectExpression(declaration)) {
        configObj = declaration;
      } else if (t.isCallExpression(declaration)) {
        const callee = declaration.callee;
        if (t.isIdentifier(callee) && callee.name === 'defineConfig') {
          const arg = declaration.arguments[0];
          if (t.isObjectExpression(arg)) {
            configObj = arg;
          } else if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
            const body = arg.body;
            if (t.isObjectExpression(body)) {
              configObj = body;
            } else if (t.isBlockStatement(body)) {
              for (const stmt of body.body) {
                if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
                  configObj = stmt.argument;
                  break;
                }
              }
            }
          }
        }
      }

      if (configObj) {
        foundConfig = true;
        const m1 = ensureNestedArrayContains(configObj, 'optimizeDeps', 'exclude', packages);
        modified = modified || m1;
      }
    },
  };

  traverse(ast, visitor);

  if (!foundConfig) {
    return { code: content, modified: false, error: 'Could not find vite config object to modify' };
  }

  const { code } = generate(ast, { retainLines: true, compact: false });
  return { code, modified };
}

/**
 * Process vite config content and generate modified code
 * This is a pure function that can be used for testing without container operations
 *
 * @param content - The vite config file content
 * @param isTypeScript - Whether the config is TypeScript
 * @param options - Modification options (e.g., custom port)
 * @returns Object with modified code and status
 */
export function processAndGenerateViteConfig(
  content: string,
  isTypeScript = false,
  options?: ViteConfigModifyOptions
): { code: string; modified: boolean; error?: string } {
  const ast = parse(content, {
    sourceType: 'module',
    plugins: isTypeScript ? ['typescript'] : [],
  });

  const result = processViteConfigAST(ast, options);

  const { code } = generate(ast, {
    retainLines: true,
    compact: false,
  });

  return { code, ...result };
}

/**
 * Modify vite.config to ensure:
 * - server.port uses process.env.PORT
 * - server.allowedHosts is set to true
 * - resolve.dedupe includes react and react-dom
 *
 * @param devSupervisor - Client to execute commands in container
 * @param containerPath - Path to app directory in container (e.g., /app)
 * @param options - Modification options (e.g., custom fallback port)
 * @returns Result of the modification
 *
 * @remarks
 * Limitation: If `server` or `resolve` is set to a variable or function call
 * (e.g., `server: getServerConfig()`), that specific section cannot be safely
 * modified and will be skipped. Other sections may still be modified.
 */
export async function modifyViteConfig(
  tasks: WorkspaceTasks,
  containerPath: string,
  options?: ViteConfigModifyOptions
): Promise<ViteConfigModifyResult> {
  try {
    // Find vite config file
    const configFile = await findViteConfigFile(tasks, containerPath);

    if (!configFile) {
      logger.info('vite-config.not-found', { containerPath });
      return {
        success: true,
        modified: false,
      };
    }

    logger.info('vite-config.found', { containerPath, configFile });

    // Read the config file
    const content = await readFileFromContainer(tasks, containerPath, configFile);

    if (!content) {
      return {
        success: false,
        modified: false,
        configFile,
        error: 'Failed to read vite config file',
      };
    }

    // Parse the file
    const isTypeScript = configFile.endsWith('.ts') || configFile.endsWith('.mts') || configFile.endsWith('.cts');
    const ast = parse(content, {
      sourceType: 'module',
      plugins: isTypeScript ? ['typescript'] : [],
    });

    // Process and modify the AST
    const result = processViteConfigAST(ast, options);

    if (result.error) {
      logger.warn('vite-config.process-error', { configFile, error: result.error });
      return {
        success: true, // Not a fatal error - app might still work
        modified: false,
        configFile,
        error: result.error,
      };
    }

    if (!result.modified) {
      logger.info('vite-config.no-changes', { configFile });
      return {
        success: true,
        modified: false,
        configFile,
      };
    }

    // Generate the modified code
    const { code: modifiedContent } = generate(ast, {
      retainLines: true,
      compact: false,
    });

    // Write the modified file back
    const writeSuccess = await writeFileToContainer(tasks, containerPath, configFile, modifiedContent);

    if (!writeSuccess) {
      return {
        success: false,
        modified: false,
        configFile,
        error: 'Failed to write modified vite config file',
      };
    }

    logger.info('vite-config.modified', { configFile });

    return {
      success: true,
      modified: true,
      configFile,
    };
  } catch (error) {
    logger.error('vite-config.error', {
      containerPath,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      modified: false,
      error: error instanceof Error ? error.message : 'Unknown error modifying vite config',
    };
  }
}
