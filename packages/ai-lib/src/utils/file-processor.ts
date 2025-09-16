/**
 * File processing utilities for handling various file types
 * Supports text files, images, PDFs, and Office documents
 */

import { readFileSync } from 'fs'
import { extname, basename } from 'path'
import type { 
  FileInput, 
  ProcessedFile, 
  FileInputContext, 
  SupportedFileType,
  FileProcessingOptions 
} from '../core/types.js'

/**
 * MIME type detection based on file extension
 */
const MIME_TYPE_MAP: Record<string, SupportedFileType> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

/**
 * Default processing options
 */
const DEFAULT_OPTIONS: Required<FileProcessingOptions> = {
  maxSize: 10 * 1024 * 1024, // 10MB
  textExtraction: {
    includeFormatting: false,
    extractTables: true,
    extractMetadata: true
  },
  imageProcessing: {
    maxDimensions: { width: 2048, height: 2048 },
    quality: 85,
    convertTo: 'jpeg'
  }
}

/**
 * Detect MIME type from file extension
 */
export function detectMimeType(filename: string): SupportedFileType | null {
  const ext = extname(filename).toLowerCase()
  return MIME_TYPE_MAP[ext] || null
}

/**
 * Validate file size
 */
function validateFileSize(buffer: Buffer, maxSize: number): void {
  if (buffer.length > maxSize) {
    throw new Error(`File size ${buffer.length} bytes exceeds maximum allowed size ${maxSize} bytes`)
  }
}

/**
 * Process text-based files
 */
async function processTextFile(
  buffer: Buffer, 
  mimeType: SupportedFileType,
  _options: FileProcessingOptions
): Promise<{ textContent: string; structuredData?: any }> {
  const text = buffer.toString('utf-8')
  
  switch (mimeType) {
    case 'application/json':
      try {
        const structuredData = JSON.parse(text)
        return { 
          textContent: text,
          structuredData 
        }
      } catch (error) {
        return { 
          textContent: text,
          structuredData: { parseError: 'Invalid JSON format' }
        }
      }
      
    case 'text/csv':
      // Basic CSV parsing - in production you might want to use a proper CSV library
      const lines = text.split('\n').filter(line => line.trim())
      if (lines.length > 0) {
        const headers = (lines[0] || '').split(',').map(h => h.trim().replace(/"/g, ''))
        const rows = lines.slice(1).map(line => {
          const values = line.split(',').map(v => v.trim().replace(/"/g, ''))
          const row: Record<string, string> = {}
          headers.forEach((header, index) => {
            row[header] = values[index] || ''
          })
          return row
        })
        
        return {
          textContent: text,
          structuredData: { headers, rows, rowCount: rows.length }
        }
      }
      return { textContent: text }
      
    default:
      return { textContent: text }
  }
}

/**
 * Process image files
 */
async function processImageFile(
  buffer: Buffer,
  _mimeType: SupportedFileType,
  _options: FileProcessingOptions
): Promise<{ base64Content: string }> {
  // For basic implementation, we'll just convert to base64
  // In production, you might want to add image processing libraries like sharp
  const base64Content = buffer.toString('base64')
  
  return { base64Content }
}

/**
 * Process PDF files (placeholder - requires pdf-parse or similar library)
 */
async function processPdfFile(
  buffer: Buffer,
  _options: FileProcessingOptions
): Promise<{ textContent: string; structuredData?: any }> {
  // This is a placeholder implementation
  // In production, you would use a library like pdf-parse or pdf2pic
  
  console.warn('PDF processing requires additional dependencies. Install pdf-parse for full PDF support.')
  
  return {
    textContent: 'PDF content extraction not implemented. Please install pdf-parse library.',
    structuredData: { 
      error: 'PDF processing requires pdf-parse library',
      size: buffer.length 
    }
  }
}

/**
 * Process Office documents (placeholder - requires proper libraries)
 */
async function processOfficeDocument(
  buffer: Buffer,
  mimeType: SupportedFileType,
  _options: FileProcessingOptions
): Promise<{ textContent: string; structuredData?: any }> {
  // This is a placeholder implementation
  // In production, you would use libraries like:
  // - mammoth (for .docx)
  // - xlsx (for Excel files)
  // - officegen or similar for PowerPoint
  
  const docType = mimeType.includes('word') ? 'Word' : 
                  mimeType.includes('sheet') ? 'Excel' : 'PowerPoint'
  
  console.warn(`${docType} document processing requires additional dependencies.`)
  
  return {
    textContent: `${docType} document content extraction not implemented. Install appropriate libraries for full document support.`,
    structuredData: { 
      error: `${docType} processing requires additional libraries`,
      size: buffer.length,
      type: docType
    }
  }
}

/**
 * Process a single file
 */
export async function processFile(fileInput: FileInput): Promise<ProcessedFile> {
  const startTime = Date.now()
  const options = { ...DEFAULT_OPTIONS, ...fileInput.options }
  
  let buffer: Buffer
  let filename = fileInput.filename
  
  // Handle different source types
  if (typeof fileInput.source === 'string') {
    // File path
    try {
      buffer = readFileSync(fileInput.source)
      if (!filename) {
        filename = basename(fileInput.source)
      }
    } catch (error) {
      throw new Error(`Failed to read file: ${fileInput.source}`)
    }
  } else if (Buffer.isBuffer(fileInput.source)) {
    buffer = fileInput.source
  } else if (fileInput.source instanceof Uint8Array) {
    buffer = Buffer.from(fileInput.source)
  } else {
    throw new Error('Invalid file source type')
  }
  
  // Validate file size
  validateFileSize(buffer, options.maxSize)
  
  const metadata: ProcessedFile['metadata'] = {
    size: buffer.length,
    mimeType: fileInput.mimeType,
    extractedAt: new Date(),
    processingTime: 0
  }
  
  if (filename) {
    metadata.filename = filename
  }

  const result: ProcessedFile = {
    input: fileInput,
    metadata,
    warnings: []
  }
  
  try {
    // Process based on MIME type
    if (fileInput.mimeType.startsWith('text/') || fileInput.mimeType === 'application/json') {
      const { textContent, structuredData } = await processTextFile(buffer, fileInput.mimeType, options)
      result.textContent = textContent
      result.structuredData = structuredData
      
    } else if (fileInput.mimeType.startsWith('image/')) {
      const { base64Content } = await processImageFile(buffer, fileInput.mimeType, options)
      result.base64Content = base64Content
      
    } else if (fileInput.mimeType === 'application/pdf') {
      const { textContent, structuredData } = await processPdfFile(buffer, options)
      result.textContent = textContent
      result.structuredData = structuredData
      
    } else if (fileInput.mimeType.includes('officedocument')) {
      const { textContent, structuredData } = await processOfficeDocument(buffer, fileInput.mimeType, options)
      result.textContent = textContent
      result.structuredData = structuredData
      
    } else {
      result.warnings?.push(`Unsupported MIME type: ${fileInput.mimeType}`)
      result.textContent = 'Unsupported file type for text extraction'
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown processing error'
    result.warnings?.push(`Processing error: ${errorMessage}`)
    result.textContent = `Error processing file: ${errorMessage}`
  }
  
  result.metadata.processingTime = Date.now() - startTime
  return result
}

/**
 * Process multiple files and create a context
 */
export async function processFiles(fileInputs: FileInput[]): Promise<FileInputContext> {
  const files: ProcessedFile[] = []
  const textContents: string[] = []
  
  for (const fileInput of fileInputs) {
    try {
      const processedFile = await processFile(fileInput)
      files.push(processedFile)
      
      if (processedFile.textContent) {
        textContents.push(processedFile.textContent)
      }
    } catch (error) {
      // Add a failed processing entry
      const failedMetadata: ProcessedFile['metadata'] = {
        size: 0,
        mimeType: fileInput.mimeType,
        extractedAt: new Date(),
        processingTime: 0
      }
      
      if (fileInput.filename) {
        failedMetadata.filename = fileInput.filename
      }
      
      files.push({
        input: fileInput,
        textContent: `Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: failedMetadata,
        warnings: [`Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      })
    }
  }
  
  const combinedText = textContents.join('\n\n---\n\n')
  const summary = files.length > 1 
    ? `Processed ${files.length} files: ${files.map(f => f.metadata.filename || 'unknown').join(', ')}`
    : files[0]?.metadata.filename || 'Single file processed'
  
  const context: FileInputContext = {
    files,
    summary
  }
  
  if (combinedText.length > 0) {
    context.combinedText = combinedText
  }
  
  return context
}

/**
 * Helper function to create FileInput from file path
 */
export function createFileInput(filePath: string, options?: FileProcessingOptions): FileInput {
  const filename = basename(filePath)
  const mimeType = detectMimeType(filename)
  
  if (!mimeType) {
    throw new Error(`Unsupported file type for: ${filename}`)
  }
  
  const fileInput: FileInput = {
    source: filePath,
    mimeType,
    filename
  }
  
  if (options) {
    fileInput.options = options
  }
  
  return fileInput
}

/**
 * Helper function to create FileInput from buffer
 */
export function createFileInputFromBuffer(
  buffer: Buffer,
  mimeType: SupportedFileType,
  filename?: string,
  options?: FileProcessingOptions
): FileInput {
  const fileInput: FileInput = {
    source: buffer,
    mimeType
  }
  
  if (filename) {
    fileInput.filename = filename
  }
  
  if (options) {
    fileInput.options = options
  }
  
  return fileInput
}
