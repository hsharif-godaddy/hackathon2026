/**
 * Import Types
 *
 * TypeScript interfaces for the zip import feature.
 * These types define the structure for import jobs, validation errors,
 * and related data used throughout the import process.
 */

/**
 * Status values for import jobs
 */
export enum ImportJobStatus {
  PENDING = 'pending',
  CREATING_CONTAINER = 'creating_container',
  EXTRACTING = 'extracting',
  VALIDATING = 'validating',
  COPYING = 'copying',
  INSTALLING = 'installing',
  BUILDING = 'building',
  COMMITTING = 'committing',
  RESTARTING = 'restarting',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Validation error keys for frontend handling
 * Each key represents a specific validation failure that can occur during import
 */
export enum ValidationErrorKey {
  // Zip file errors
  ZIP_EMPTY = 'ZIP_EMPTY',
  ZIP_CORRUPTED = 'ZIP_CORRUPTED',
  ZIP_TOO_LARGE = 'ZIP_TOO_LARGE',
  ZIP_INVALID_FORMAT = 'ZIP_INVALID_FORMAT',
  ZIP_PATH_TRAVERSAL = 'ZIP_PATH_TRAVERSAL',
  ZIP_BOMB_DETECTED = 'ZIP_BOMB_DETECTED',
  ZIP_SYMLINK_FOUND = 'ZIP_SYMLINK_FOUND',
  ZIP_TOO_MANY_FILES = 'ZIP_TOO_MANY_FILES',
  ZIP_EXTRACTED_TOO_LARGE = 'ZIP_EXTRACTED_TOO_LARGE',
  ZIP_DANGEROUS_FILE = 'ZIP_DANGEROUS_FILE',
  ZIP_SUSPICIOUS_FILE = 'ZIP_SUSPICIOUS_FILE',
  ZIP_INVALID_FILENAME = 'ZIP_INVALID_FILENAME',
  ZIP_PATH_TOO_LONG = 'ZIP_PATH_TOO_LONG',
  // Project structure errors
  PACKAGE_JSON_NOT_FOUND = 'PACKAGE_JSON_NOT_FOUND',
  PACKAGE_JSON_INVALID = 'PACKAGE_JSON_INVALID',
  PACKAGE_JSON_MISSING_NAME = 'PACKAGE_JSON_MISSING_NAME',
  NOT_NODE_PROJECT = 'NOT_NODE_PROJECT',
  NOT_VITE_PROJECT = 'NOT_VITE_PROJECT',
  // Script warnings (non-fatal)
  NO_DEV_SCRIPT = 'NO_DEV_SCRIPT',
  NO_BUILD_SCRIPT = 'NO_BUILD_SCRIPT',
  // Install/Build errors
  INSTALL_FAILED = 'INSTALL_FAILED',
  INSTALL_TIMEOUT = 'INSTALL_TIMEOUT',
  BUILD_FAILED = 'BUILD_FAILED',
  BUILD_TIMEOUT = 'BUILD_TIMEOUT',
  // System errors
  CONTAINER_CREATION_FAILED = 'CONTAINER_CREATION_FAILED',
  CONTAINER_NOT_READY = 'CONTAINER_NOT_READY',
  GIT_COMMIT_FAILED = 'GIT_COMMIT_FAILED',
  DEV_SERVER_START_FAILED = 'DEV_SERVER_START_FAILED',
  COPY_FAILED = 'COPY_FAILED',
  CLEANUP_FAILED = 'CLEANUP_FAILED',
  // Git clone errors
  GIT_URL_INVALID = 'GIT_URL_INVALID',
  GIT_URL_UNSUPPORTED = 'GIT_URL_UNSUPPORTED',
  GIT_CLONE_FAILED = 'GIT_CLONE_FAILED',
  GIT_CLONE_TIMEOUT = 'GIT_CLONE_TIMEOUT',
  GIT_AUTH_FAILED = 'GIT_AUTH_FAILED',
  GIT_REPO_NOT_FOUND = 'GIT_REPO_NOT_FOUND',
  GIT_REPO_TOO_LARGE = 'GIT_REPO_TOO_LARGE',
}

/**
 * Structured validation error with unique key for frontend handling
 */
export interface ValidationError {
  /** Unique key identifying the error type */
  key: ValidationErrorKey;
  /** Human-readable error message */
  message: string;
  /** Additional details about the error */
  details?: Record<string, unknown>;
}

/**
 * Import job record stored in the database
 */
export interface ImportJob {
  /** Unique identifier for the import job */
  id: string;
  /** ID of the app being imported to */
  appId: string;
  /** Current status of the import job */
  status: ImportJobStatus;
  /** Source type for the import (zip or git) */
  sourceType: 'zip' | 'git';
  /** Original filename of the uploaded zip (for zip imports only) */
  zipFileName?: string;
  /** Size of the uploaded zip in bytes (for zip imports only) */
  zipFileSize?: number;
  /** Git repository URL (for git imports) */
  gitUrl?: string;
  /** Git branch name (for git imports) */
  gitBranch?: string;
  /** Git commit hash that was cloned (for git imports) */
  gitCommitHash?: string;
  /** Path where zip was extracted (temporary) */
  extractedPath?: string;
  /** Detected package manager (npm, yarn, pnpm) */
  detectedPackageManager?: 'npm' | 'yarn' | 'pnpm';
  /** Whether the project has a build script */
  hasBuildScript?: boolean;
  /** Whether the project has a dev script */
  hasDevScript?: boolean;
  /** JSON array of validation errors */
  validationErrors?: string;
  /** Output from npm install */
  installOutput?: string;
  /** Output from npm run build */
  buildOutput?: string;
  /** Error message if failed */
  errorMessage?: string;
  /** Stage where the error occurred */
  errorStage?: string;
  /** When the import processing started */
  startedAt?: Date;
  /** When the import completed (success or failure) */
  completedAt?: Date;
  /** When the job was created */
  createdAt: Date;
  /** When the job was last updated */
  updatedAt: Date;
}

/**
 * Request payload for creating an import from zip
 */
export interface CreateImportRequest {
  /** Name for the new app */
  name: string;
  /** The uploaded zip file (handled by multer) */
  zipFile?: Express.Multer.File;
}

/**
 * Response from creating an import
 */
export interface CreateImportResponse {
  /** Whether the request was successful */
  success: boolean;
  /** ID of the created app */
  appId?: string;
  /** ID of the import job */
  importJobId?: string;
  /** Current status */
  status?: ImportJobStatus;
  /** Source type (zip or git) */
  sourceType?: 'zip' | 'git';
  /** Error message if failed */
  error?: string;
  /** Validation errors */
  validationErrors?: Pick<ValidationError, 'key' | 'message'>[];
  /** ID of existing job (for 409 conflict) */
  existingJobId?: string;
}

/**
 * Progress information for import status
 */
export interface ImportProgress {
  /** Current stage name */
  stage: ImportJobStatus;
  /** Stage number (1-based), omitted for failed status */
  stageNumber?: number;
  /** Human-readable progress message */
  message: string;
}

/**
 * Response from import status endpoint
 *
 * Note: Sensitive fields (installOutput, buildOutput, errorMessage, validation details)
 * are stored in the database for debugging but NOT returned in API responses for security.
 */
export interface ImportStatusResponse {
  /** Import job ID */
  jobId: string;
  /** App ID */
  appId: string;
  /** Current status */
  status: ImportJobStatus;
  /** Progress information */
  progress?: ImportProgress;
  /** Validation errors (key + message only, details stripped for security) */
  validationErrors?: Pick<ValidationError, 'key' | 'message'>[];
  /** Non-fatal warnings (key + message only) */
  warnings?: Pick<ValidationError, 'key' | 'message'>[];
  /** Preview URL when completed */
  previewUrl?: string | null;
  /** Stage where error occurred */
  errorStage?: string;
  /** When job was created */
  createdAt?: string;
  /** When job was last updated */
  updatedAt?: string;
}

/**
 * Result from zip extraction
 */
export interface ZipExtractionResult {
  /** Whether extraction was successful */
  success: boolean;
  /** Path where files were extracted */
  extractedPath?: string;
  /** Total size of extracted files */
  totalSize?: number;
  /** Number of files extracted */
  fileCount?: number;
  /** Validation errors if extraction failed */
  errors?: ValidationError[];
}

/**
 * Result from project validation
 */
export interface ProjectValidationResult {
  /** Whether the project is valid */
  valid: boolean;
  /** Path to package.json (relative to extracted root) */
  packageJsonPath?: string;
  /** Detected package manager */
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  /** Whether build script exists */
  hasBuildScript?: boolean;
  /** Whether dev script exists */
  hasDevScript?: boolean;
  /** Project name from package.json */
  projectName?: string;
  /** Validation errors */
  errors?: ValidationError[];
  /** Non-fatal warnings */
  warnings?: ValidationError[];
}

/**
 * Statistics from zip validation inspection
 */
export interface ZipValidationStats {
  /** Total number of files in the zip */
  fileCount: number;
  /** Total uncompressed size of all files (from metadata, not extraction) */
  totalUncompressedSize: number;
  /** Compressed size of the zip file */
  compressedSize: number;
  /** Compression ratio (uncompressed / compressed) */
  compressionRatio: number;
  /** Information about the largest file in the archive */
  largestFile?: {
    name: string;
    size: number;
  };
}

/**
 * Result from zip security validation
 */
export interface ZipValidationResult {
  /** Whether the zip passed all security checks */
  valid: boolean;
  /** Validation errors encountered */
  errors: ValidationError[];
  /** Statistics about the zip file (undefined if validation failed early) */
  stats?: ZipValidationStats;
}


