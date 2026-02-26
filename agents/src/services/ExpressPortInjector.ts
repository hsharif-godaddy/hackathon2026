/**
 * ExpressPortInjector
 *
 * Injects process.env.PORT and 0.0.0.0 host binding into Express/Node.js entry files
 * using simple string replacement (no AST).
 *
 * This is necessary for PaaS containers where the PORT is dynamically assigned
 * and the app must bind to 0.0.0.0 to be accessible from the proxy.
 */

import { normalize, isAbsolute } from 'node:path';
import { DevSupervisorClient } from './DevSupervisorClient.js';
import { Logger } from '../logging/index.js';

const logger = Logger.create({ service: 'express-port-injector' });

/**
 * Validate that entryFile is a safe relative path that doesn't escape the project root.
 * Rejects absolute paths, paths containing parent directory traversal, and URL-encoded attacks.
 *
 * @param entryFile - Entry file path to validate
 * @returns true if safe, false if potentially malicious
 */
function isValidEntryFile(entryFile: string): boolean {
  // Decode URL-encoded content to catch encoded traversal attacks like %2e%2e/etc/passwd
  let decoded = entryFile;
  try {
    decoded = decodeURIComponent(entryFile);
    // Reject paths that still contain percent-encoded sequences after decode
    // This catches double-encoded attacks like %252e%252e
    if (decoded.includes('%2e') || decoded.includes('%2E')) {
      return false;
    }
  } catch {
    // Invalid URL encoding - reject as potentially malicious
    return false;
  }

  // Reject absolute paths (check both original and decoded)
  if (isAbsolute(entryFile) || isAbsolute(decoded)) {
    return false;
  }

  // Normalize the decoded path and check for directory traversal
  const normalized = normalize(decoded);

  // Reject if normalized path starts with .. (escapes root)
  if (normalized.startsWith('..')) {
    return false;
  }

  // Reject if path contains null bytes (common injection technique)
  if (entryFile.includes('\0') || decoded.includes('\0')) {
    return false;
  }

  return true;
}

export interface PortInjectionResult {
  /** Whether the file was modified */
  modified: boolean;
  /** Whether injection was skipped (already has process.env.PORT) */
  skipped: boolean;
  /** Reason for skipping (if skipped) */
  reason?: string;
  /** Error message if injection failed */
  error?: string;
}

/**
 * Injects process.env.PORT and 0.0.0.0 host binding into Express entry files
 * using simple string replacement (no AST).
 *
 * @param devSupervisor - Client to execute commands in container
 * @param projectRoot - Project root path inside container
 * @param entryFile - Entry file path relative to project root (e.g., 'src/server.ts')
 * @returns Result indicating whether injection was successful
 */
export async function injectPortHandling(
  devSupervisor: DevSupervisorClient,
  projectRoot: string,
  entryFile: string
): Promise<PortInjectionResult> {
  // Validate entryFile to prevent path traversal attacks
  if (!isValidEntryFile(entryFile)) {
    logger.warn('express-port-injector.invalid-entry-file', {
      entryFile,
      reason: 'Path validation failed - potential path traversal attempt',
    });
    return {
      modified: false,
      skipped: false,
      error: 'Invalid entry file path: must be a relative path within the project',
    };
  }

  const filePath = `${projectRoot}/${entryFile}`;

  logger.info('express-port-injector.start', { entryFile, filePath });

  // Step 1: Read the entry file
  const readResult = await devSupervisor.exec({
    command: `cat "${filePath}"`,
    working_dir: projectRoot,
    timeout: 10,
  });

  if (readResult.exit_code !== 0) {
    logger.warn('express-port-injector.file-not-found', {
      entryFile,
      stderr: readResult.stderr,
    });
    return {
      modified: false,
      skipped: false,
      error: `Entry file not found: ${entryFile}`,
    };
  }

  const sourceCode = readResult.stdout || '';

  // Step 2: Check if already uses process.env.PORT
  if (sourceCode.includes('process.env.PORT')) {
    logger.info('express-port-injector.skip', {
      entryFile,
      reason: 'Already uses process.env.PORT',
    });
    return {
      modified: false,
      skipped: true,
      reason: 'Already uses process.env.PORT',
    };
  }

  // Step 3: Apply string replacements
  const modifiedCode = applyPortReplacements(sourceCode);

  if (modifiedCode === sourceCode) {
    logger.warn('express-port-injector.no-pattern-found', { entryFile });
    return {
      modified: false,
      skipped: false,
      error: 'Could not find listen() pattern to modify. Ensure your entry file uses app.listen() or server.listen().',
    };
  }

  // Step 4: Write modified file back using heredoc with quoted delimiter
  // The single-quoted delimiter ('PAAS_PORT_INJECT_EOF') disables shell expansion
  const writeResult = await devSupervisor.exec({
    command: `cat > "${filePath}" << 'PAAS_PORT_INJECT_EOF'\n${modifiedCode}\nPAAS_PORT_INJECT_EOF`,
    working_dir: projectRoot,
    timeout: 10,
  });

  if (writeResult.exit_code !== 0) {
    logger.error('express-port-injector.write-failed', {
      entryFile,
      stderr: writeResult.stderr,
    });
    return {
      modified: false,
      skipped: false,
      error: `Failed to write modified file: ${writeResult.stderr}`,
    };
  }

  logger.info('express-port-injector.success', { entryFile });
  return { modified: true, skipped: false };
}

/**
 * Apply string replacements to inject process.env.PORT and 0.0.0.0
 *
 * This function handles common patterns found in Express/Node.js applications:
 * - const PORT = 3000 -> const PORT = process.env.PORT || 3000
 * - .listen(3000) -> .listen(process.env.PORT || 3000, '0.0.0.0')
 * - .listen(3000, 'localhost') -> .listen(process.env.PORT || 3000, '0.0.0.0')
 * - .listen(PORT, 'localhost') -> .listen(PORT, '0.0.0.0')
 * - .listen(3000, callback) -> .listen(process.env.PORT || 3000, '0.0.0.0', callback)
 *
 * @param sourceCode - Original source code
 * @returns Modified source code with PORT injection
 */
export function applyPortReplacements(sourceCode: string): string {
  let modified = sourceCode;

  // Pattern 1: const PORT = 3000 -> const PORT = process.env.PORT || 3000
  // Handles: const PORT = 3000, const port = 8080, let PORT = 5000
  modified = modified.replace(
    /\b(const|let|var)\s+(PORT|port)\s*=\s*(\d+)/g,
    '$1 $2 = process.env.PORT || $3'
  );

  // Pattern 2: .listen(3000) -> .listen(process.env.PORT || 3000, '0.0.0.0')
  // Handles: app.listen(3000), server.listen(8080)
  modified = modified.replace(
    /\.listen\s*\(\s*(\d+)\s*\)/g,
    ".listen(process.env.PORT || $1, '0.0.0.0')"
  );

  // Pattern 3: .listen(3000, 'localhost') -> .listen(process.env.PORT || 3000, '0.0.0.0')
  modified = modified.replace(
    /\.listen\s*\(\s*(\d+)\s*,\s*['"](?:localhost|127\.0\.0\.1)['"]\s*\)/g,
    ".listen(process.env.PORT || $1, '0.0.0.0')"
  );

  // Pattern 4: .listen(PORT, 'localhost') -> .listen(PORT, '0.0.0.0')
  modified = modified.replace(
    /\.listen\s*\(\s*(PORT|port)\s*,\s*['"](?:localhost|127\.0\.0\.1)['"]\s*\)/g,
    ".listen($1, '0.0.0.0')"
  );

  // Pattern 5: .listen(3000, callback) -> .listen(process.env.PORT || 3000, '0.0.0.0', callback)
  // Handles: app.listen(3000, () => {})
  modified = modified.replace(
    /\.listen\s*\(\s*(\d+)\s*,\s*(\([^)]*\)\s*=>|\bfunction\b)/g,
    ".listen(process.env.PORT || $1, '0.0.0.0', $2"
  );

  return modified;
}
