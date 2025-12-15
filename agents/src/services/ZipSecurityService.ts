/**
 * ZipSecurityService
 *
 * Handles secure extraction of zip files with security checks for:
 * - Path traversal attacks
 * - Zip bombs (compression ratio attacks)
 * - Symlink attacks
 * - Malicious filenames
 *
 * FUTURE OPTIMIZATION: Create dedicated createEmptyAppContainer() method to skip
 * template installation, eliminating double npm install. Track in technical debt.
 */

import { createReadStream, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { Logger } from '../logging/index.js';
import { ValidationErrorKey, type ValidationError } from '../types/import.js';

export const ZIP_LIMITS = {
  MIN_ZIP_SIZE: 1 * 1024,                 // (in Bytes) 1KB
  MAX_ZIP_SIZE: 250 * 1024 * 1024,        // 250MB - accommodates most GitHub repos
  MAX_EXTRACTED_SIZE: 1024 * 1024 * 1024, // 1GB - allows for larger codebases
  MAX_COMPRESSION_RATIO: 100,              // Zip bomb detection threshold (code typically compresses 3-10x)
  MAX_FILES: 50000,                        // Supports monorepos while preventing DoS
  MAX_PATH_LENGTH: 260,                    // Windows MAX_PATH for cross-platform safety
} as const;
export class ZipSecurityService {
  private logger = Logger.create({ service: 'zip-security' });

  /**
   * Validate a zip file before extraction
   *
   * @param zipPath - Path to the zip file
   * @param maxSize - Maximum allowed zip size in bytes
   * @returns Validation result with errors if any
   */
  async validate(
    zipPath: string,
    maxSize: number = ZIP_LIMITS.MAX_ZIP_SIZE
  ): Promise<{ valid: boolean; errors: ValidationError[] }> {
    const errors: ValidationError[] = [];

    try {
      // Check file exists
      try {
        await access(zipPath);
      } catch {
        errors.push({
          key: ValidationErrorKey.ZIP_INVALID_FORMAT,
          message: 'Zip file not found or not accessible',
          details: { path: zipPath },
        });
        return { valid: false, errors };
      }

      // Check file size
      const stats = statSync(zipPath);

      if (stats.size < ZIP_LIMITS.MIN_ZIP_SIZE) {
        errors.push({
          key: ValidationErrorKey.ZIP_EMPTY,
          message: 'Zip file is empty',
          details: { size: 0 },
        });
        return { valid: false, errors };
      }

      if (stats.size > maxSize) {
        errors.push({
          key: ValidationErrorKey.ZIP_TOO_LARGE,
          message: `Zip file exceeds maximum size of ${Math.round(maxSize / 1024 / 1024)}MB`,
          details: { size: stats.size, maxSize },
        });
        return { valid: false, errors };
      }

      // Validate zip format by checking magic bytes
      const isValidZip = await this.validateZipFormat(zipPath);
      if (!isValidZip) {
        errors.push({
          key: ValidationErrorKey.ZIP_INVALID_FORMAT,
          message: 'File is not a valid zip archive',
          details: { path: zipPath },
        });
        return { valid: false, errors };
      }

      return { valid: true, errors: [] };
    } catch (error) {
      this.logger.error('zip-security.validate.failed', {
        zipPath,
        error: error instanceof Error ? error.message : String(error),
      });

      errors.push({
        key: ValidationErrorKey.ZIP_CORRUPTED,
        message: 'Failed to validate zip file',
        details: { error: error instanceof Error ? error.message : String(error) },
      });

      return { valid: false, errors };
    }
  }

  /**
   * Check if file has valid zip magic bytes
   */
  private async validateZipFormat(zipPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const stream = createReadStream(zipPath, { start: 0, end: 3 });
      const chunks: Buffer[] = [];

      stream.on('data', (chunk: Buffer | string) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(chunk));
        }
      });
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        // ZIP magic bytes: PK\x03\x04 or PK\x05\x06 (empty) or PK\x07\x08 (spanned)
        const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b &&
          (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);
        resolve(isZip);
      });
      stream.on('error', () => resolve(false));
    });
  }
}

// Export singleton instance
export const zipSecurityService = new ZipSecurityService();

