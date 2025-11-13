import { logger } from '../../logging/index.js'

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
 * Fetch image from URL and convert to base64 data URL
 * @param imageUrl - URL of the image to fetch
 * @returns Promise resolving to data URL or null if fetch fails
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
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
        if (asset.mediaType === 'IMAGE' && asset.imageUrl && typeof asset.imageUrl === 'string') {
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

      // Build context for each selected asset
      const assetDescriptions = selectedAssets.map((asset: any, index: number) => {
        const mediaType = String(asset.mediaType || 'IMAGE')
        const baseInfo = `${mediaType} ${index + 1}:
- Media Type: ${mediaType}
- Source Type: ${String(asset.sourceType || 'unknown')}`

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
          return `${baseInfo}
- Filename: ${sanitizedAsset.filename}
- PDF URL: ${sanitizedAsset.imageUrl}
- Content Type: ${sanitizedAsset.contentType}
- File Size: ${(sanitizedAsset.size / 1024).toFixed(2)} KB`
        }
        return baseInfo
      }).join('\n\n')

      const assetTypes = selectedAssets.map((a: any) => a.mediaType).join(', ')
      const hasVisualAssets = assetImages.length > 0
      
      const content = `[Selected Assets from Asset Manager]

The user has selected ${selectedAssets.length} asset${selectedAssets.length > 1 ? 's' : ''} from the Asset Manager (${assetTypes}):

${assetDescriptions}

${hasVisualAssets ? `Visual Context: ${assetImages.length} image${assetImages.length > 1 ? 's are' : ' is'} attached for visual reference.\n` : ''}
These assets are available for use in the project. You can reference them by their URLs in your code.
When the user mentions "this asset", "this image", "this video", or "this PDF", they are likely referring to the selected asset${selectedAssets.length > 1 ? 's' : ''} above.${hasVisualAssets ? ' Analyze the attached images to understand their visual appearance, content, and style.' : ''}`

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

With the terminal tool, you should be able to run "pnpm run build" without any errors.

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

