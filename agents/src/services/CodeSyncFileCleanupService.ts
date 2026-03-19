/**
 * CodeSyncFileCleanupService
 *
 * Shared service for identifying and cleaning up unwanted files during code sync operations.
 * Used by both ProjectImportService (zip-import) and GitOpsService (git pull/push).
 *
 * DRY: Pattern matching and deletion logic written once, used everywhere.
 */

import { Logger } from '../logging/index.js';
import { getZipImportLimits, type ZipImportLimits } from './features.js';
import { ValidationErrorKey, type ValidationError } from '../types/import.js';
import type { DevSupervisorClient } from './DevSupervisorClient.js';

// Cached patterns to avoid repeated env var parsing (performance optimization)
let cachedPatterns: ZipImportLimits['cleanablePatterns'] | null = null;

// Pattern for safe shell-safe patterns (no shell special chars)
const SAFE_PATTERN_REGEX = /^[a-zA-Z0-9._/-]+$/;

export class CodeSyncFileCleanupService {
  private logger = Logger.create({ service: 'code-sync-file-cleanup' });

  /**
   * Get cleanable patterns with caching to avoid repeated env var parsing.
   * Performance optimization: called potentially thousands of times during zip validation.
   */
  private getPatterns(): ZipImportLimits['cleanablePatterns'] {
    if (!cachedPatterns) {
      cachedPatterns = getZipImportLimits().cleanablePatterns;
    }
    return cachedPatterns;
  }

  /**
   * Validate that a pattern is safe for shell use.
   * Returns true if pattern contains no shell special characters.
   */
  private isSafePattern(pattern: string): boolean {
    return SAFE_PATTERN_REGEX.test(pattern);
  }

  /**
   * Clear cached patterns (for testing purposes).
   */
  static clearCache(): void {
    cachedPatterns = null;
  }

  /**
   * Check if a file matches cleanable patterns.
   * Used during zip validation to track which files will be cleaned.
   */
  isCleanableFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    const patterns = this.getPatterns();

    // Check OS junk
    for (const pattern of patterns.osJunk) {
      if (this.matchesPattern(lower, pattern)) {return true;}
    }

    // Check security-sensitive
    for (const pattern of patterns.securitySensitive) {
      if (this.matchesPattern(lower, pattern)) {return true;}
    }

    // Check IDE config
    for (const pattern of patterns.ideConfig) {
      if (this.matchesPattern(lower, pattern)) {return true;}
    }

    return false;
  }

  /**
   * Match a filename against a pattern
   */
  private matchesPattern(fileName: string, pattern: string): boolean {
    const lowerPattern = pattern.toLowerCase();

    if (lowerPattern.endsWith('/')) {
      // Directory pattern - check if path starts with or contains this directory
      const dirName = lowerPattern.slice(0, -1);
      return fileName.startsWith(dirName + '/') ||
             fileName.includes('/' + dirName + '/') ||
             fileName === dirName;
    } else if (lowerPattern.startsWith('.')) {
      // Dotfile or extension pattern
      const baseName = fileName.split('/').pop() || '';
      // Exact match or dot-extension (for .env.local, .env.production)
      // Note: We use lowerPattern + '.' to avoid .env matching .environment
      if (baseName === lowerPattern || baseName.startsWith(lowerPattern + '.')) {
        return true;
      }
      // Extension match (for .pem, .key) - only for short extensions
      // Use same logic as deleteCleanablePatterns: short extensions without dots after initial dot
      if (lowerPattern.length <= 4 && !lowerPattern.includes('.', 1)) {
        // Extension pattern - match basename ending with pattern
        // e.g., '.pem' matches 'server.pem' but '.env' is handled above
        if (baseName.endsWith(lowerPattern) && baseName !== lowerPattern) {
          return true;
        }
      }
    } else {
      // Exact filename match
      if (fileName === lowerPattern || fileName.endsWith('/' + lowerPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Delete all cleanable patterns from the container.
   * Uses configured patterns directly - no scanning needed.
   * Patterns are validated to prevent shell injection.
   */
  async deleteCleanablePatterns(
    devSupervisor: DevSupervisorClient,
    containerPath: string
  ): Promise<{ success: boolean; error?: string }> {
    const patterns = this.getPatterns();
    const allPatterns = [
      ...patterns.osJunk,
      ...patterns.securitySensitive,
      ...patterns.ideConfig,
    ];

    // Validate all patterns are safe for shell use
    const unsafePatterns = allPatterns.filter(p => !this.isSafePattern(p));
    if (unsafePatterns.length > 0) {
      const error = `Unsafe patterns detected: ${unsafePatterns.join(', ')}`;
      this.logger.error('code-sync-file-cleanup.delete.unsafe-patterns', {
        containerPath,
        unsafePatterns,
      });
      return { success: false, error };
    }

    // Build directory removals (patterns ending with /)
    const dirPatterns = allPatterns.filter(p => p.endsWith('/'));

    // Build find patterns for files
    const filePatterns = allPatterns.filter(p => !p.endsWith('/'));

    // Build command parts, handling empty cases
    const commandParts: string[] = [];

    // Add rm command only if there are directory patterns
    if (dirPatterns.length > 0) {
      const rmDirs = dirPatterns
        .map(p => `'${containerPath}/${p.slice(0, -1)}'`)
        .join(' ');
      commandParts.push(`rm -rf ${rmDirs} 2>/dev/null || true`);
    }

    // Add find command only if there are file patterns
    if (filePatterns.length > 0) {
      const findArgs = filePatterns
        .map(p => {
          // .env -> ".env*" (matches .env, .env.local, .env.production)
          if (p === '.env') {return "-name '.env*'";}
          // .pem, .key -> "*.pem", "*.key" (extension patterns)
          if (p.startsWith('.') && !p.includes('.', 1) && p.length <= 4) {
            return `-name '*${p}'`;
          }
          // Exact filenames: .DS_Store, Thumbs.db, .npmrc, .yarnrc, desktop.ini
          return `-name '${p}'`;
        })
        .join(' -o ');
      commandParts.push(`find '${containerPath}' \\( ${findArgs} \\) -type f -delete 2>/dev/null || true`);
    }

    // If no patterns to clean, return success
    if (commandParts.length === 0) {
      this.logger.info('code-sync-file-cleanup.delete.skip', {
        containerPath,
        reason: 'no patterns configured',
      });
      return { success: true };
    }

    const command = commandParts.join('; ');

    try {
      this.logger.info('code-sync-file-cleanup.delete.start', { containerPath });

      const result = await devSupervisor.exec({ command, timeout: 60 });

      this.logger.info('code-sync-file-cleanup.delete.complete', {
        containerPath,
        success: result.success,
        ...(result.error && { error: result.error }),
      });

      // Return actual result.success status instead of always returning true
      if (!result.success) {
        return { success: false, error: result.error || 'Cleanup command failed' };
      }

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('code-sync-file-cleanup.delete.error', {
        containerPath,
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Create warning ValidationError objects for cleaned files
   */
  createWarnings(cleanedFiles: string[]): ValidationError[] {
    return cleanedFiles.map(file => ({
      key: ValidationErrorKey.FILE_CLEANED,
      message: `Removed during import: ${file}`,
      details: { fileName: file },
    }));
  }
}

// Export singleton
export const codeSyncFileCleanupService = new CodeSyncFileCleanupService();
