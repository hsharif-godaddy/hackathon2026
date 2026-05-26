import { getFilenameFromUploadUrl } from '@airo/shared/media';

import { formatSlotName } from './mediaSlotLabels';
import type { MediaSlot } from './types';

type MediaManifest = Record<string, MediaSlot>;

interface OtherUploadUsageLocationOptions {
  mediaManifest?: MediaManifest | null;
  filename: string;
  currentSlotName?: string | null;
}

function uploadUrlMatchesFilename(url: string | null | undefined, filename: string): boolean {
  return getFilenameFromUploadUrl(url) === filename;
}

function stringMapUsesFilename(map: Record<string, string> | undefined, filename: string): boolean {
  return Object.entries(map || {}).some(
    ([sourceUrl, derivedUrl]) =>
      uploadUrlMatchesFilename(sourceUrl, filename) ||
      uploadUrlMatchesFilename(derivedUrl, filename)
  );
}

function uploadSourcesUseFilename(
  uploadSources: Record<string, string> | undefined,
  filename: string
): boolean {
  return Object.entries(uploadSources || {}).some(
    ([url, sourceFilename]) =>
      sourceFilename === filename || uploadUrlMatchesFilename(url, filename)
  );
}

function logoSourceMapUsesFilename(
  logoSourceMap: MediaSlot['logoSourceMap'],
  filename: string
): boolean {
  return Object.keys(logoSourceMap || {}).some((url) => uploadUrlMatchesFilename(url, filename));
}

export function mediaSlotUsesUpload(slot: MediaSlot | undefined, filename: string): boolean {
  if (!slot) return false;

  return (
    uploadUrlMatchesFilename(slot.currentUrl, filename) ||
    (slot.alternatives || []).some((url) => uploadUrlMatchesFilename(url, filename)) ||
    uploadSourcesUseFilename(slot.uploadSources, filename) ||
    [
      slot.solidUrlMap,
      slot.reversedUrlMap,
      slot.reversedSolidUrlMap,
      slot.mockupUrlMap,
      slot.landscapeMockupUrlMap,
    ].some((map) => stringMapUsesFilename(map, filename)) ||
    logoSourceMapUsesFilename(slot.logoSourceMap, filename)
  );
}

export function getOtherUploadUsageLocationNames({
  mediaManifest,
  filename,
  currentSlotName,
}: OtherUploadUsageLocationOptions): string[] {
  if (!mediaManifest) return [];

  const locationNames = Object.entries(mediaManifest)
    .filter(
      ([slotName, slot]) => slotName !== currentSlotName && mediaSlotUsesUpload(slot, filename)
    )
    .map(([slotName]) => formatSlotName(slotName) || slotName);

  return [...new Set(locationNames)];
}
