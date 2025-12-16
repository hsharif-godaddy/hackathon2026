/**
 * Safe path utility functions to prevent path traversal attacks
 * 
 * These utilities sanitize user inputs and validate paths to ensure they don't
 * escape from intended boundaries, preventing directory traversal vulnerabilities.
 */

import { existsSync } from 'fs';
import path from 'path';

export interface SafePathOptions {
  /** Base directory that all resolved paths must be within */
  baseDir?: string;
  /** Allow absolute paths (default: false) */
  allowAbsolute?: boolean;
  /** Allow paths that go outside baseDir (default: false) */  
  allowTraversal?: boolean;
}

/**
 * Error thrown when path operations are unsafe
 */
export class UnsafePathError extends Error {
  constructor(message: string, public readonly attemptedPath: string, public readonly baseDir?: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/**
 * Sanitize a path component by removing dangerous characters and sequences
 */
function sanitizePathComponent(component: string): string {
  if (typeof component !== 'string') {
    throw new UnsafePathError(`Path component must be a string, got ${typeof component}`, String(component));
  }

  // Remove null bytes and other control characters
  // eslint-disable-next-line no-control-regex
  let sanitized = component.replace(/[\x00-\x1f\x7f]/g, '');
  
  // Remove or replace dangerous sequences
  sanitized = sanitized
    .replace(/\.\./g, '') // Remove .. sequences
    // eslint-disable-next-line no-useless-escape
    .replace(/\/+/g, '/') // Collapse multiple slashes
    // eslint-disable-next-line no-useless-escape
    .replace(/\\+/g, '\\') // Collapse multiple backslashes
    // eslint-disable-next-line no-useless-escape
    .replace(/^[\/\\]+/, '') // Remove leading slashes
    // eslint-disable-next-line no-useless-escape
    .replace(/[\/\\]+$/, ''); // Remove trailing slashes
  
  // Reject certain dangerous names
  const dangerous = ['.', '..', '', 'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  if (dangerous.includes(sanitized.toUpperCase())) {
    throw new UnsafePathError(`Dangerous path component: ${component}`, component);
  }

  return sanitized;
}

/**
 * Validate that a resolved path is within the allowed base directory
 */
function validatePathWithinBase(resolvedPath: string, baseDir: string): void {
  const normalizedResolved = path.normalize(resolvedPath);
  const normalizedBase = path.normalize(baseDir);
  
  if (!normalizedResolved.startsWith(normalizedBase)) {
    throw new UnsafePathError(
      `Path traversal detected: resolved path '${normalizedResolved}' is outside base directory '${normalizedBase}'`,
      resolvedPath,
      baseDir
    );
  }
}

/**
 * Safely join path segments with options, preventing path traversal attacks
 * 
 * @param baseDir - Base directory that result must be within
 * @param segments - Array of path segments to join
 * @param options - Additional safety options
 * @returns Safely joined and validated path
 * 
 * @throws {UnsafePathError} If the resulting path would be unsafe
 */
export function safeJoinWithOptions(
  baseDir: string,
  segments: string[],
  options: SafePathOptions = {}
): string {
  if (typeof baseDir !== 'string' || !baseDir) {
    throw new UnsafePathError('Base directory must be a non-empty string', baseDir);
  }

  // Sanitize base directory
  const normalizedBase = path.resolve(baseDir);

  // Handle empty segments
  if (segments.length === 0) {
    return normalizedBase;
  }

  // Check for absolute paths in segments
  const hasAbsolutePath = segments.some(segment => path.isAbsolute(segment));
  if (hasAbsolutePath && !options.allowAbsolute) {
    const absoluteSegment = segments.find(segment => path.isAbsolute(segment));
    throw new UnsafePathError(
      `Absolute path not allowed: ${absoluteSegment}`,
      absoluteSegment || '',
      baseDir
    );
  }

  // If we have an absolute path and it's allowed, use it directly (but still validate)
  if (hasAbsolutePath && options.allowAbsolute) {
    const absoluteSegment = segments.find(segment => path.isAbsolute(segment));
    const resolvedPath = path.resolve(absoluteSegment!);
    
    if (!options.allowTraversal) {
      // Still need to validate if we have a base constraint
      validatePathWithinBase(resolvedPath, normalizedBase);
    }
    
    return resolvedPath;
  }

  // Sanitize all segments
  const sanitizedSegments = segments.map(segment => {
    if (typeof segment !== 'string') {
      throw new UnsafePathError(`Path segment must be a string, got ${typeof segment}`, String(segment));
    }
    return sanitizePathComponent(segment);
  });

  // Join with base directory
  const joinedPath = path.join(normalizedBase, ...sanitizedSegments);
  const resolvedPath = path.resolve(joinedPath);

  // Validate the final path is within base directory (unless traversal is allowed)
  if (!options.allowTraversal) {
    validatePathWithinBase(resolvedPath, normalizedBase);
  }

  return resolvedPath;
}

/**
 * Safely join path segments, preventing path traversal attacks
 * 
 * @param baseDir - Base directory that result must be within
 * @param segments - Path segments to join
 * @returns Safely joined and validated path
 * 
 * @throws {UnsafePathError} If the resulting path would be unsafe
 * 
 * @example
 * ```typescript
 * // Safe - stays within base
 * safeJoin('/home/user', 'documents', 'file.txt') // '/home/user/documents/file.txt'
 * 
 * // Throws - would escape base directory
 * safeJoin('/home/user', '..', '..', 'etc', 'passwd') // UnsafePathError
 * ```
 */
export function safeJoin(
  baseDir: string,
  ...segments: string[]
): string {
  return safeJoinWithOptions(baseDir, segments, {});
}

/**
 * Safely resolve a path relative to a base directory
 * 
 * @param baseDir - Base directory to resolve relative to
 * @param targetPath - Path to resolve (can be relative or absolute)
 * @param options - Additional safety options
 * @returns Safely resolved path
 * 
 * @throws {UnsafePathError} If the resulting path would be unsafe
 * 
 * @example
 * ```typescript
 * // Safe relative resolution
 * safeResolve('/home/user', 'documents/file.txt') // '/home/user/documents/file.txt'
 * 
 * // Throws - would escape base directory  
 * safeResolve('/home/user', '../../../etc/passwd') // UnsafePathError
 * 
 * // Allow absolute paths
 * safeResolve('/tmp', '/var/log/app.log', { allowAbsolute: true }) // '/var/log/app.log'
 * ```
 */
export function safeResolve(baseDir: string, targetPath: string, options: SafePathOptions = {}): string {
  if (typeof baseDir !== 'string' || !baseDir) {
    throw new UnsafePathError('Base directory must be a non-empty string', baseDir);
  }

  if (typeof targetPath !== 'string') {
    throw new UnsafePathError(`Target path must be a string, got ${typeof targetPath}`, String(targetPath));
  }

  const normalizedBase = path.resolve(baseDir);

  // Handle absolute paths
  if (path.isAbsolute(targetPath)) {
    if (!options.allowAbsolute) {
      throw new UnsafePathError(
        `Absolute path not allowed: ${targetPath}`,
        targetPath,
        baseDir
      );
    }
    
    const resolvedPath = path.resolve(targetPath);
    
    if (!options.allowTraversal) {
      validatePathWithinBase(resolvedPath, normalizedBase);
    }
    
    return resolvedPath;
  }

  // Handle relative paths
  const resolvedPath = path.resolve(normalizedBase, targetPath);

  // Validate the final path is within base directory (unless traversal is allowed)
  if (!options.allowTraversal) {
    validatePathWithinBase(resolvedPath, normalizedBase);
  }

  return resolvedPath;
}

/**
 * Check if a path is safe (within base directory and doesn't contain traversal)
 * 
 * @param targetPath - Path to check
 * @param baseDir - Base directory constraint
 * @param options - Additional safety options
 * @returns True if path is safe, false otherwise
 * 
 * @example
 * ```typescript
 * isSafePath('/home/user/doc.txt', '/home/user') // true
 * isSafePath('/etc/passwd', '/home/user') // false
 * isSafePath('../../../etc/passwd', '/home/user') // false
 * ```
 */
export function isSafePath(targetPath: string, baseDir: string, options: SafePathOptions = {}): boolean {
  try {
    safeResolve(baseDir, targetPath, options);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a safe path builder bound to a specific base directory
 * 
 * @param baseDir - Base directory for all operations
 * @param defaultOptions - Default options to use
 * @returns Object with safe path methods bound to the base directory
 * 
 * @example
 * ```typescript
 * const builder = createSafePathBuilder('/home/user/apps');
 * 
 * const appPath = builder.join('my-app', 'src', 'index.js');
 * const configPath = builder.resolve('my-app/config.json');
 * const isSafe = builder.isSafe('../other-app/file.txt');
 * ```
 */
export function createSafePathBuilder(baseDir: string, defaultOptions: SafePathOptions = {}) {
  const normalizedBase = path.resolve(baseDir);
  
  return {
    /**
     * Join segments relative to base directory
     */
    join: (...segments: string[]) => safeJoinWithOptions(normalizedBase, segments, defaultOptions),
    
    /**
     * Resolve path relative to base directory  
     */
    resolve: (targetPath: string, options?: SafePathOptions) => 
      safeResolve(normalizedBase, targetPath, { ...defaultOptions, ...options }),
    
    /**
     * Check if path is safe relative to base directory
     */
    isSafe: (targetPath: string, options?: SafePathOptions) => 
      isSafePath(targetPath, normalizedBase, { ...defaultOptions, ...options }),
    
    /**
     * Get the base directory
     */
    getBaseDir: () => normalizedBase,
    
    /**
     * Check if a resolved path exists
     */
    exists: (targetPath: string, options?: SafePathOptions) => {
      try {
        const safePath = safeResolve(normalizedBase, targetPath, { ...defaultOptions, ...options });
        return existsSync(safePath);
      } catch {
        return false;
      }
    }
  };
}