import { pdfTextExtractor } from './pdf.js'
import type { TextContentExtractor } from './types.js'

export const TEXT_CONTENT_EXTRACTOR: Record<string, TextContentExtractor> = {
  '.pdf': pdfTextExtractor,
}
