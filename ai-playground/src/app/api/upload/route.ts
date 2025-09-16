import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { detectMimeType } from '@airo/ai-lib'

const UPLOAD_DIR = join(process.cwd(), 'uploads')

// Ensure upload directory exists
async function ensureUploadDir() {
  try {
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
      console.log('📁 Created upload directory:', UPLOAD_DIR)
    }
  } catch (error) {
    console.error('❌ Failed to create upload directory:', error)
    throw error
  }
}

// Validate file type
function isValidFileType(filename: string): boolean {
  const allowedExtensions = [
    '.txt', '.md', '.csv', '.json', '.pdf',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.docx', '.xlsx', '.pptx'
  ]
  
  return allowedExtensions.some(ext => 
    filename.toLowerCase().endsWith(ext)
  )
}

// Validate file size (10MB limit)
function isValidFileSize(size: number): boolean {
  const maxSize = 10 * 1024 * 1024 // 10MB
  return size <= maxSize
}

export async function POST(request: NextRequest) {
  try {
    await ensureUploadDir()
    
    const formData = await request.formData()
    const file = formData.get('file') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }
    
    // Validate file type
    if (!isValidFileType(file.name)) {
      return NextResponse.json(
        { 
          error: 'Unsupported file type',
          supportedTypes: [
            'Text files (.txt, .md, .csv, .json)',
            'Images (.jpg, .png, .gif, .webp, .svg)',
            'Documents (.pdf, .docx, .xlsx, .pptx)'
          ]
        },
        { status: 400 }
      )
    }
    
    // Validate file size
    if (!isValidFileSize(file.size)) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 10MB.' },
        { status: 400 }
      )
    }
    
    // Generate unique filename
    const timestamp = Date.now()
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const filename = `${timestamp}_${sanitizedName}`
    const filepath = join(UPLOAD_DIR, filename)
    
    // Convert file to buffer and save
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(filepath, buffer)
    
    // Detect MIME type
    const mimeType = detectMimeType(file.name)
    
    const fileInfo = {
      id: timestamp.toString(),
      originalName: file.name,
      filename,
      filepath,
      size: file.size,
      mimeType,
      uploadedAt: new Date().toISOString()
    }
    
    console.log(`📁 File uploaded: ${file.name} (${file.size} bytes) -> ${filename}`)
    
    return NextResponse.json({
      success: true,
      file: fileInfo
    })
    
  } catch (error) {
    console.error('File upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    )
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
