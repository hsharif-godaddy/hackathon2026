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
import type { DevSupervisorClient } from './DevSupervisorClient.js';
import { VITE_BUILD_TOOL } from '../server/middleware/git-import-validation.js';

// Handle ES module default exports
// @ts-expect-error - Handle ES module default exports
const traverse = _traverse.default || _traverse;
// @ts-expect-error - Handle ES module default exports
const generate = _generate.default || _generate;

const logger = Logger.create({ service: 'vite-config-modifier' });

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
  devSupervisor: DevSupervisorClient,
  containerPath: string
): Promise<string | null> {
  for (const configFile of VITE_BUILD_TOOL.configFiles) {
    const checkResult = await devSupervisor.exec({
      command: `test -f "${containerPath}/${configFile}" && echo "found" || echo "notfound"`,
      timeout: 5,
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
  devSupervisor: DevSupervisorClient,
  containerPath: string,
  fileName: string
): Promise<string | null> {
  const result = await devSupervisor.exec({
    command: `cat "${containerPath}/${fileName}"`,
    timeout: 10,
  });

  if (!result.success || !result.stdout) {
    return null;
  }

  return result.stdout;
}

/**
 * Write file content to container
 */
async function writeFileToContainer(
  devSupervisor: DevSupervisorClient,
  containerPath: string,
  fileName: string,
  content: string
): Promise<boolean> {
  // Escape content for shell - use base64 to avoid escaping issues
  const base64Content = Buffer.from(content).toString('base64');

  const result = await devSupervisor.exec({
    command: `echo "${base64Content}" | base64 -d > "${containerPath}/${fileName}"`,
    timeout: 10,
  });

  return result.success;
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
 * Create a server property with allowedHosts: true
 */
export function createServerProperty(): t.ObjectProperty {
  return t.objectProperty(
    t.identifier('server'),
    t.objectExpression([createAllowedHostsProperty()])
  );
}

/**
 * Check if allowedHosts is already set to true (boolean literal)
 */
export function isAllowedHostsTrue(value: t.Expression | t.PatternLike): boolean {
  return t.isBooleanLiteral(value) && value.value === true;
}

/**
 * Modify an object expression to ensure server.allowedHosts: true
 * Returns true if modifications were made, false if no changes needed or
 * modification was not possible (e.g., server is a variable/function call)
 */
export function modifyConfigObject(objExpr: t.ObjectExpression): boolean {
  const serverProp = findProperty(objExpr.properties, 'server');

  if (!serverProp) {
    // No server property - add it with allowedHosts: true
    objExpr.properties.push(createServerProperty());
    return true;
  }

  // Server property exists - check its value
  if (!t.isObjectExpression(serverProp.value)) {
    // Server value is not an object expression (might be a variable or function call)
    // We can't safely modify it, so log a warning and skip
    logger.warn('vite-config.server-not-object', {
      valueType: serverProp.value.type,
    });
    return false;
  }

  const serverObj = serverProp.value;
  const allowedHostsProp = findProperty(serverObj.properties, 'allowedHosts');

  if (!allowedHostsProp) {
    // allowedHosts doesn't exist - add it
    serverObj.properties.push(createAllowedHostsProperty());
    return true;
  }

  // allowedHosts exists - check if it's already true
  if (isAllowedHostsTrue(allowedHostsProp.value)) {
    // Already set to true, no modification needed
    return false;
  }

  // Overwrite to true
  allowedHostsProp.value = t.booleanLiteral(true);
  return true;
}

/**
 * Process the AST to find and modify the vite config
 * Handles both direct object export and defineConfig wrapper
 */
export function processViteConfigAST(ast: t.File): { modified: boolean; error?: string } {
  let modified = false;
  let foundConfig = false;

  traverse(ast, {
    // Handle: export default { ... }
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const declaration = path.node.declaration;

      // Direct object expression: export default { server: ... }
      if (t.isObjectExpression(declaration)) {
        foundConfig = true;
        modified = modifyConfigObject(declaration);
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
            modified = modifyConfigObject(arg);
            return;
          }

          // defineConfig(() => ({ ... })) or defineConfig(({ mode }) => ({ ... }))
          if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
            const body = arg.body;

            // Arrow function with parenthesized object: () => ({ ... })
            if (t.isObjectExpression(body)) {
              foundConfig = true;
              modified = modifyConfigObject(body);
              return;
            }

            // Arrow/function with block body: () => { return { ... } }
            if (t.isBlockStatement(body)) {
              // Find the return statement
              for (const stmt of body.body) {
                if (t.isReturnStatement(stmt) && t.isObjectExpression(stmt.argument)) {
                  foundConfig = true;
                  modified = modifyConfigObject(stmt.argument);
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

/**
 * Process vite config content and generate modified code
 * This is a pure function that can be used for testing without container operations
 *
 * @param content - The vite config file content
 * @param isTypeScript - Whether the config is TypeScript
 * @returns Object with modified code and status
 */
export function processAndGenerateViteConfig(
  content: string,
  isTypeScript = false
): { code: string; modified: boolean; error?: string } {
  const ast = parse(content, {
    sourceType: 'module',
    plugins: isTypeScript ? ['typescript'] : [],
  });

  const result = processViteConfigAST(ast);

  const { code } = generate(ast, {
    retainLines: true,
    compact: false,
  });

  return { code, ...result };
}

/**
 * Modify vite.config to ensure server.allowedHosts is set to true
 *
 * @param devSupervisor - Client to execute commands in container
 * @param containerPath - Path to app directory in container (e.g., /app)
 * @returns Result of the modification
 *
 * @remarks
 * Limitation: If the `server` property is set to a variable or function call
 * (e.g., `server: getServerConfig()` or `server: serverOptions`), this function
 * cannot safely modify it and will skip modification. In such cases, the app may
 * need manual configuration to add `allowedHosts: true` to the server settings.
 */
export async function modifyViteConfig(
  devSupervisor: DevSupervisorClient,
  containerPath: string
): Promise<ViteConfigModifyResult> {
  try {
    // Find vite config file
    const configFile = await findViteConfigFile(devSupervisor, containerPath);

    if (!configFile) {
      logger.info('vite-config.not-found', { containerPath });
      return {
        success: true,
        modified: false,
      };
    }

    logger.info('vite-config.found', { containerPath, configFile });

    // Read the config file
    const content = await readFileFromContainer(devSupervisor, containerPath, configFile);

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
    const result = processViteConfigAST(ast);

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
    const writeSuccess = await writeFileToContainer(devSupervisor, containerPath, configFile, modifiedContent);

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
