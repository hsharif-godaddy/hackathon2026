import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../../logging/index.js'
import { readUploadedFileContent } from '../helpers/ContextFormatter.js'

interface SelectedAsset {
  mediaType: 'IMAGE' | 'VIDEO' | 'PDF' | 'FILE'
  sourceType: string
  imageUrl: string
  filename?: string
  contentType?: string
  size?: number
  dimensions?: {
    width: number
    height: number
  }
  thumbnailUrl?: string
  altText?: string
  videoUrl?: string
  id?: string
  urlHash?: string
  width?: number
  height?: number
}

export class SelectedAssetsContextRenderer implements ContextAttachmentRenderer<SelectedAsset[]> {
  canHandle(type: string): boolean {
    return type === 'selected_assets'
  }

  async render(
    attachment: ContextAttachment<SelectedAsset[]>,
    _userPrompt: string
  ): Promise<RenderedContext | null> {
    try {
      const assets = attachment.data

      if (!assets || !Array.isArray(assets) || assets.length === 0) {
        return null
      }

      const formattedAssetPromises = assets.map(async (asset, index) => {
        const parts: string[] = []

        parts.push(`**Asset ${index + 1}:** ${asset.mediaType}`)

        if (asset.filename) {
          // Sanitize filename for display: strip newlines and control chars to prevent structure injection
          const displayFilename = asset.filename.replace(/[\n\r\t\0]/g, '_').substring(0, 200)
          parts.push(`- Filename: ${displayFilename}`)
        }

        if (asset.sourceType) {
          parts.push(`- Source: ${asset.sourceType}`)
        }

        if (asset.dimensions) {
          parts.push(`- Dimensions: ${asset.dimensions.width}x${asset.dimensions.height}`)
        }

        if (asset.size) {
          const sizeMB = (asset.size / (1024 * 1024)).toFixed(2)
          parts.push(`- Size: ${sizeMB} MB`)
        }

        if (asset.contentType) {
          parts.push(`- Type: ${asset.contentType}`)
        }

        if (asset.altText) {
          parts.push(`- Alt Text: ${asset.altText}`)
        }

        if (asset.imageUrl && asset.sourceType !== 'upload') {
          parts.push(`- URL: ${asset.imageUrl}`)
        }

        if (asset.videoUrl) {
          parts.push(`- Video URL: ${asset.videoUrl}`)
        }

        // Handle FILE uploads: read content from disk
        if (asset.mediaType === 'FILE' && asset.sourceType === 'upload' && asset.imageUrl && asset.filename) {
          const fileContent = await readUploadedFileContent(asset.imageUrl, asset.filename)
          if (fileContent) {
            parts.push('')
            parts.push(`File Content:`)
            const escapedContent = fileContent.replace(/~{3,}/g, (m) => '\\' + m)
            parts.push('~~~')
            parts.push(escapedContent)
            parts.push('~~~')
            parts.push('')
            parts.push('This is an uploaded instruction file. The content is provided above - use it as instructions, data, or reference material.')
          } else {
            parts.push('')
            parts.push('⚠️ Could not read file content - file may be missing or unreadable')
          }
        }

        // Handle uploaded IMAGE/PDF: include auto-resolution instructions
        if (asset.sourceType === 'upload' && asset.filename && (asset.mediaType === 'IMAGE' || asset.mediaType === 'PDF')) {
          // Sanitize filename: strip path separators, quotes, control chars; clamp length
          const filename = asset.filename
            .replace(/[/\\:"'`\n\r\t\0]/g, '_')
            .substring(0, 200)
          const subdir = asset.mediaType === 'IMAGE' ? 'assets' : 'data'
          const projectPath = `public/${subdir}/${filename}`
          const refPath = `/${subdir}/${filename}`

          parts.push('')
          parts.push('⚠️ UPLOADED FILE - AUTO-RESOLUTION ENABLED')
          parts.push('')
          parts.push('**CRITICAL**: Use file_edit with mode="create" and content="" (empty string)')
          parts.push('- The empty content is intentional - the system will automatically copy the uploaded file')
          parts.push(`- Suggested: file_edit({ path: "${projectPath}", mode: "create", content: "" })`)
          if (asset.mediaType === 'IMAGE') {
            parts.push(`- Reference: <img src="${refPath}" alt="description" />`)
          } else {
            parts.push(`- Reference: <a href="${refPath}">Download PDF</a>`)
          }
        }

        return parts.join('\n')
      })

      const formattedAssets = (await Promise.all(formattedAssetPromises)).join('\n\n')

      const content = `### Selected Assets from Asset Manager

${formattedAssets}

The user's message refers to using or integrating the above selected asset(s).`

      return {
        role: 'user',
        content,
        insertionOrder: 'after_history'
      }
    } catch (error) {
      logger.error('context.attachment.render.selected_assets.error', {
        error: error instanceof Error ? error.message : String(error),
        attachmentType: attachment.type
      })
      return null
    }
  }

  shouldPersist(attachment: ContextAttachment<SelectedAsset[]>): boolean {
    return attachment.persistence === 'save'
  }
}
