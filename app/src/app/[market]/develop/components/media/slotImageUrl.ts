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
  if (imageUrl.startsWith('/airo-assets/uploads/')) {
    return `${getPreviewOrigin(previewBaseUrl)}${imageUrl}`
  }
  const assetPrefix = mediaType === 'video' ? '/airo-assets/videos/' : '/airo-assets/images/'
  return `${getPreviewOrigin(previewBaseUrl)}${assetPrefix}${slotName}?src=${encodeURIComponent(imageUrl)}`
}
