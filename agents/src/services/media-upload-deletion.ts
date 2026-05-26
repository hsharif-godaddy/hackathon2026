import { getFilenameFromUploadUrl } from '@airo/shared/media';
import fs from 'fs/promises';
import path from 'path';
import { getPersistentPublicDir } from '../utils/persistent-assets.js';
import type { MediaManifest, MediaSlot } from './MediaManifestService.js';

export function collectUploadUrlsForFilenameFromSlot(
  slot: MediaSlot | undefined,
  filename: string
): string[] {
  const urls = new Set<string>();
  const addIfMatches = (url: string | undefined) => {
    if (!url) return;

    if (getFilenameFromUploadUrl(url) === filename) {
      urls.add(url);
    }
  };

  if (!slot) return [];

  addIfMatches(slot.currentUrl);
  slot.alternatives.forEach(addIfMatches);

  for (const [url, sourceFilename] of Object.entries(slot.uploadSources || {})) {
    if (sourceFilename === filename || getFilenameFromUploadUrl(url) === filename) {
      urls.add(url);
    }
  }

  for (const map of [
    slot.solidUrlMap,
    slot.reversedUrlMap,
    slot.reversedSolidUrlMap,
    slot.mockupUrlMap,
    slot.landscapeMockupUrlMap,
  ]) {
    for (const [sourceUrl, derivedUrl] of Object.entries(map || {})) {
      addIfMatches(sourceUrl);
      addIfMatches(derivedUrl);
    }
  }

  for (const sourceUrl of Object.keys(slot.logoSourceMap || {})) {
    addIfMatches(sourceUrl);
  }

  return [...urls];
}

export function collectUploadUrlsForFilename(
  manifest: MediaManifest | undefined,
  filename: string
): string[] {
  const urls = new Set<string>();

  for (const slot of Object.values(manifest || {})) {
    collectUploadUrlsForFilenameFromSlot(slot, filename).forEach((url) => urls.add(url));
  }

  return [...urls];
}

export async function deletePersistentUploadFiles(
  appPath: string,
  uploadUrls: string[]
): Promise<{
  deletedPersistentUrls: string[];
  failedPersistentUrls: string[];
}> {
  const mediaDir = path.join(getPersistentPublicDir(appPath), 'media');
  const resolvedMediaDir = path.resolve(mediaDir);
  const deletedPersistentUrls: string[] = [];
  const failedPersistentUrls: string[] = [];

  for (const uploadUrl of uploadUrls) {
    const filename = getFilenameFromUploadUrl(uploadUrl);
    if (!filename) continue;

    const filePath = path.join(mediaDir, filename); // nosemgrep: path-join-resolve-traversal
    const resolvedFilePath = path.resolve(filePath); // nosemgrep: path-join-resolve-traversal
    if (!resolvedFilePath.startsWith(resolvedMediaDir + path.sep)) {
      failedPersistentUrls.push(uploadUrl);
      continue;
    }

    try {
      await fs.unlink(resolvedFilePath); // nosemgrep: path-traversal
      deletedPersistentUrls.push(uploadUrl);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        deletedPersistentUrls.push(uploadUrl);
        continue;
      }
      failedPersistentUrls.push(uploadUrl);
    }
  }

  return { deletedPersistentUrls, failedPersistentUrls };
}
