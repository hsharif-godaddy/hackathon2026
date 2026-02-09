/**
 * ZipSecurityService
 *
 * Handles secure validation of zip files with security checks for:
 * - Path traversal attacks
 * - Zip bombs (compression ratio attacks)
 * - Symlink attacks
 * - Malicious filenames
 * - Dangerous file types
 * - File count and size limits
 *
 * Uses yauzl to inspect zip metadata WITHOUT extraction for security.
 */

import { createReadStream, statSync } from 'node:fs';
import { access } from 'node:fs/promises';
import yauzl from 'yauzl';
import { Logger } from '../logging/index.js';
import { getZipImportLimits } from './features.js';
import {
  ValidationErrorKey,
  type ValidationError,
  type ZipValidationResult,
  type ZipValidationStats,
} from '../types/import.js';
import { codeSyncFileCleanupService } from './CodeSyncFileCleanupService.js';

// Security constants
const UNIX_MODE_MASK = 0xFFFF; // Mask to extract Unix file mode from external file attributes
const S_IFLNK = 0xA000; // Unix file type constant for symbolic links

export class ZipSecurityService {
  private logger = Logger.create({ service: 'zip-security' });

  /**
   * Main validation method
   * Performs basic checks then deep inspection with yauzl
   *
   * @param zipPath - Path to the zip file
   * @param maxSize - Optional maximum allowed zip size (defaults to configured limit)
   * @returns Validation result with errors and stats
   */
  async validate(
    zipPath: string,
    maxSize?: number
  ): Promise<ZipValidationResult> {
    const limits = getZipImportLimits();
    const effectiveMaxSize = maxSize || limits.maxZipSize;
    const errors: ValidationError[] = [];

    try {
      // 1. Check file exists
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

      // 2. Check file size
      const stats = statSync(zipPath);

      if (stats.size < limits.minZipSize) {
        errors.push({
          key: ValidationErrorKey.ZIP_EMPTY,
          message: 'Zip file is too small',
          details: { size: stats.size },
        });
        return { valid: false, errors };
      }

      if (stats.size > effectiveMaxSize) {
        errors.push({
          key: ValidationErrorKey.ZIP_TOO_LARGE,
          message: `Zip file exceeds maximum size of ${Math.round(effectiveMaxSize / 1024 / 1024)}MB`,
          details: { size: stats.size, maxSize: effectiveMaxSize },
        });
        return { valid: false, errors };
      }

      // 3. Validate zip format (magic bytes)
      const isValidZip = await this.validateZipFormat(zipPath);
      if (!isValidZip) {
        errors.push({
          key: ValidationErrorKey.ZIP_INVALID_FORMAT,
          message: 'File is not a valid zip archive',
          details: { path: zipPath },
        });
        return { valid: false, errors };
      }

      // 4. Deep structure inspection with yauzl (no extraction!)
      const inspectionResult = await this.inspectZipStructure(zipPath, stats.size);

      if (!inspectionResult.valid) {
        return inspectionResult;
      }

      // At this point, validation succeeded and stats should always be present
      if (!inspectionResult.stats) {
        throw new Error('Validation succeeded but stats are missing');
      }

      // Success with stats
      this.logger.info('zip-security.validate.success', {
        zipPath,
        stats: inspectionResult.stats,
        cleanableFilesCount: inspectionResult.cleanableFiles?.length ?? 0,
      });

      return {
        valid: true,
        errors: [],
        stats: inspectionResult.stats,
        cleanableFiles: inspectionResult.cleanableFiles,
      };

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
   * Inspect zip structure using yauzl WITHOUT extraction
   * Validates: compression ratio, file count, paths, symlinks, dangerous files
   *
   * This reads the zip's Central Directory (table of contents) which contains
   * metadata for ALL files WITHOUT extracting any data
   */
  private async inspectZipStructure(
    zipPath: string,
    compressedSize: number
  ): Promise<ZipValidationResult> {
    const limits = getZipImportLimits();

    return new Promise((resolve, reject) => {
      const errors: ValidationError[] = [];
      const cleanableFiles: string[] = [];
      let totalUncompressed = 0;
      let totalCompressed = 0; // Track cumulative compressed size for accurate ratio calculation
      let fileCount = 0;
      let largestFile: { name: string; size: number } | undefined;

      // Open zip with lazy entries (reads Central Directory, one entry at a time)
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          return reject(err);
        }

        if (!zipfile) {
          return reject(new Error('Failed to open zip file'));
        }

        // Process each entry (file) in the zip
        zipfile.on('entry', (entry: yauzl.Entry) => {
          fileCount++;
          const uncompressedSize = entry.uncompressedSize;
          const compressedSize = entry.compressedSize;
          totalUncompressed += uncompressedSize;
          totalCompressed += compressedSize;

          // Track largest file
          if (!largestFile || uncompressedSize > largestFile.size) {
            largestFile = { name: entry.fileName, size: uncompressedSize };
          }

          // Check 1: Path traversal
          const traversalError = this.checkPathTraversal(entry.fileName);
          if (traversalError) {
            errors.push(traversalError);
          }

          // Check 2: Filename validation
          const filenameError = this.validateFilename(entry.fileName);
          if (filenameError) {
            errors.push(filenameError);
          }

          // Check 3: Symlink detection
          if (this.isSymlink(entry)) {
            errors.push({
              key: ValidationErrorKey.ZIP_SYMLINK_FOUND,
              message: `Symlink detected: ${entry.fileName}`,
              details: { fileName: entry.fileName },
            });
          }

          // Check 4: Dangerous file types
          if (this.isDangerousFile(entry.fileName)) {
            errors.push({
              key: ValidationErrorKey.ZIP_DANGEROUS_FILE,
              message: `Blocked file type: ${entry.fileName}`,
              details: { fileName: entry.fileName },
            });
          }

          // Check 5: Cleanable files (junk, security-sensitive, IDE config)
          // These files will be cleaned during import, not rejected
          if (codeSyncFileCleanupService.isCleanableFile(entry.fileName)) {
            cleanableFiles.push(entry.fileName);
          }

          // Check 6: Compression ratio (incremental check - EARLY ABORT)
          // Calculate cumulative compression ratio to detect zip bombs incrementally
          const currentRatio = totalCompressed > 0 ? totalUncompressed / totalCompressed : 0;
          if (currentRatio > limits.maxCompressionRatio) {
            errors.push({
              key: ValidationErrorKey.ZIP_BOMB_DETECTED,
              message: `Compression ratio ${currentRatio.toFixed(2)} exceeds limit of ${limits.maxCompressionRatio}`,
              details: {
                ratio: currentRatio,
                uncompressedSize: totalUncompressed,
                compressedSize: totalCompressed
              },
            });
            this.logger.error('zip-security.zip-bomb.detected', {
              zipPath,
              ratio: currentRatio,
              uncompressedSize: totalUncompressed,
              compressedSize: totalCompressed,
            });
            zipfile.close();
            // Resolve immediately on early abort
            resolve({
              valid: false,
              errors,
              stats: {
                fileCount,
                totalUncompressedSize: totalUncompressed,
                compressedSize,
                compressionRatio: currentRatio,
                ...(largestFile && { largestFile }),
              },
            });
            return;
          }

          // Check 7: File count limit (EARLY ABORT)
          if (fileCount > limits.maxFiles) {
            errors.push({
              key: ValidationErrorKey.ZIP_TOO_MANY_FILES,
              message: `File count ${fileCount} exceeds limit of ${limits.maxFiles}`,
              details: { fileCount, limit: limits.maxFiles },
            });
            zipfile.close();
            // Resolve immediately on early abort
            resolve({
              valid: false,
              errors,
              stats: {
                fileCount,
                totalUncompressedSize: totalUncompressed,
                compressedSize,
                compressionRatio: totalCompressed > 0 ? totalUncompressed / totalCompressed : 0,
                ...(largestFile && { largestFile }),
              },
            });
            return;
          }

          // Check 8: Total extracted size limit (EARLY ABORT)
          if (totalUncompressed > limits.maxExtractedSize) {
            errors.push({
              key: ValidationErrorKey.ZIP_EXTRACTED_TOO_LARGE,
              message: `Extracted size ${totalUncompressed} bytes exceeds limit`,
              details: {
                extractedSize: totalUncompressed,
                limit: limits.maxExtractedSize
              },
            });
            zipfile.close();
            // Resolve immediately on early abort
            resolve({
              valid: false,
              errors,
              stats: {
                fileCount,
                totalUncompressedSize: totalUncompressed,
                compressedSize,
                compressionRatio: compressedSize > 0 ? totalUncompressed / compressedSize : 0,
                ...(largestFile && { largestFile }),
              },
            });
            return;
          }

          // Continue to next entry
          zipfile.readEntry();
        });

        // All entries processed
        zipfile.on('end', () => {
          const stats: ZipValidationStats = {
            fileCount,
            totalUncompressedSize: totalUncompressed,
            compressedSize,
            compressionRatio: compressedSize > 0 ? totalUncompressed / compressedSize : 0,
            ...(largestFile && { largestFile }),
          };

          resolve({
            valid: errors.length === 0,
            errors,
            stats,
            cleanableFiles: cleanableFiles.length > 0 ? cleanableFiles : undefined,
          });
        });

        zipfile.on('error', (error) => {
          reject(error);
        });

        // Start reading first entry
        zipfile.readEntry();
      });
    });
  }

  /**
   * Check for path traversal attempts
   */
  private checkPathTraversal(fileName: string): ValidationError | null {
    // Check for .. sequences
    if (fileName.includes('..')) {
      return {
        key: ValidationErrorKey.ZIP_PATH_TRAVERSAL,
        message: `Path traversal detected: ${fileName}`,
        details: { fileName, pattern: '..' },
      };
    }

    // Check for absolute paths
    if (fileName.startsWith('/') || /^[a-zA-Z]:/.test(fileName)) {
      return {
        key: ValidationErrorKey.ZIP_PATH_TRAVERSAL,
        message: `Absolute path detected: ${fileName}`,
        details: { fileName, pattern: 'absolute' },
      };
    }

    // Check for null bytes
    if (fileName.includes('\0')) {
      return {
        key: ValidationErrorKey.ZIP_INVALID_FILENAME,
        message: `Null byte in filename: ${fileName}`,
        details: { fileName },
      };
    }

    return null;
  }

  /**
   * Validate filename for control characters and length
   */
  private validateFilename(fileName: string): ValidationError | null {
    const limits = getZipImportLimits();

    // Check path length
    if (fileName.length > limits.maxPathLength) {
      return {
        key: ValidationErrorKey.ZIP_PATH_TOO_LONG,
        message: `Path exceeds maximum length: ${fileName}`,
        details: { length: fileName.length, limit: limits.maxPathLength },
      };
    }

    // Check for control characters in the C0 range (\x00-\x1f)
    // This regex explicitly excludes:
    // - \x09 (tab) - allowed as it's commonly used in some file systems
    // - \x0a (line feed) and \x0d (carriage return) - excluded from the range
    // All other C0 control characters are rejected as they can cause issues with:
    // - Terminal output and logging
    // - Shell command execution
    // - Filename spoofing attacks
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0b-\x0c\x0e-\x1f]/.test(fileName)) {
      return {
        key: ValidationErrorKey.ZIP_INVALID_FILENAME,
        message: `Invalid control characters in filename: ${fileName}`,
        details: { fileName },
      };
    }

    return null;
  }

  /**
   * Detect symlinks via Unix external file attributes
   */
  private isSymlink(entry: yauzl.Entry): boolean {
    const attr = entry.externalFileAttributes;
    if (attr) {
      // Check Unix file mode (upper 16 bits)
      const mode = (attr >> 16) & UNIX_MODE_MASK;
      // Check if file type is symlink
      return (mode & S_IFLNK) === S_IFLNK;
    }
    return false;
  }

  /**
   * Check for dangerous file types
   */
  private isDangerousFile(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    const limits = getZipImportLimits();
    return limits.blockedExtensions.some(ext => lower.endsWith(ext));
  }

  /**
   * Validate zip format by checking magic bytes
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
