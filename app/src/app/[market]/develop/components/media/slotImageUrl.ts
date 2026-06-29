/** Strip query string from previewBaseUrl — asset paths are auth-excluded and only need the origin. */
export function getPreviewOrigin(previewBaseUrl: string): string {
  try { return new URL(previewBaseUrl).origin }
  catch { return previewBaseUrl.split('?')[0].split('#')[0].replace(/\/$/, '') }
}

/** True when a URL points at a raster image suitable for img/poster (not mp4/webm). */
export function isImageMediaUrl(url: string): boolean {
  const base = url.split('?')[0].toLowerCase()
  if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/.test(base)) {
    return true
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(base)) {
    return false
  }
  if (base.includes('/video/')) {
    return false
  }
  return true
}

/**
 * Returns posterUrl only when it is a still image (Getty preview URLs are often mp4).
 * Assumes posterUrl is always an absolute URL — media-search-tool always emits absolute
 * Getty CDN URLs for thumbnailUrl, so no preview-origin resolution is needed here.
 */
export function getSlotVideoPosterUrl(posterUrl: string | undefined): string {
  if (!posterUrl || !isImageMediaUrl(posterUrl)) {
    return ''
  }
  return posterUrl
}

export function getSlotImageUrl(
  slotName: string | null,
  imageUrl: string,
  previewBaseUrl: string | null,
  mediaType?: string,
): string {
  if (!imageUrl) {
    return ''
  }
  // Absolute URLs (e.g. signed agent URLs for chat uploads) are used as-is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl
  }
  if (!previewBaseUrl) {
    return imageUrl
  }
  // /airo-assets/uploads/ are served directly by dev-supervisor — only the
  // preview origin needs to be prepended (no slot resolver needed here since
  // the URL is already fully resolved). Tool renderers use this path.
  if (imageUrl.startsWith('/airo-assets/uploads/')) {
    return `${getPreviewOrigin(previewBaseUrl)}${imageUrl}`
  }
  if (!slotName) {
    return imageUrl
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
