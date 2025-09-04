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
import { extractTemplateVersion } from '../utils/template-version.js';
import { appTemplateEvents, appDirectoryEvents } from '../logging/events/index.js';
import type { Logger } from '../logging/index.js';
import { safeJoinWithOptions, safeResolve, createSafePathBuilder } from '../utils/safe-path.js';

/** Default template directory when none is specified in environment or parameters */
const DEFAULT_TEMPLATE_DIR = 'app-templates/v3';

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
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Copy template to app directory with full validation
   */
  async copyTemplate(options: TemplateCopyOptions): Promise<TemplateCopyResult> {
    const { appId, appPath, appName, templateDir } = options;
    const appLogger = this.logger.child({ appId, appName });

    try {
      // Resolve template path
      const { templatePath, templateVersion } = this.resolveTemplatePath(templateDir);

      // Log template resolution
      appTemplateEvents.resolveSuccess(this.logger, {
        appId,
        templateVersion,
        operation: 'resolve' as const,
        path: templatePath,
        templatePath
      });

      // Validate template exists
      if (!existsSync(templatePath)) {
        const error = new Error(`Template directory not found: ${templatePath}`) as TemplateValidationError;
        error.code = 'TEMPLATE_NOT_FOUND';
        error.templatePath = templatePath;
        throw error;
      }

      // Begin copy operation
      appTemplateEvents.copyBegin(appLogger, {
        appId,
        templateVersion,
        operation: 'copy' as const,
        path: appPath,
        templatePath
      });

      try {
        // Perform the actual copy
        this.performTemplateCopy(templatePath, appPath);

        // Copy dev-supervisor binary for Docker mode
        this.copyDevSupervisorBinary(appPath, appId, appLogger);

        // Validate the copied template
        this.validateCopiedTemplate(appPath, templateVersion);

        // Log success
        appTemplateEvents.copySuccess(appLogger, {
          appId,
          templateVersion,
          operation: 'copy' as const,
          path: appPath,
          templatePath
        });

        return {
          templateVersion,
          templatePath,
          success: true
        };

      } catch (copyError) {
        // Log copy failure
        appTemplateEvents.copyFailure(appLogger, copyError as Error, {
          appId,
          templateVersion,
          operation: 'copy' as const,
          path: appPath,
          templatePath
        });

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
        // Otherwise, resolve it relative to project root (one level up from agents)
        const projectRoot = path.dirname(currentDir);
        templatePath = safeJoinWithOptions(projectRoot, [configuredTemplateDir], {});
      }
    }
    
    // Extract template version from template directory
    const templateVersion = extractTemplateVersion(configuredTemplateDir);
    
    return { templatePath, templateVersion };
  }

  /**
   * Perform the actual file copying with filtering
   */
  private performTemplateCopy(templatePath: string, appPath: string): void {
    // Create safe path builders for validation (currently unused)
    // const templatePathBuilder = createSafePathBuilder(templatePath);
    // const appPathBuilder = createSafePathBuilder(appPath);

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
              relativePath.includes('.dev-ports.json')) {
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
  private validateCopiedTemplate(appPath: string, templateVersion: string): void {
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
    
    // Additional validation for v3 template structure
    if (templateVersion === 'v3') {
      const frontendDir = appPathBuilder.join('src', 'frontend');
      const backendDir = appPathBuilder.join('src', 'backend');
      
      if (!existsSync(frontendDir)) {
        validationErrors.push(`V3 template frontend directory was not copied to ${frontendDir}`);
      }
      
      if (!existsSync(backendDir)) {
        validationErrors.push(`V3 template backend directory was not copied to ${backendDir}`);
      }
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
        appDirectoryEvents.cleanupSuccess(this.logger, {
          appId,
          path: appPath,
          permissions: '',
          parentExists: false
        });
      }
    } catch (cleanupError) {
      appDirectoryEvents.createFailure(this.logger, cleanupError as Error, {
        appId,
        path: appPath
      });
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
  private copyDevSupervisorBinary(appPath: string, appId: string, appLogger: Logger): void {
    try {
      // Find the dev-supervisor source directory in the project root
      const projectRoot = path.resolve(process.cwd(), '..');
      const devSupervisorSourcePath = path.join(projectRoot, 'dev-supervisor');
      
      if (!existsSync(devSupervisorSourcePath)) {
        appLogger.warn('app.template.dev_supervisor.not_found', {
          appId,
          expectedPath: devSupervisorSourcePath,
          message: 'dev-supervisor source directory not found, Docker build may fail'
        });
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

      appLogger.info('app.template.dev_supervisor.copied', {
        appId,
        sourcePath: devSupervisorSourcePath,
        destPath: appDevSupervisorPath,
        type: 'source_code'
      });

    } catch (error) {
      appLogger.warn('app.template.dev_supervisor.copy_failed', {
        appId,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to copy dev-supervisor source code, Docker build may fail'
      });
    }
  }
}