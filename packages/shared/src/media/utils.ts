import { AIRO_ASSET_UPLOADS_URL_PREFIX } from './constants.js';

export function isSafeUploadFilename(filename: string | null | undefined): filename is string {
  return (
    !!filename &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('..') &&
    !filename.includes('\0')
  );
}

export function getFilenameFromUploadUrl(url: string | null | undefined): string | null {
  if (!url?.startsWith(AIRO_ASSET_UPLOADS_URL_PREFIX)) return null;

  const filename = url.slice(AIRO_ASSET_UPLOADS_URL_PREFIX.length);
  return isSafeUploadFilename(filename) ? filename : null;
}
