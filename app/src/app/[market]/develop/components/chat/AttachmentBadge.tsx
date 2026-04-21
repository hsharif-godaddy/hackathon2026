'use client'

import { useEffect, useState } from 'react'
import AttachmentIcon from '@ux/icon/attachment'
import ImageIcon from '@ux/icon/image'
import VideoIcon from '@ux/icon/video'
import text from '@ux/text'

import { AssetManagerItem, MediaType } from '@/app/[market]/develop/components/chat/AssetTypes'
import MediaModal from '@/app/[market]/develop/components/tool-renderers/MediaModal'
import { useTranslations } from '@/hooks/useTranslations'
import { cn } from '@/lib/utils'

interface AttachmentBadgeProps {
  asset: AssetManagerItem
  className?: string
}

function getMediaIcon(mediaType: MediaType) {
  switch (mediaType) {
    case MediaType.IMAGE:
      return <ImageIcon className="size-3 flex-shrink-0" />
    case MediaType.VIDEO:
      return <VideoIcon className="size-3 flex-shrink-0" />
    case MediaType.PDF:
    case MediaType.FILE:
      return <AttachmentIcon className="size-3 flex-shrink-0" />
    default:
      return <AttachmentIcon className="size-3 flex-shrink-0" />
  }
}

function getFilename(asset: AssetManagerItem): string | undefined {
  if ('filename' in asset && asset.filename) {
    return asset.filename
  }
  return undefined
}

function getFileSize(asset: AssetManagerItem): string {
  if ('size' in asset && typeof asset.size === 'number') {
    const kb = asset.size / 1024
    if (kb < 1024) {
      return `${kb.toFixed(1)} KB`
    }
    return `${(kb / 1024).toFixed(1)} MB`
  }
  return ''
}

function getDisplayUrl(imageUrl: string): string {
  return imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl
}

export default function AttachmentBadge({ asset, className }: AttachmentBadgeProps) {
  const t = useTranslations()
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  useEffect(function resetFailedOnUrlChange() {
    setImageLoadFailed(false)
  }, [asset.imageUrl])
  const filename = getFilename(asset) ?? t('builder_common_attachment_default')
  const fileSize = getFileSize(asset)

  if (asset.mediaType === MediaType.IMAGE && asset.imageUrl && !imageLoadFailed) {
    const displayUrl = getDisplayUrl(asset.imageUrl)
    return (
      <>
        <button
          type="button"
          aria-label={t('builder_common_view_filename', { filename })}
          onClick={() => setIsModalOpen(true)}
          className={cn(
            'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor cursor-pointer hover:opacity-80 transition-opacity',
            className
          )}
        >
          <img // eslint-disable-line @next/next/no-img-element
            src={displayUrl}
            alt={filename}
            onError={() => setImageLoadFailed(true)}
            className="size-8 rounded object-cover flex-shrink-0"
          />
          <div className="flex flex-col min-w-0 text-left">
            <text.span as="caption" size={-1} className="truncate max-w-[120px]">
              {filename}
            </text.span>
            {fileSize && (
              <text.span as="caption" size={-2} className="opacity-60">
                {fileSize}
              </text.span>
            )}
          </div>
        </button>
        {isModalOpen && (
          <MediaModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            title={filename}
          >
            <img // eslint-disable-line @next/next/no-img-element
              src={displayUrl}
              alt={filename}
              className="w-full h-auto rounded"
            />
          </MediaModal>
        )}
      </>
    )
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor',
        className
      )}
    >
      {getMediaIcon(asset.mediaType)}
      <text.span as="caption" size={-1} className="truncate max-w-[120px]">
        {filename}
      </text.span>
      {fileSize && (
        <text.span as="caption" size={-2} className="opacity-60">
          {fileSize}
        </text.span>
      )}
    </div>
  )
}

interface AttachmentListProps {
  assets: AssetManagerItem[]
  className?: string
}

export function AttachmentList({ assets, className }: AttachmentListProps) {
  if (assets.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-wrap gap-1 mt-1', className)}>
      {assets.map((asset, index) => (
        <AttachmentBadge key={`${asset.imageUrl}-${index}`} asset={asset} />
      ))}
    </div>
  )
}
