export const AIRO_PREVIEW_PARAM = 'airoPreview'

export function withPreviewParam(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${AIRO_PREVIEW_PARAM}=1`
}
