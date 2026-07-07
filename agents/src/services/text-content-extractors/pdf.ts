import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import type { TextContentExtractor } from './types.js'
import { logger } from '../../logging/index.js'

export const pdfTextExtractor: TextContentExtractor = async (buffer: Buffer): Promise<string> => {
  try {
    const data = await pdfParse(buffer)

    if (!data.text || data.text.trim().length === 0) {
      return 'This PDF was uploaded successfully but contains no extractable text. It may be a scanned document or image-based PDF. Please describe its contents in your message so I can use it to build your site.'
    }
    
    return data.text
  } catch (error) {
    logger.warn('context.renderer.file_upload.pdf_parse_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 'This PDF was uploaded but could not be parsed — the file appears to be corrupted or uses an unsupported format. Please try re-exporting it from your original application (e.g. Word, Google Docs) or describe its contents in your message.'
  }
}
