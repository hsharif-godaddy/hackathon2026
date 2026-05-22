import type { ContextAttachment } from './types.js'

export interface BuildContextAttachmentsCustomContext {
  type?: string
  data?: unknown
  persistence?: 'save' | 'ephemeral'
  source?: string
  customAttachments?: ContextAttachment[]
  referencedFiles?: Array<{ path: string; content: string }>
}

export interface BuildContextAttachmentAsset {
  imageUrl?: string
  thumbnailUrl?: string
  videoUrl?: string
}

export interface BuildContextAttachmentsBuildErrorContext {
  error?: string
  details?: string
  exitCode?: number
}

export interface BuildContextAttachmentsInput<
  TAsset extends BuildContextAttachmentAsset = BuildContextAttachmentAsset
> {
  aiEditContext?: unknown
  aiEditContexts?: unknown[]
  visualContext?: unknown
  selectedAssets?: TAsset[]
  todoListContext?: unknown
  buildErrorContext?: BuildContextAttachmentsBuildErrorContext | null
  isActionRequest?: boolean
  customContext?: BuildContextAttachmentsCustomContext
  timestamp?: number
}

function normalizeAssetUrls<TAsset extends BuildContextAttachmentAsset>(assets: TAsset[] | undefined): TAsset[] {
  if (!assets || assets.length === 0) return []

  return assets.map(asset => ({
    ...asset,
    ...(typeof asset.imageUrl === 'string' && {
      imageUrl: asset.imageUrl.startsWith('//') ? `https:${asset.imageUrl}` : asset.imageUrl
    }),
    ...(typeof asset.thumbnailUrl === 'string' && {
      thumbnailUrl: asset.thumbnailUrl.startsWith('//') ? `https:${asset.thumbnailUrl}` : asset.thumbnailUrl
    }),
    ...(typeof asset.videoUrl === 'string' && {
      videoUrl: asset.videoUrl.startsWith('//') ? `https:${asset.videoUrl}` : asset.videoUrl
    }),
  }))
}

export function buildContextAttachments<
  TAsset extends { imageUrl?: string; thumbnailUrl?: string; videoUrl?: string }
>(params: BuildContextAttachmentsInput<TAsset>): ContextAttachment[] {
  const attachments: ContextAttachment[] = []
  const timestamp = params.timestamp ?? Date.now()

  if (params.aiEditContexts && params.aiEditContexts.length > 0) {
    attachments.push({
      type: 'ai_edit_contexts',
      data: params.aiEditContexts,
      persistence: 'save',
      renderStrategy: 'before_prompt',
      metadata: { timestamp, source: 'ai-edit-dialog' },
    })
  } else if (params.aiEditContext) {
    attachments.push({
      type: 'ai_edit_context',
      data: params.aiEditContext,
      persistence: 'save',
      renderStrategy: 'before_prompt',
      metadata: { timestamp, source: 'ai-edit-dialog' },
    })
  }

  if (params.visualContext) {
    attachments.push({
      type: 'visual_context',
      data: params.visualContext,
      persistence: 'ephemeral',
      renderStrategy: 'before_prompt',
      metadata: { timestamp, source: 'iframe-capture' },
    })
  }

  const normalizedAssets = normalizeAssetUrls(params.selectedAssets)
  if (normalizedAssets.length > 0) {
    attachments.push({
      type: 'selected_assets',
      data: normalizedAssets,
      persistence: 'ephemeral',
      renderStrategy: 'before_prompt',
      metadata: { timestamp, source: 'asset-manager' },
    })
  }

  if (params.buildErrorContext) {
    attachments.push({
      type: 'build_error',
      data: {
        error: params.buildErrorContext.error,
        details: params.buildErrorContext.details,
        exitCode: params.buildErrorContext.exitCode,
      },
      persistence: 'ephemeral',
      renderStrategy: 'before_prompt',
      metadata: { timestamp, source: 'publish-failure' },
    })
  }

  if (params.todoListContext) {
    attachments.push({
      type: 'todo_list_context',
      data: params.todoListContext,
      persistence: 'save',
      renderStrategy: 'before_prompt',
      metadata: { timestamp, source: 'todo-list-tool' },
    })
  }

  if (params.isActionRequest) {
    attachments.push({
      type: 'action_request',
      data: { instruction: '[Action Request] Execute this request immediately. Do not summarize previous work.' },
      persistence: 'ephemeral',
      renderStrategy: 'before_prompt',
      metadata: { timestamp, source: 'suggested_response' },
    })
  }

  if (params.customContext) {
    if (params.customContext.referencedFiles && params.customContext.referencedFiles.length > 0) {
      attachments.push({
        type: 'referenced_files',
        data: params.customContext.referencedFiles,
        persistence: 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: { timestamp, source: 'file-reference' },
      })
    }

    if (params.customContext.customAttachments && Array.isArray(params.customContext.customAttachments)) {
      attachments.push(...params.customContext.customAttachments)
    } else if (params.customContext.type && params.customContext.data) {
      attachments.push({
        type: params.customContext.type,
        data: params.customContext.data,
        persistence: params.customContext.persistence || 'ephemeral',
        renderStrategy: 'before_prompt',
        metadata: {
          timestamp,
          source: params.customContext.source || 'custom-context',
        },
      })
    }
  }

  return attachments
}
