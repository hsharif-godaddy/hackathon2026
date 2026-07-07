import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('pdf-parse/lib/pdf-parse.js', () => ({
  default: vi.fn(),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { warn: vi.fn() },
}))

import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import { logger } from '../../../logging/index.js'
import { pdfTextExtractor } from '../pdf.js'

const mockPdfParse = pdfParse as ReturnType<typeof vi.fn>
const mockLogger = logger as { warn: ReturnType<typeof vi.fn> }

describe('pdfTextExtractor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns extracted text when the PDF has content', async () => {
    mockPdfParse.mockResolvedValue({ text: 'Hello from PDF' })
    const result = await pdfTextExtractor(Buffer.from('pdf bytes'))
    expect(result).toBe('Hello from PDF')
  })

  it('returns the no-text fallback when extracted text is empty', async () => {
    mockPdfParse.mockResolvedValue({ text: '' })
    const result = await pdfTextExtractor(Buffer.from('pdf bytes'))
    expect(result).toContain('no extractable text')
  })

  it('returns the no-text fallback when extracted text is only whitespace', async () => {
    mockPdfParse.mockResolvedValue({ text: '   \n\t  ' })
    const result = await pdfTextExtractor(Buffer.from('pdf bytes'))
    expect(result).toContain('no extractable text')
  })

  it('logs a warning and returns the parse-failed fallback when pdf-parse throws', async () => {
    mockPdfParse.mockRejectedValue(new Error('unexpected token'))
    const result = await pdfTextExtractor(Buffer.from('corrupt pdf'))
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'context.renderer.file_upload.pdf_parse_failed',
      { error: 'unexpected token' }
    )
    expect(result).toContain('could not be parsed')
  })

  it('logs a warning with a string representation when a non-Error is thrown', async () => {
    mockPdfParse.mockRejectedValue('string error')
    await pdfTextExtractor(Buffer.from('pdf bytes'))
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'context.renderer.file_upload.pdf_parse_failed',
      { error: 'string error' }
    )
  })
})
