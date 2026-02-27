import { logger } from '../../logging/index.js'
import { readdir, readFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import { getFeatures } from '../features.js'

export interface FormattedContext {
  /** The formatted content string ready for LLM */
  content: string
  /** The type of context for categorization */
  type: 'ai_edit_context' | 'visual_context' | 'selected_assets_context' | 'build_error_context'
  /** Optional screenshot data URL for vision processing */
  screenshot?: string
  /** Optional asset images as base64 data URLs for vision processing */
  assetImages?: string[]
  /** Optional uploaded files metadata for vision processing */
  uploadedFiles?: {
    uploadId: string
    files: Array<{
      id: string
      originalName: string
      filename: string
      size: number
      mimeType: string | null
    }>
  }
}

/**
 * Read uploaded file content from disk
 * @param imageUrl - The image URL from the asset (format: {agentUrl}/files/uploads/{appId}/{filename})
 * @param filename - The original filename
 * @returns Promise resolving to file content as string or null if read fails
 */
async function readUploadedFileContent(imageUrl: string, filename: string): Promise<string | null> {
  try {
    // Extract appId from imageUrl: .../files/uploads/{appId}/{filename}
    const urlMatch = imageUrl.match(/\/files\/uploads\/([^/]+)\/[^/]+$/)
    if (!urlMatch || !urlMatch[1]) {
      logger.warn('context.formatter.file_read.invalid_url', {
        imageUrl,
        reason: 'Could not extract appId from URL'
      })
      return null
    }

    const appId = urlMatch[1]
    const features = getFeatures()
    const uploadDirConfig = features.uploadDir || 'data/uploads'
    const uploadDir = uploadDirConfig.startsWith('/')
      ? uploadDirConfig
      : join(process.cwd(), uploadDirConfig)

    // Build base path for this app's uploads
    const appUploadDir = join(uploadDir, appId)

    // Security: Normalize paths and validate we stay within appUploadDir
    const normalizedAppDir = normalize(resolve(appUploadDir))

    // Find the file by searching subdirectories (uploadId subdirs) and reading metadata
    try {
      const uploadIdDirs = await readdir(appUploadDir)

      for (const uploadIdDir of uploadIdDirs) {
        // Read metadata.json to find the actual filename
        const metadataPath = join(appUploadDir, uploadIdDir, 'metadata.json')

        try {
          const metadataContent = await readFile(metadataPath, 'utf-8')
          const metadata = JSON.parse(metadataContent)

          // Find file by originalName
          const fileEntry = metadata.files?.find((f: any) => f.originalName === filename)

          if (!fileEntry) {
            // File not in this upload, try next one
            continue
          }

          // Use the actual stored filename
          const candidatePath = join(appUploadDir, uploadIdDir, fileEntry.filename)
          const normalizedCandidate = normalize(resolve(candidatePath))

          // Security: Ensure path doesn't escape appUploadDir
          if (!normalizedCandidate.startsWith(normalizedAppDir)) {
            logger.error('context.formatter.file_read.path_traversal_attempt', {
              appId,
              filename,
              actualFilename: fileEntry.filename,
              attemptedPath: candidatePath
            }, { tags: ['security', 'path-traversal-attempt'] })
            return null
          }

          // Read the file
          const content = await readFile(candidatePath, 'utf-8')

          // Limit content size (100KB for text files)
          const maxSizeBytes = 100 * 1024
          if (content.length > maxSizeBytes) {
            const truncated = content.substring(0, maxSizeBytes)
            logger.info('context.formatter.file_read.truncated', {
              appId,
              filename,
              originalSize: content.length,
              truncatedSize: maxSizeBytes
            })
            return truncated + '\n\n[Content truncated - file too large]'
          }

          logger.info('context.formatter.file_read.success', {
            appId,
            filename,
            actualFilename: fileEntry.filename,
            size: content.length
          })

          return content
        } catch (metadataError) {
          // Metadata doesn't exist or is invalid, try next upload
          continue
        }
      }

      logger.warn('context.formatter.file_read.not_found', {
        appId,
        filename,
        searchedDirs: uploadIdDirs.length
      })
      return null
    } catch (dirError) {
      logger.error('context.formatter.file_read.directory_error', {
        appId,
        filename,
        error: dirError instanceof Error ? dirError.message : String(dirError)
      })
      return null
    }
  } catch (error) {
    logger.error('context.formatter.file_read.error', {
      imageUrl,
      filename,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

/**
 * Read uploaded image from disk and convert to base64 data URL
 * Used when the URL points to the agents service /files/uploads endpoint
 * @param imageUrl - URL in format {agentUrl}/files/uploads/{appId}/{filename}
 * @returns Promise resolving to data URL or null if read fails
 */
export async function readAgentUploadAsBase64(imageUrl: string): Promise<string | null> {
  try {
    // Strip query params (signed URL has ?sig=...&exp=...) before extracting path segments
    const cleanUrl = imageUrl.split('?')[0] ?? imageUrl
    const urlMatch = cleanUrl.match(/\/files\/uploads\/([^/]+)\/([^/]+)$/)
    if (!urlMatch || !urlMatch[1] || !urlMatch[2]) {
      logger.warn('context.formatter.agent_upload.invalid_url', {
        imageUrl,
        reason: 'Could not extract appId and filename from URL'
      })
      return null
    }

    const appId = urlMatch[1]
    const serverFilename = decodeURIComponent(urlMatch[2])

    // Use fileUploadService to read the file directly
    const { fileUploadService } = await import('../FileUploadService.js')

    // Find the file in the uploads
    const uploadedFiles = await fileUploadService.listUploadedFiles(appId)
    const matchingFile = uploadedFiles.find(f => f.filename === serverFilename)

    if (!matchingFile) {
      logger.warn('context.formatter.agent_upload.not_found', {
        appId,
        serverFilename
      })
      return null
    }

    // Get the file from disk
    const appDir = fileUploadService.getAppUploadsDir(appId)
    const { readdirSync, existsSync } = await import('fs')
    const { readFile: fsReadFile } = await import('fs/promises')

    if (!existsSync(appDir)) {
      logger.warn('context.formatter.agent_upload.app_dir_missing', { appId, appDir })
      return null
    }

    // Search for the file in upload subdirectories
    const uploadDirs = readdirSync(appDir)
    for (const uploadId of uploadDirs) {
      const filePath = fileUploadService.getFilePath(appId, uploadId, serverFilename)
      if (existsSync(filePath)) {
        const buffer = await fsReadFile(filePath)
        const base64 = buffer.toString('base64')
        const contentType = matchingFile.mimeType || 'image/jpeg'
        const dataUrl = `data:${contentType};base64,${base64}`

        logger.info('context.formatter.agent_upload.success', {
          appId,
          serverFilename,
          contentType,
          sizeKB: Math.round(buffer.length / 1024)
        })

        return dataUrl
      }
    }

    logger.warn('context.formatter.agent_upload.file_not_on_disk', {
      appId,
      serverFilename
    })
    return null
  } catch (error) {
    logger.error('context.formatter.agent_upload.error', {
      imageUrl,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

/**
 * Fetch image from URL and convert to base64 data URL
 * @param imageUrl - URL of the image to fetch (HTTP URL, data URL, or agent upload URL)
 * @returns Promise resolving to data URL or null if fetch fails
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    // If it's already a data URL (screenshot or base64 image), return it as-is
    if (imageUrl.startsWith('data:')) {
      const dataUrlType = imageUrl.substring(5, imageUrl.indexOf(';'))
      logger.info('context.formatter.image_fetch.data_url_passthrough', {
        length: imageUrl.length,
        sizeKB: Math.round(imageUrl.length / 1024),
        type: dataUrlType,
        isValid: imageUrl.includes('base64,')
      })
      return imageUrl
    }

    // If it's an agent upload URL, read directly from disk (same process)
    if (imageUrl.includes('/files/uploads/')) {
      logger.info('context.formatter.image_fetch.agent_upload_detected', {
        url: imageUrl
      })
      return readAgentUploadAsBase64(imageUrl)
    }

    const response = await fetch(imageUrl, {
      method: 'GET',
      headers: {
        'Accept': 'image/*'
      }
    })

    if (!response.ok) {
      logger.warn('context.formatter.image_fetch.failed', {
        url: imageUrl,
        status: response.status,
        statusText: response.statusText
      })
      return null
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString('base64')

    // Get content type from response headers
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const dataUrl = `data:${contentType};base64,${base64}`

    const sizeKB = Math.round(buffer.length / 1024)
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2)

    logger.info('context.formatter.image_fetch.success', {
      url: imageUrl,
      contentType,
      sizeKB,
      sizeMB: `${sizeMB}MB`
    })

    return dataUrl
  } catch (error) {
    logger.error('context.formatter.image_fetch.error', {
      url: imageUrl,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

export class ContextFormatter {
  /**
   * Format AI edit context into a safe message
   * @param aiEditContext - The AI edit context data
   * @returns Formatted context or null if formatting fails
   */
  static formatAiEditContext(aiEditContext: any): FormattedContext | null {
    try {
      const elementInfo = aiEditContext.elementInfo || {}
      const devContext = aiEditContext.devContext || {}
    //   const screenshot = aiEditContext.screenshot

      // Sanitize and validate the context data
      const sanitizedContext = {
        element: {
          tag: String(elementInfo.tagName || 'unknown').replace(/[<>]/g, ''),
          classes: String(elementInfo.className || 'none').substring(0, 200),
          id: String(elementInfo.id || 'none').substring(0, 100),
          textContent: String(elementInfo.textContent || 'none').substring(0, 300),
          selector: String(aiEditContext.selector || 'unknown').substring(0, 200)
        },
        source: {
          fileName: String(devContext.fileName || 'unknown').substring(0, 200),
          componentName: String(devContext.componentName || 'unknown').substring(0, 100),
          lineNumber: Number.isInteger(devContext.lineNumber) ? devContext.lineNumber : 'unknown'
        }
      }

      // Validate screenshot format if present
      let validatedScreenshot: string | undefined
    //   if (screenshot && typeof screenshot === 'string') {
    //     // Check if it's a valid data URL format
    //     if (screenshot.startsWith('data:image/')) {
    //       const screenshotSizeKB = Math.round(screenshot.length / 1024)
    //       const screenshotSizeMB = (screenshot.length / (1024 * 1024)).toFixed(2)

    //       validatedScreenshot = screenshot
    //       logger.info('context.formatter.ai_edit.screenshot_detected', {
    //         screenshotSize: screenshot.length,
    //         screenshotSizeKB,
    //         screenshotSizeMB: `${screenshotSizeMB}MB`,
    //         mimeType: screenshot.substring(5, screenshot.indexOf(';'))
    //       })

    //       // Warn if screenshot is very large (>10MB)
    //       if (screenshot.length > 10 * 1024 * 1024) {
    //         logger.warn('context.formatter.ai_edit.large_screenshot', {
    //           message: 'Screenshot is very large, may cause performance issues',
    //           size: `${screenshotSizeMB}MB`,
    //           recommendation: 'Consider reducing screenshot quality or size'
    //         })
    //       }
    //     } else {
    //       logger.warn('context.formatter.ai_edit.invalid_screenshot', {
    //         message: 'Screenshot does not start with data:image/'
    //       })
    //     }
    //   }

      const content = `[AI Edit Context - Selected Element]

Element Details:
- Tag: ${sanitizedContext.element.tag}
- Classes: ${sanitizedContext.element.classes}
- ID: ${sanitizedContext.element.id}
- Text Content: "${sanitizedContext.element.textContent}"
- CSS Selector: ${sanitizedContext.element.selector}

Source Code Location:
- File: ${sanitizedContext.source.fileName}
- Component: ${sanitizedContext.source.componentName}
- Line: ${sanitizedContext.source.lineNumber}

${validatedScreenshot ? 'Visual Context: A screenshot of the selected element is attached for visual reference.\n' : ''}
Instructions: The following user message refers to changes for this specific selected element. Focus your edits on the code at the specified file and location.${validatedScreenshot ? ' Use the screenshot to understand the current visual appearance.' : ''}`

      return {
        content,
        type: 'ai_edit_context',
        // ...(validatedScreenshot && { screenshot: validatedScreenshot })
      }
    } catch (error) {
      logger.warn('context.formatter.ai_edit.failure', {
        error: (error as Error).message
      })
      return null
    }
  }

  /**
   * Format visual context into a safe message
   * @param visualContext - The visual context data from iframe
   * @returns Formatted context or null if formatting fails
   */
  static formatVisualContext(visualContext: any): FormattedContext | null {
    try {
      // Sanitize and validate the visual context data
      const sanitizedContext = {
        page: String(visualContext.page || '/').substring(0, 200),
        scroll_position: {
          x: typeof visualContext.scroll_position?.x === 'number' && !isNaN(visualContext.scroll_position.x) ? visualContext.scroll_position.x : 0,
          y: typeof visualContext.scroll_position?.y === 'number' && !isNaN(visualContext.scroll_position.y) ? visualContext.scroll_position.y : 0
        },
        active_section: visualContext.active_section ? String(visualContext.active_section).substring(0, 100) : 'unknown',
        viewport: {
          width: (typeof visualContext.viewport?.width === 'number' && !isNaN(visualContext.viewport.width)) ? visualContext.viewport.width : 0,
          height: (typeof visualContext.viewport?.height === 'number' && !isNaN(visualContext.viewport.height)) ? visualContext.viewport.height : 0
        },
        timestamp: visualContext.timestamp || Date.now()
      }

      let activePageSection = ''
      let contextNotes = ''

      if (sanitizedContext.active_section === 'dev-tools-initializing') {
        activePageSection = 'The user\'s preview application is loaded but visual context capture is still initializing.'
        contextNotes = 'The preview app is running and dev-tools are loading. The visual context system should be available shortly. Focus on understanding the user\'s intent from their message. When they say "this" or "here", ask for clarification about which specific element or section they\'re referring to.'
      } else if (sanitizedContext.active_section === 'iframe-blocked') {
        activePageSection = 'The user\'s preview application access is blocked or restricted.'
        contextNotes = 'Visual context cannot be captured due to technical restrictions. Focus on understanding the user\'s intent from their message context. When they use terms like "this" or "here", ask for clarification or provide general guidance.'
      } else if (sanitizedContext.active_section === 'no-iframe') {
        activePageSection = 'No preview application iframe was found.'
        contextNotes = 'The user may be referring to code or functionality in general. Focus on understanding their development needs and provide appropriate guidance.'
      } else if (sanitizedContext.active_section === 'unknown') {
        activePageSection = 'The active page section could not be determined.'
        contextNotes = `The user's message refers to content visible at their current scroll position (${sanitizedContext.scroll_position.y}px from top). When they say "this" or "here", try to understand from context what they're referring to.`
      } else {
        activePageSection = `The user is currently viewing the "${sanitizedContext.active_section}" section.`
        contextNotes = `The user's message refers to content visible at their current scroll position (${sanitizedContext.scroll_position.y}px from top). When they say "this" or "here", they likely mean elements visible in the "${sanitizedContext.active_section}" section around this scroll position.`
      }

      const content = `[User's Current Visual Context]

Page Information:
- Current Page: ${sanitizedContext.page}
- ${activePageSection}

Scroll Position:
- Horizontal: ${sanitizedContext.scroll_position.x}px
- Vertical: ${sanitizedContext.scroll_position.y}px

Viewport Size:
- Width: ${sanitizedContext.viewport.width}px
- Height: ${sanitizedContext.viewport.height}px

Context Notes: ${contextNotes}`

      return {
        content,
        type: 'visual_context'
      }
    } catch (error) {
      logger.warn('context.formatter.visual.failure', {
        error: (error as Error).message
      })
      return null
    }
  }

  /**
   * Format selected assets context into a safe message
   * @param selectedAssets - The selected assets data from Asset Manager (IMAGE, VIDEO, PDF)
   * @returns Promise resolving to formatted context or null if formatting fails
   */
  static async formatSelectedAssets(selectedAssets: any): Promise<FormattedContext | null> {
    try {
      if (!Array.isArray(selectedAssets) || selectedAssets.length === 0) {
        return null
      }

      // Collect image URLs for base64 conversion
      const imageUrls: string[] = []
      const imageIndices: Map<number, number> = new Map() // Maps asset index to image array index

      for (let i = 0; i < selectedAssets.length; i++) {
        const asset = selectedAssets[i]
        // SVG is XML code, not a raster image - LLMs cannot process it as vision input
        const isSvg = asset.contentType === 'image/svg+xml' || String(asset.filename || '').toLowerCase().endsWith('.svg')
        if (asset.mediaType === 'IMAGE' && asset.imageUrl && typeof asset.imageUrl === 'string' && !isSvg) {
          imageIndices.set(i, imageUrls.length)
          imageUrls.push(asset.imageUrl)
        }
      }

      // Fetch all images in parallel
      const assetImages: string[] = []
      if (imageUrls.length > 0) {
        logger.info('context.formatter.selected_assets.fetching_images', {
          count: imageUrls.length,
          urls: imageUrls
        })

        const imagePromises = imageUrls.map((url) => fetchImageAsBase64(url))
        const results = await Promise.all(imagePromises)

        for (const result of results) {
          if (result) {
            assetImages.push(result)
          }
        }

        logger.info('context.formatter.selected_assets.images_fetched', {
          requested: imageUrls.length,
          successful: assetImages.length,
          failed: imageUrls.length - assetImages.length
        })
      }

      // Build context for each selected asset (async to support file reading)
      const assetDescriptionPromises = selectedAssets.map(async (asset: any, index: number) => {
        const mediaType = String(asset.mediaType || 'IMAGE')
        const sourceType = String(asset.sourceType || 'unknown')
        const isUploadedFile = sourceType === 'upload'

        const baseInfo = `${mediaType} ${index + 1}:
- Media Type: ${mediaType}
- Source Type: ${sourceType}`

        // Handle different media types
        if (mediaType === 'IMAGE') {
          const sanitizedAsset = {
            filename: String(asset.filename || 'unknown').substring(0, 200),
            imageUrl: String(asset.imageUrl || '').substring(0, 500),
            thumbnailUrl: String(asset.thumbnailUrl || '').substring(0, 500),
            contentType: String(asset.contentType || 'unknown'),
            size: typeof asset.size === 'number' ? asset.size : 0,
            dimensions: {
              width: typeof asset.dimensions?.width === 'number' ? asset.dimensions.width : 0,
              height: typeof asset.dimensions?.height === 'number' ? asset.dimensions.height : 0
            }
          }

          // For uploaded files, DO NOT show API URLs - only show filename and suggested path
          if (isUploadedFile) {
            const fileExtension = sanitizedAsset.filename.includes('.')
              ? sanitizedAsset.filename.substring(sanitizedAsset.filename.lastIndexOf('.'))
              : ''
            const suggestedPath = `/assets/${sanitizedAsset.filename}`
            const projectPath = `public/assets/${sanitizedAsset.filename}`

            return `${baseInfo}
- Original Filename: ${sanitizedAsset.filename}
- Content Type: ${sanitizedAsset.contentType}
- File Size: ${(sanitizedAsset.size / 1024).toFixed(2)} KB
- Dimensions: ${sanitizedAsset.dimensions.width}x${sanitizedAsset.dimensions.height}px

⚠️ UPLOADED FILE - AUTO-RESOLUTION ENABLED

This image has been uploaded and is ready to use. To copy it to the project:

**CRITICAL**: Use file_edit with mode="create" and content="" (empty string)
- The empty content is intentional - the system will automatically copy the uploaded file
- Choose a filename and path based on the user's request or use the suggestion below
- The system will auto-resolve this file by matching the filename

Suggested: file_edit({ path: "${projectPath}", mode: "create", content: "" })
Reference: <img src="${suggestedPath}" alt="description" />

Example with custom name: file_edit({ path: "public/images/hero-bg.png", mode: "create", content: "" })`
          }

          // For non-uploaded files (stock images, etc.), show URLs
          return `${baseInfo}
- Filename: ${sanitizedAsset.filename}
- Image URL: ${sanitizedAsset.imageUrl}
- Thumbnail URL: ${sanitizedAsset.thumbnailUrl}
- Content Type: ${sanitizedAsset.contentType}
- File Size: ${(sanitizedAsset.size / 1024).toFixed(2)} KB
- Dimensions: ${sanitizedAsset.dimensions.width}x${sanitizedAsset.dimensions.height}px`
        } else if (mediaType === 'VIDEO') {
          const sanitizedAsset = {
            videoUrl: String(asset.videoUrl || '').substring(0, 500),
            imageUrl: String(asset.imageUrl || '').substring(0, 500),
            id: String(asset.id || 'unknown'),
            width: typeof asset.width === 'number' ? asset.width : 0,
            height: typeof asset.height === 'number' ? asset.height : 0
          }
          return `${baseInfo}
- Video URL: ${sanitizedAsset.videoUrl}
- Preview Image URL: ${sanitizedAsset.imageUrl}
- Video ID: ${sanitizedAsset.id}
- Dimensions: ${sanitizedAsset.width}x${sanitizedAsset.height}px`
        } else if (mediaType === 'PDF') {
          const sanitizedAsset = {
            filename: String(asset.filename || 'unknown').substring(0, 200),
            imageUrl: String(asset.imageUrl || '').substring(0, 500),
            contentType: String(asset.contentType || 'unknown'),
            size: typeof asset.size === 'number' ? asset.size : 0
          }

          // For uploaded PDFs, don't show API URL
          if (isUploadedFile) {
            const projectPath = `public/data/${sanitizedAsset.filename}`
            const suggestedPath = `/data/${sanitizedAsset.filename}`

            return `${baseInfo}
- Original Filename: ${sanitizedAsset.filename}
- Content Type: ${sanitizedAsset.contentType}
- File Size: ${(sanitizedAsset.size / 1024).toFixed(2)} KB

⚠️ UPLOADED FILE - AUTO-RESOLUTION ENABLED

This PDF has been uploaded and is ready to use. To copy it to the project:

**CRITICAL**: Use file_edit with mode="create" and content="" (empty string)
- The empty content is intentional - the system will automatically copy the uploaded file
- Choose a filename and path based on the user's request or use the suggestion below
- The system will auto-resolve this file by matching the filename

Suggested: file_edit({ path: "${projectPath}", mode: "create", content: "" })
Reference: <a href="${suggestedPath}">Download PDF</a>`
          }

          return `${baseInfo}
- Filename: ${sanitizedAsset.filename}
- PDF URL: ${sanitizedAsset.imageUrl}
- Content Type: ${sanitizedAsset.contentType}
- File Size: ${(sanitizedAsset.size / 1024).toFixed(2)} KB`
        } else if (mediaType === 'FILE') {
          const sanitizedAsset = {
            filename: String(asset.filename || 'unknown').substring(0, 200),
            imageUrl: String(asset.imageUrl || '').substring(0, 500),
            contentType: String(asset.contentType || 'unknown'),
            size: typeof asset.size === 'number' ? asset.size : 0
          }

          // For uploaded files, read content and include it
          if (isUploadedFile) {
            // Read file content
            const fileContent = await readUploadedFileContent(sanitizedAsset.imageUrl, sanitizedAsset.filename)

            let contentSection = ''
            if (fileContent) {
              contentSection = `\n\nFile Content:\n\`\`\`\n${fileContent}\n\`\`\``
            } else {
              contentSection = '\n\n⚠️ Could not read file content - file may be missing or unreadable'
            }

            return `${baseInfo}
- Original Filename: ${sanitizedAsset.filename}
- Content Type: ${sanitizedAsset.contentType}
- File Size: ${(sanitizedAsset.size / 1024).toFixed(2)} KB${contentSection}

This is an uploaded instruction file. The content is provided above - use it as instructions, data, or reference material. No need to copy this file to the project.`
          }

          return `${baseInfo}
- Filename: ${sanitizedAsset.filename}
- Content Type: ${sanitizedAsset.contentType}
- File Size: ${(sanitizedAsset.size / 1024).toFixed(2)} KB`
        }
        return baseInfo
      })

      const assetDescriptions = (await Promise.all(assetDescriptionPromises)).join('\n\n')

      const assetTypes = selectedAssets.map((a: any) => a.mediaType).join(', ')
      const hasVisualAssets = assetImages.length > 0

      // Check if any assets are uploaded files (have upload sourceType)
      const hasUploadedFiles = selectedAssets.some((a: any) => a.sourceType === 'upload')

      const content = `[Selected Assets from Asset Manager]

The user has selected ${selectedAssets.length} asset${selectedAssets.length > 1 ? 's' : ''} from the Asset Manager (${assetTypes}):

${assetDescriptions}

${hasVisualAssets ? `Visual Context: ${assetImages.length} image${assetImages.length > 1 ? 's are' : ' is'} attached for visual reference.\n` : ''}
**CRITICAL: How to Use These Assets**

${hasUploadedFiles ? `⚠️ THESE ARE UPLOADED FILES - NEVER use the API URLs shown above directly in code! ⚠️

MANDATORY WORKFLOW for uploaded files:

1. **FIRST: Copy file to project** using file_edit with mode: "create":
   - Images: "public/assets/[filename]"
   - Fonts: "public/fonts/[filename]"
   - Data: "public/data/[filename]"

2. **System auto-resolves**: Creating a file matching the uploaded filename automatically copies it from uploads.

3. **THEN: Reference with project paths ONLY**: Use "/assets/image.png" in code, NEVER agent upload URLs.

FORBIDDEN (will break in production):
❌ <img src="https://agent-url.com/files/uploads/{appId}/file.png" />
❌ Any URL containing "/files/uploads/" - these are temporary upload URLs

REQUIRED (correct approach):
✅ file_edit({ path: "public/assets/logo.png", mode: "create", content: "" })
✅ <img src="/assets/logo.png" />

Example complete workflow:
- User uploads "hero-image.jpg"
- You: file_edit({ path: "public/assets/hero-image.jpg", mode: "create", content: "" })
- System: Automatically copies from uploads
- You: Write code with <img src="/assets/hero-image.jpg" />
` : `These assets are available for use in the project. You can reference them by their URLs in your code.
`}When the user mentions "this asset", "this image", "this video", or "this PDF", they are likely referring to the selected asset${selectedAssets.length > 1 ? 's' : ''} above.${hasVisualAssets ? ' Analyze the attached images to understand their visual appearance, content, and style.' : ''}`

      // Log detailed asset image information for debugging
      logger.info('context.formatter.selected_assets.returning', {
        assetCount: selectedAssets.length,
        imageUrlCount: imageUrls.length,
        assetImagesCount: assetImages.length,
        assetImages: assetImages.map((img, i) => ({
          index: i,
          type: img.substring(5, img.indexOf(';')),
          length: img.length,
          isDataUrl: img.startsWith('data:')
        }))
      })

      return {
        content,
        type: 'selected_assets_context',
        ...(assetImages.length > 0 && { assetImages })
      }
    } catch (error) {
      logger.warn('context.formatter.selected_assets.failure', {
        error: (error as Error).message
      })
      return null
    }
  }

  /**
   * Format build error context into a safe message
   * @param buildError - The build error context from publish failures
   * @returns Formatted context or null if formatting fails
   */
  static formatBuildError(buildError: any): FormattedContext | null {
    try {
      if (!buildError || typeof buildError !== 'object') {
        return null
      }

      // Sanitize and validate the error data
      const sanitizedError = {
        error: String(buildError.error || 'Unknown build error').substring(0, 500),
        details: String(buildError.details || 'No details available').substring(0, 10000),
        exitCode: Number.isInteger(buildError.exitCode) ? buildError.exitCode : undefined
      }

      const formattedMessage = `
## Build Error Context

The build process failed when trying to publish the application. Please analyze the error and fix the underlying issue.

**Error Message:**
${sanitizedError.error}

${sanitizedError.exitCode !== undefined ? `**Exit Code:** ${sanitizedError.exitCode}\n` : ''}
**Build Output:**
\`\`\`
${sanitizedError.details}
\`\`\`

Please review the error output above, identify the root cause, and make the necessary changes to fix the build.

With the terminal tool, you should be able to run "npm run build" without any errors.

After fixing the issue and confirming the build is successful, inform the user to try the Publish button again.
`.trim()

      logger.info('context.formatter.build_error.success', {
        hasError: !!buildError.error,
        hasDetails: !!buildError.details,
        hasExitCode: buildError.exitCode !== undefined,
        errorLength: buildError.error?.length || 0,
        detailsLength: buildError.details?.length || 0
      })

      return {
        type: 'build_error_context',
        content: formattedMessage
      }
    } catch (error) {
      logger.error('context.formatter.build_error.error', {
        error: (error as Error).message
      })
      return null
    }
  }
}

