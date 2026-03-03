import type { ContextAttachment, ContextAttachmentRenderer, RenderedContext } from '@airo/shared/context-attachment'
import { logger } from '../../logging/index.js'

interface SelectedAsset {
  mediaType: 'IMAGE' | 'VIDEO' | 'PDF'
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

      const formattedAssets = assets.map((asset, index) => {
        const parts: string[] = []
        
        parts.push(`**Asset ${index + 1}:** ${asset.mediaType}`)
        
        if (asset.filename) {
          parts.push(`- Filename: ${asset.filename}`)
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
        
        if (asset.imageUrl) {
          parts.push(`- URL: ${asset.imageUrl}`)
        }
        
        if (asset.videoUrl) {
          parts.push(`- Video URL: ${asset.videoUrl}`)
        }

        return parts.join('\n')
      }).join('\n\n')

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
