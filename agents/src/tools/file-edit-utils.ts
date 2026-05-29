import { resolve, relative, basename } from 'path';
import type { FileSystemOperations } from '../filesystem/index.js';
import { defaultLocalFs } from '../filesystem/index.js';
import { translateDockerPath, deriveAssetsDir, validateNoEscapingSymlinks } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { fileUploadService } from '../services/FileUploadService.js';
import { isSourceFile, BINARY_FILE_REGEX } from '../utils/file-types.js';
import type { WorkspaceFiles } from '../workspace/files.js';

const PROTECTED_PATH_PREFIXES = ['.airo'];

export function isProtectedWorkspacePath(filePath: string, appPath: string): boolean {
  const normalizedApp = resolve(appPath);
  for (const prefix of PROTECTED_PATH_PREFIXES) {
    const protectedDir = resolve(normalizedApp, prefix);
    if (filePath === protectedDir || filePath.startsWith(protectedDir + '/')) {
      return true;
    }
  }
  return false;
}

export async function isFileImmutable(filePath: string, fsOps: FileSystemOperations = defaultLocalFs): Promise<boolean> {
  // No outer catch — EACCES/EPERM must surface so the caller sees a permission
  // error instead of silently treating a protected file as mutable (which would
  // bypass the "TREAT AS IMMUTABLE" guard). fsOps.exists() only returns false
  // for ENOENT; other errors propagate.
  if (!(await fsOps.exists(filePath))) {
    return false;
  }

  const buffer = Buffer.alloc(500);
  const fd = await fsOps.open(filePath, 'r');
  try {
    const { bytesRead } = await fd.read(buffer, 0, 500, 0);
    const firstLine = buffer.toString('utf-8', 0, bytesRead).split('\n')[0] ?? '';
    return firstLine.includes('TREAT AS IMMUTABLE');
  } finally {
    await fd.close();
  }
}

export function validateNoApiPaths(content: string, filePath: string): { valid: boolean; error?: string } {
  if (!isSourceFile(filePath)) {
    return { valid: true };
  }

  if (content.includes('/api/files/') || content.includes('/files/uploads/')) {
    return {
      valid: false,
      error: `FORBIDDEN: Cannot write upload URLs to source code. These are temporary URLs that will break in production.

The content you're trying to write contains upload URLs.

REQUIRED WORKFLOW for uploaded files:
1. FIRST: Copy file to project (e.g., create new file at "public/assets/image.png")

2. THEN: Reference with project-relative path
   Example: <img src="/assets/image.png" />

DO NOT use upload URLs in source code - they are temporary and will not work in production.`
    };
  }

  return { valid: true };
}

export function resolveFilePath(appPath: string, relativePath: string): string {
  const normalizedPath = translateDockerPath(relativePath);
  const resolved = resolve(appPath, normalizedPath);

  const rel = relative(appPath, resolved);
  if (rel.startsWith('..') || resolve(appPath) === resolved.slice(0, -1)) {
    throw new Error(`File path must be within the app directory. Resolved: ${resolved}, App path: ${appPath}`);
  }

  const assetsDir = deriveAssetsDir(appPath);
  validateNoEscapingSymlinks(resolved, appPath, assetsDir ? [assetsDir] : []);

  return resolved;
}

export async function resolveSourceFile(
  appId: string,
  targetPath: string,
  content: string,
  files: WorkspaceFiles,
  fsOps: FileSystemOperations = defaultLocalFs
): Promise<{ content: string; binaryCopied?: boolean } | null> {
  try {
    const filename = basename(targetPath);

    if (content !== '') {
      return null;
    }

    const match = await fileUploadService.findMatchingUpload(appId, filename);

    if (!match) {
      logger.debug('file-edit.auto-resolve.no-match', { appId, filename });
      return null;
    }

    const { file: matchingFile, sourcePath } = match;
    const isBinary = BINARY_FILE_REGEX.test(filename) && !filename.toLowerCase().endsWith('.svg');

    if (isBinary) {
      const data = await fsOps.readFile(sourcePath) as Buffer;
      await files.upload({ path: targetPath, data });

      logger.info('file-edit.auto-resolved', {
        appId,
        filename,
        originalName: matchingFile.originalName,
        from: sourcePath,
        size: matchingFile.size,
        binary: true
      });

      return { content: '', binaryCopied: true };
    }

    logger.info('file-edit.auto-resolved', {
      appId,
      filename,
      originalName: matchingFile.originalName,
      from: sourcePath,
      size: matchingFile.size
    });

    return { content: await fsOps.readFile(sourcePath, 'utf-8') };
  } catch (error) {
    logger.error('file-edit.auto-resolve.error', {
      appId,
      targetPath,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}
