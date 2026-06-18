/** Strip query string from previewBaseUrl — asset paths are auth-excluded and only need the origin. */
export function getPreviewOrigin(previewBaseUrl: string): string {
  try { return new URL(previewBaseUrl).origin }
  catch { return previewBaseUrl.split('?')[0].split('#')[0].replace(/\/$/, '') }
}

export function getSlotImageUrl(
  slotName: string | null,
  imageUrl: string,
  previewBaseUrl: string | null,
  mediaType?: string,
): string {
  if (!imageUrl || !slotName || !previewBaseUrl) {
    return imageUrl || ''
  }
  // Absolute URLs (e.g. signed agent URLs for chat uploads) are used as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl
  }
  // /airo-assets/uploads/ are served directly by dev-supervisor — only the
  // preview origin needs to be prepended (no slot resolver needed here since
  // the URL is already fully resolved). Tool renderers use this path.
  if (imageUrl.startsWith('/airo-assets/uploads/')) {
    return `${getPreviewOrigin(previewBaseUrl)}${imageUrl}`
  }
  const assetPrefix = mediaType === 'video' ? '/airo-assets/videos/' : '/airo-assets/images/'
  return `${getPreviewOrigin(previewBaseUrl)}${assetPrefix}${slotName}?src=${encodeURIComponent(imageUrl)}`
}

/**
 * Builds the thumbnail URL for a slot in the Media Manager panel.
 * Unlike getSlotImageUrl, this ALWAYS routes through the slot resolver
 * (/airo-assets/images/{slot}?src=...) — even for upload URLs — so that:
 *   1. The ?airoShareToken= query on previewBaseUrl is preserved (cross-origin auth).
 *   2. A cacheBustKey can be appended to force re-fetch after an overwrite.
 * Uses the URL API for param merging — string concat corrupts the URL when
 * previewBaseUrl already carries its own query string.
 */
export function getSlotThumbnailUrl(
  slotName: string | null,
  imageUrl: string,
  previewBaseUrl: string | null,
  mediaType?: string,
  cacheBustKey?: string | number | null,
): string {
  if (!imageUrl || !slotName || !previewBaseUrl) {
    return imageUrl || ''
  }
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl
  }
  const assetPrefix = mediaType === 'video' ? '/airo-assets/videos/' : '/airo-assets/images/'
  try {
    const url = new URL(previewBaseUrl)
    url.pathname = `${assetPrefix}${slotName}`
    url.searchParams.set('src', imageUrl)
    if (cacheBustKey !== undefined && cacheBustKey !== null && cacheBustKey !== '') {
      url.searchParams.set('_t', String(cacheBustKey))
    }
    return url.toString()
  } catch {
    return `${previewBaseUrl}${assetPrefix}${slotName}?src=${encodeURIComponent(imageUrl)}`
  }
}
