import { getFilenameFromUploadUrl } from '@airo/shared/media';
import { createForWorkspace } from '../workspace/index.js';
import { isDevSupervisorNotFound } from '../services/DevSupervisorClient.js';
import { logger } from '../logging/index.js';
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
  appId: string,
  uploadUrls: string[]
): Promise<{
  deletedPersistentUrls: string[];
  failedPersistentUrls: string[];
}> {
  const workspace = createForWorkspace(appId, 'preview');
  const deletedPersistentUrls: string[] = [];
  const failedPersistentUrls: string[] = [];

  if (!workspace) {
    logger.warn('media_upload_deletion.workspace_unreachable', { appId, urlCount: uploadUrls.length });
    return { deletedPersistentUrls, failedPersistentUrls: [...uploadUrls] };
  }

  for (const uploadUrl of uploadUrls) {
    const filename = getFilenameFromUploadUrl(uploadUrl);
    if (!filename) continue;

    const mediaPath = `public/assets/media/${filename}`;
    try {
      await workspace.files.delete({ path: mediaPath });
      deletedPersistentUrls.push(uploadUrl);
    } catch (error) {
      if (isDevSupervisorNotFound(error)) {
        // File already gone — treat as successfully deleted
        deletedPersistentUrls.push(uploadUrl);
        continue;
      }
      logger.warn('media_upload_deletion.delete_failed', {
        appId,
        mediaPath,
        error: error instanceof Error ? error.message : String(error),
      });
      failedPersistentUrls.push(uploadUrl);
    }
  }

  return { deletedPersistentUrls, failedPersistentUrls };
}
