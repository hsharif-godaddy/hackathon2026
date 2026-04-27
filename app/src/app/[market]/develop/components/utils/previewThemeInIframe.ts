import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme'
import { postMessageToIframe } from '@/utils/postMessage'

export function previewThemeInIframe(name: string, palette: CompletePalette): void {
  const paletteData = { name, ...palette }
  const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement
  if (iframe?.contentWindow) {
    postMessageToIframe(iframe, {
      type: 'PREVIEW_THEME',
      palette: paletteData
    })
  }
  window.dispatchEvent(new CustomEvent('palette-preview', { detail: paletteData }))
}
