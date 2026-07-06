const DESIGN_KIT_GALLERY_SUBTITLE_V2 =
  'Start your project with a style you like. Then you can fine-tune your style as you build.'

/** Dev-only: show unpublished copy locally until the i18n portal is updated. */
export function mergeDevPreviewOverrides(messages: Record<string, string>): Record<string, string> {
  if (process.env.NODE_ENV !== 'development') return messages
  return {
    ...messages,
    builder_design_kit_gallery_subtitle_v2: DESIGN_KIT_GALLERY_SUBTITLE_V2,
  }
}

export { DESIGN_KIT_GALLERY_SUBTITLE_V2 }
