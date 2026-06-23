import { resolve, relative, basename } from 'path';
import { readFile } from 'node:fs/promises';
import { translateDockerPath, deriveAssetsDir, validateNoEscapingSymlinks } from '../utils/path-helper.js';
import { logger } from '../logging/index.js';
import { fileUploadService } from '../services/FileUploadService.js';
import { isSourceFile, BINARY_FILE_REGEX, IMAGE_FILE_REGEX } from '../utils/file-types.js';
import { markUploadsPlaced } from '../services/renderers/upload-classification-persistence.js';
import { isDevSupervisorNotFound } from '../services/DevSupervisorClient.js';
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

async function workspaceFileExists(files: WorkspaceFiles, path: string): Promise<boolean> {
  try {
    await files.view({ path, limit: 1 });
    return true;
  } catch (err) {
    // Only a genuine not-found means "does not exist". A transient/unknown error
    // must fail SAFE toward "exists" — otherwise a flaky read would let the
    // image fallback (or the catch's empty write) clobber a file that is
    // actually there, the very "wrong image over existing file" hazard we guard.
    if (isDevSupervisorNotFound(err)) {
      return false;
    }
    logger.debug('file-edit.exists-check.ambiguous', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

export async function resolveSourceFile(
  appId: string,
  targetPath: string,
  content: string,
  files: WorkspaceFiles
): Promise<{ content: string; binaryCopied?: boolean; uploadIdentity?: { storedFilename: string; fileName: string } } | { skip: true; reason: 'no-upload' | 'copy-error' } | null> {
  if (content !== '') {
    return null;
  }
  const filename: string = basename(targetPath);
  // Whether the target already has bytes on disk. Used both to refuse the
  // rename-tolerant fallback over an existing file and to avoid emptying an
  // existing file if the copy errors mid-way.
  const targetExists: boolean = await workspaceFileExists(files, targetPath);

  try {
    const exactMatch: Awaited<ReturnType<typeof fileUploadService.findMatchingUpload>> =
      await fileUploadService.findMatchingUpload(appId, filename);

    // Rename-tolerant fallback: agents routinely create the upload under a
    // tidied name (e.g. logo.png) that no longer matches the stored filename, so
    // an exact-name lookup misses and the file is left empty → broken <img>.
    // CRITICAL: only rescue a file that does NOT already exist. Guess-filling an
    // EXISTING file could overwrite the right image with the wrong (newest)
    // upload — e.g. re-creating logo.png on a turn where a background was just
    // uploaded. In that case preserve the existing file instead.
    const fallbackEligible: boolean = !exactMatch && IMAGE_FILE_REGEX.test(filename);
    if (fallbackEligible && targetExists) {
      logger.debug('file-edit.auto-resolve.preserve-existing', { appId, filename });
      return { skip: true, reason: 'no-upload' };
    }
    const match: Awaited<ReturnType<typeof fileUploadService.findMatchingUpload>> =
      exactMatch ?? (fallbackEligible ? await fileUploadService.findLatestImageUpload(appId) : null);

    if (!match) {
      logger.debug('file-edit.auto-resolve.no-match', { appId, filename });
      return null;
    }
    if (!exactMatch) {
      logger.info('file-edit.auto-resolve.image-fallback', {
        appId,
        filename,
        resolvedFrom: match.file.originalName,
      });
    }

    const { file: matchingFile, sourcePath } = match;
    const isBinary: boolean = BINARY_FILE_REGEX.test(filename) && !filename.toLowerCase().endsWith('.svg');

    // sourcePath points at the agent's host-side upload staging area, not
    // the preview workspace — read it directly with fs/promises.
    if (isBinary) {
      const data: Buffer = await readFile(sourcePath);
      await files.upload({ path: targetPath, data });
      // Mark placed after the binary write lands (files.upload is the write).
      // Text/SVG writes happen in the caller after we return; uploadIdentity is
      // returned so the caller marks placed after handleCreate succeeds.
      await markUploadsPlaced({ appId, storedFilename: matchingFile.filename, fileName: matchingFile.originalName }).catch(() => false);
    } else {
      const fileContent: string = await readFile(sourcePath, 'utf-8');

      logger.info('file-edit.auto-resolved', {
        appId,
        filename,
        originalName: matchingFile.originalName,
        from: sourcePath,
        size: matchingFile.size,
        binary: false,
      });

      // Return the upload identity so the caller (text-editor.ts) can call
      // markUploadsPlaced AFTER handleCreate succeeds. This avoids both:
      // (a) the premature-mark bug (marking before the write, so a failed write
      //     would suppress re-injection even though the file never landed), AND
      // (b) the SVG-logo re-injection bug (never marking for non-binary files,
      //     keeping entry.placed=false forever and re-injecting every turn).
      return {
        content: fileContent,
        uploadIdentity: { storedFilename: matchingFile.filename, fileName: matchingFile.originalName },
      };
    }

    logger.info('file-edit.auto-resolved', {
      appId,
      filename,
      originalName: matchingFile.originalName,
      from: sourcePath,
      size: matchingFile.size,
      binary: true,
    });

    return { content: '', binaryCopied: true };
  } catch (error) {
    logger.error('file-edit.auto-resolve.error', {
      appId,
      targetPath,
      error: error instanceof Error ? error.message : String(error)
    });
    // A throw inside the try means something failed during the copy attempt —
    // either the lookup threw or the read/write threw after a match was found.
    // In BOTH cases, return a retryable signal rather than null:
    // null would cause handleCreate to write an empty file, producing a broken
    // <img> with no message to the agent. Preserving targetExists for the
    // message text only (existing file: "already preserved"; new file: same
    // retryable signal, but no file is written).
    return { skip: true, reason: 'copy-error' };
  }
}
