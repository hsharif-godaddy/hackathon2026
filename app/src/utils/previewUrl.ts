export const AIRO_PREVIEW_PARAM = 'airoPreview'

export function withPreviewParam(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${AIRO_PREVIEW_PARAM}=1`
}

/**
 * Resolve an absolute path against a preview URL, preserving its query string.
 * previewUrl may carry ?airoShareToken=... for 3PC-blocking browsers; setting
 * pathname on the parsed URL keeps the token while placing the path correctly.
 */
export function withPreviewPath(previewUrl: string, absolutePath: string): string {
  const urlObj: URL = new URL(previewUrl)
  urlObj.pathname = absolutePath
  return urlObj.toString()
}
