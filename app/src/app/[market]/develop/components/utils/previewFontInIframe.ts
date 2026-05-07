import type { FontThemeSuggestFont } from '@/app/[market]/develop/components/utils/findLatestFontThemeSuggest'
import { postMessageToIframe } from '@/utils/postMessage'

export interface FontPreviewPayload {
  bodyFont: FontThemeSuggestFont
  headerFont: FontThemeSuggestFont
}

export function previewFontInIframe(payload: FontPreviewPayload): void {
  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
  if (iframe?.contentWindow) {
    postMessageToIframe(iframe, {
      type: 'PREVIEW_FONT',
      bodyFont: payload.bodyFont,
      headerFont: payload.headerFont,
    })
  }
}

export function revertFontInIframe(): void {
  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement | null
  if (iframe?.contentWindow) {
    postMessageToIframe(iframe, { type: 'REVERT_FONT' })
  }
}
