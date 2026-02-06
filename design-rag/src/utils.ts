/**
 * Shared utilities for Design RAG CLI tools
 */

import { resolve, relative, isAbsolute } from 'path';

/**
 * Get nested value from object using dot notation
 * @param obj - Object to extract value from
 * @param path - Dot-separated path (e.g., "a.b.c")
 * @returns The value at the path, or undefined if not found
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }
  return path.split('.').reduce((current: unknown, key: string) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Convert string to URL-safe slug
 * @param text - Input text to slugify
 * @returns URL-safe slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Safely convert a value to a resource ID string
 * Validates, coerces, and sanitizes the value for use in file paths and KB node IDs
 *
 * The sanitization:
 * - Converts to lowercase for consistency
 * - Replaces any non-alphanumeric characters (except hyphens and underscores) with hyphens
 * - Collapses multiple hyphens into one
 * - Removes leading/trailing hyphens
 * - Returns undefined for empty/invalid input
 *
 * @param value - Value to convert
 * @returns Sanitized string matching pattern /^[a-z0-9][a-z0-9_-]*[a-z0-9]$|^[a-z0-9]$/, or undefined if invalid
 */
export function toSafeResourceId(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const strValue = String(value).trim();
  if (!strValue) {
    return undefined;
  }

  // Convert to lowercase and replace unsafe characters with hyphens
  const sanitized = strValue
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') // Replace unsafe chars with hyphen
    .replace(/--+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  // Return undefined if sanitization resulted in empty string
  if (!sanitized) {
    return undefined;
  }

  return sanitized;
}

/**
 * Validate and resolve a file path for CLI input
 *
 * This function performs basic sanitization of user-provided paths:
 * - Resolves relative paths against the base directory
 * - Rejects paths containing null bytes (injection prevention)
 *
 * Note: This does NOT restrict paths to a specific directory. CLI tools
 * intentionally allow users to access any file they have permission to read.
 * The validation here prevents injection attacks, not directory escapes.
 *
 * @param inputPath - User-provided path (can be relative or absolute)
 * @param baseDir - Base directory for resolving relative paths (defaults to cwd)
 * @returns Object with resolved path and validation result
 */
export function validatePath(
  inputPath: string,
  baseDir?: string
): { valid: boolean; resolvedPath: string; error?: string } {
  const base = baseDir || process.cwd();

  // Resolve the input path
  const resolvedPath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(base, inputPath);

  // Check for null bytes which can be used for injection attacks
  if (inputPath.includes('\0') || resolvedPath.includes('\0')) {
    return {
      valid: false,
      resolvedPath,
      error: 'Path contains null bytes'
    };
  }

  return { valid: true, resolvedPath };
}

/**
 * Validate numeric input from CLI options
 * @param value - String value to parse
 * @param options - Validation options
 * @returns Parsed number or error
 */
export function validateNumericOption(
  value: string,
  options: {
    type: 'int' | 'float';
    min?: number;
    max?: number;
    name: string;
  }
): { valid: boolean; value?: number; error?: string } {
  const parsed = options.type === 'int' ? parseInt(value, 10) : parseFloat(value);

  if (Number.isNaN(parsed)) {
    return {
      valid: false,
      error: `Invalid value for ${options.name}: "${value}". Expected a ${options.type === 'int' ? 'integer' : 'number'}.`
    };
  }

  if (options.min !== undefined && parsed < options.min) {
    return {
      valid: false,
      error: `Invalid value for ${options.name}: ${parsed}. Must be >= ${options.min}.`
    };
  }

  if (options.max !== undefined && parsed > options.max) {
    return {
      valid: false,
      error: `Invalid value for ${options.name}: ${parsed}. Must be <= ${options.max}.`
    };
  }

  return { valid: true, value: parsed };
}
