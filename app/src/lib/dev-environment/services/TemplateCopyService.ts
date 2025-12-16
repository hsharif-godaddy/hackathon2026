import { execa } from 'execa';
/**
 * TemplateCopyService handles all template-related operations
 * including template resolution, copying, and validation.
 *
 * This service is responsible for:
 * - Resolving template paths from environment configuration
 * - Copying template directories to app destinations
 * - Validating copied templates to ensure integrity
 * - Cleaning up failed copies
 */
import { cpSync, existsSync, rmSync } from 'fs';
import path from 'path';

import { logger } from '../../request-context';
import { createSafePathBuilder, isSafePath,safeJoinWithOptions, safeResolve } from '../utils/safe-path';

/** Default template directory when none is specified in environment or parameters */
const DEFAULT_TEMPLATE_DIR = 'app-templates/v8';

export interface TemplateCopyOptions {
  appId: string;
  appPath: string;
  appName: string;
  templateDir?: string; // Optional override for template directory
}

export interface TemplateCopyResult {
  templateVersion: string;
  templatePath: string;
  success: boolean;
}

export interface TemplateValidationError extends Error {
  code: 'TEMPLATE_NOT_FOUND' | 'COPY_FAILED' | 'VALIDATION_FAILED';
  templatePath?: string;
  validationDetails?: string[];
}

/**
 * Service for handling template copying operations
 */
export class TemplateCopyService {
  /**
   * Copy template to app directory with full validation
   */
  async copyTemplate(options: TemplateCopyOptions): Promise<TemplateCopyResult> {
    const { appId, appPath, templateDir } = options;

    try {
      // Resolve template path
      const { templatePath, templateVersion } = this.resolveTemplatePath(templateDir);

      logger.info(`📋 Copying template ${templateVersion} for app ${appId}`);

      // Validate template exists
      if (!existsSync(templatePath)) {
        const error = new Error(`Template directory not found: ${templatePath}`) as TemplateValidationError;
        error.code = 'TEMPLATE_NOT_FOUND';
        error.templatePath = templatePath;
        throw error;
      }

      logger.info(`📂 Starting template copy: ${templatePath} → ${appPath}`);

      try {
        // Create app directory if it doesn't exist
        await this.ensureAppDirectory(appPath);

        // Perform the actual copy
        this.performTemplateCopy(templatePath, appPath);

        // Note: dev-supervisor binary is copied from pre-built image in Dockerfile
        // No need to copy source code to app directory (saves ~168 files from bind mount)

        // Validate the copied template
        this.validateCopiedTemplate(appPath);

        logger.info(`✅ Template copied successfully for app ${appId}`);

        return {
          templateVersion,
          templatePath,
          success: true
        };

      } catch (copyError) {
        logger.error(`❌ Template copy failed for app ${appId}:`, copyError);

        // Clean up failed copy
        await this.cleanupFailedCopy(appId, appPath);

        const error = new Error(`Template copying failed: ${copyError instanceof Error ? copyError.message : String(copyError)}`) as TemplateValidationError;
        error.code = 'COPY_FAILED';
        error.templatePath = templatePath;
        throw error;
      }

    } catch (error) {
      // Clean up on any error
      await this.cleanupFailedCopy(appId, appPath);
      throw error;
    }
  }

  /**
   * Resolve template path from configuration
   */
  private resolveTemplatePath(templateDir?: string): { templatePath: string; templateVersion: string } {
    // Get template directory from parameter or environment variable, default to constant
    const configuredTemplateDir = templateDir || process.env.APP_TEMPLATE_DIR || DEFAULT_TEMPLATE_DIR;

    // Calculate template path - ensure we're looking in the correct project directory
    let templatePath: string;
    if (path.isAbsolute(configuredTemplateDir)) {
      // For absolute paths, validate they're within reasonable bounds
      // Allow absolute paths but ensure they exist and are readable
      templatePath = safeResolve('/', configuredTemplateDir, {
        allowAbsolute: true,
        allowTraversal: true
      });
    } else {
      const currentDir = process.cwd();

      // Handle relative paths properly using safe path operations
      if (configuredTemplateDir.startsWith('../')) {
        // If template dir starts with ../, resolve it relative to current directory
        templatePath = safeResolve(currentDir, configuredTemplateDir, {
          allowTraversal: true
        });
      } else {
        // Otherwise, resolve it relative to project root (one level up from app)
        const projectRoot = path.dirname(currentDir);
        templatePath = safeJoinWithOptions(projectRoot, [configuredTemplateDir], {});
      }
    }

    // Template version is always v8
    const templateVersion = 'v8';

    return { templatePath, templateVersion };
  }

  /**
   * Force remove directory with permission fixing
   */
  private async forceRemoveDirectory(dirPath: string): Promise<void> {
    // Validate path to prevent directory traversal attacks
    // dirPath should be an absolute path within /tmp/apps
    const normalizedPath = path.resolve(dirPath);
    const appsBaseDir = path.resolve('/tmp/apps');

    // Check if path is safe - must be within /tmp/apps and not contain traversal sequences
    if (!isSafePath(normalizedPath, appsBaseDir, { allowTraversal: false })) {
      const error = new Error(`Invalid directory path: ${dirPath} is outside allowed base directory ${appsBaseDir}`);
      logger.error(`❌ Path validation failed for directory removal: ${error.message}`);
      throw error;
    }

    // Additional check: ensure the normalized path doesn't contain .. sequences
    if (normalizedPath.includes('..')) {
      const error = new Error(`Invalid directory path: ${dirPath} contains directory traversal sequences`);
      logger.error(`❌ Path validation failed: ${error.message}`);
      throw error;
    }

    try {
      // Use system commands for more robust removal
      // This handles Git objects and other stubborn files better
      if (process.platform === 'win32') {
        // Windows: Use rmdir /s /q and handle readonly files
        await execa('rmdir', ['/s', '/q', normalizedPath], { reject: false });
      } else {
        // Unix/Linux: Use chmod to fix permissions, then rm
        await execa('chmod', ['-R', '755', normalizedPath], { reject: false });
        await execa('rm', ['-rf', normalizedPath], { reject: false });
      }

      logger.info(`🧹 Force cleanup succeeded for: ${dirPath}`);
    } catch (error: any) {
      logger.error(`❌ System-level cleanup failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure app directory exists
   */
  private async ensureAppDirectory(appPath: string): Promise<void> {
    if (existsSync(appPath)) {
      logger.info(`📁 App directory already exists, removing: ${appPath}`);

      try {
        // First attempt: standard removal
        rmSync(appPath, { recursive: true, force: true });
      } catch (error: any) {
        logger.warn(`⚠️ Standard cleanup failed, trying force cleanup: ${error.message}`);

        try {
          // Second attempt: Try to fix permissions first, then remove
          await this.forceRemoveDirectory(appPath);
        } catch (forceError: any) {
          logger.error(`❌ Force cleanup also failed: ${forceError.message}`);
          throw new Error(`Cannot remove existing app directory: ${appPath}. ${forceError.message}`);
        }
      }
    }

    // Create parent directories if needed
    const parentDir = path.dirname(appPath);
    if (!existsSync(parentDir)) {
      logger.info(`📁 Creating parent directory: ${parentDir}`);
    }
  }

  /**
   * Perform the actual file copying with filtering
   */
  private performTemplateCopy(templatePath: string, appPath: string): void {
    cpSync(templatePath, appPath, {
      recursive: true,
      filter: (src, _dest) => {
        // Use safe path operations to get relative path
        try {
          // Validate that src is within template directory
          const relativePath = path.relative(templatePath, src);

          // Additional safety check - ensure the source path is actually within template
          if (relativePath.startsWith('..')) {
            return false; // Skip files outside template directory
          }

          // Skip node_modules and other build/cache directories
          if (relativePath.includes('node_modules') ||
              relativePath.includes('dist') ||
              relativePath.includes('.next') ||
              relativePath.includes('.vite') ||
              relativePath.includes('.cache') ||
              relativePath.includes('coverage') ||
              relativePath.includes('logs') ||
              relativePath.endsWith('.log') ||
              relativePath.includes('.dev-ports.json') ||
              relativePath.startsWith('dev-supervisor') ||
              relativePath.includes('.git/')) {
            return false;
          }

          return true;
        } catch {
          // If any path operation fails, skip the file for safety
          return false;
        }
      }
    });
  }

  /**
   * Validate that the template was copied correctly
   */
  private validateCopiedTemplate(appPath: string): void {
    const validationErrors: string[] = [];

    // Create a safe path builder for the app directory
    const appPathBuilder = createSafePathBuilder(appPath);

    // Check for essential files
    const templatePackageJson = appPathBuilder.join('package.json');
    const templateSrcDir = appPathBuilder.join('src');

    if (!existsSync(templatePackageJson)) {
      validationErrors.push(`Template package.json was not copied to ${templatePackageJson}`);
    }

    if (!existsSync(templateSrcDir)) {
      validationErrors.push(`Template src directory was not copied to ${templateSrcDir}`);
    }

    if (validationErrors.length > 0) {
      const error = new Error(`Template validation failed: ${validationErrors.join('; ')}`) as TemplateValidationError;
      error.code = 'VALIDATION_FAILED';
      error.validationDetails = validationErrors;
      throw error;
    }
  }

  /**
   * Clean up a failed copy attempt
   */
  private async cleanupFailedCopy(appId: string, appPath: string): Promise<void> {
    try {
      if (existsSync(appPath)) {
        rmSync(appPath, { recursive: true, force: true });
        logger.info(`🧹 Cleaned up failed copy for app ${appId}: ${appPath}`);
      }
    } catch (cleanupError) {
      logger.error(`❌ Cleanup failed for app ${appId}:`, cleanupError);
      // Don't rethrow cleanup errors - log and continue
    }
  }

  /**
   * Get template information without copying
   */
  getTemplateInfo(templateDir?: string): { templatePath: string; templateVersion: string; exists: boolean } {
    const { templatePath, templateVersion } = this.resolveTemplatePath(templateDir);
    const exists = existsSync(templatePath);

    return {
      templatePath,
      templateVersion,
      exists
    };
  }

  /**
   * Validate template directory exists and has required structure
   */
  validateTemplateStructure(templateDir?: string): { valid: boolean; errors: string[] } {
    const { templatePath } = this.resolveTemplatePath(templateDir);
    const errors: string[] = [];

    if (!existsSync(templatePath)) {
      errors.push(`Template directory does not exist: ${templatePath}`);
      return { valid: false, errors };
    }

    // Create a safe path builder for the template directory
    const templatePathBuilder = createSafePathBuilder(templatePath);

    // Check for required files in template
    const requiredFiles = [
      'package.json',
      'src'
    ];

    for (const file of requiredFiles) {
      const filePath = templatePathBuilder.join(file);
      if (!existsSync(filePath)) {
        errors.push(`Required template file/directory missing: ${file}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Copy dev-supervisor source code to app directory for Docker builds
   */
  private copyDevSupervisorBinary(appPath: string, appId: string): void {
    try {
      // Find the dev-supervisor source directory in the project root
      const projectRoot = path.resolve(process.cwd(), '..');
      const devSupervisorSourcePath = path.join(projectRoot, 'dev-supervisor');

      if (!existsSync(devSupervisorSourcePath)) {
        logger.info(`⚠️ dev-supervisor source directory not found for app ${appId}, Docker build may fail`);
        return;
      }

      // Create dev-supervisor directory in app and copy source code
      const appDevSupervisorPath = path.join(appPath, 'dev-supervisor');

      // Copy the entire dev-supervisor source directory
      cpSync(devSupervisorSourcePath, appDevSupervisorPath, {
        recursive: true,
        force: true,
        filter: (src, _dest) => {
          // Skip build artifacts and git directories
          const relativePath = path.relative(devSupervisorSourcePath, src);
          if (relativePath.includes('dist') ||
              relativePath.includes('.git') ||
              relativePath.includes('node_modules')) {
            return false;
          }
          return true;
        }
      });

      logger.info(`📦 Copied dev-supervisor source code for app ${appId}`);

    } catch (error) {
      logger.warn(`⚠️ Failed to copy dev-supervisor source code for app ${appId}:`, error);
    }
  }
}
