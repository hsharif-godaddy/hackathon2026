'use client'

import { useEffect, useState } from 'react';
import AttachmentIcon from '@ux/icon/attachment';
import ImageIcon from '@ux/icon/image';
import VideoIcon from '@ux/icon/video';
import XThickIcon from '@ux/icon/x-thick';
import Spinner from '@ux/spinner';
import text from '@ux/text';

import { AssetManagerItem, MediaType } from '@/app/[market]/develop/components/chat/AssetTypes'
import { useTranslations } from '@/hooks/useTranslations'
import { cn } from '@/lib/utils'

const ASSET_CLASSES = 'flex flex-col items-center justify-center size-[76px] rounded border border-intents-ux-box-borderColor'

/**
 * Asset display mode enumeration
 */
export enum AssetMode {
  EDIT = 'edit',
  PREVIEW = 'preview',
}

interface CustomAsset {
  imageUrl?: string
  imageAlt?: string
  mediaType: MediaType
  /** Shown as the caption for non-image / fallback image rows (e.g. staged local files) */
  filename?: string
}

interface AssetInlineProps {
  asset?: AssetManagerItem
  customAsset?: CustomAsset
  onClear: () => void
  mode?: AssetMode
  isLoading?: boolean
}

export default function AssetInline({
    asset,
    customAsset,
    onClear,
    mode,
    isLoading = false
  }: AssetInlineProps) {
  const t = useTranslations();
  // Track image load failures so we degrade to icon+filename instead of broken image
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  // Reset failure state when the asset URL changes (e.g. component reused for different asset)
  const currentImageUrl = asset?.imageUrl || customAsset?.imageUrl;
  useEffect(() => {
    setImageLoadFailed(false);
  }, [currentImageUrl]);

  // Get the active asset (prefer asset, fallback to customAsset)
  const activeAsset = asset || customAsset

  // Helper function to get the display URL for an asset
  const getAssetDisplayUrl = (item: AssetManagerItem | CustomAsset): string | undefined => {
    if (!item.imageUrl) {
      return undefined
    }
    return item.imageUrl.startsWith('//') ? `https:${item.imageUrl}` : item.imageUrl
  }

  // Helper function to get the asset label
  const getAssetLabel = (item: AssetManagerItem | CustomAsset): string => {
    if ('filename' in item && item.filename) {
      return item.filename
    }
    switch (item.mediaType) {
      case MediaType.IMAGE:
        return t('builder_chatpane_asset_image')
      case MediaType.VIDEO:
        return t('builder_chatpane_asset_video')
      case MediaType.PDF:
        return t('builder_chatpane_asset_pdf')
      case MediaType.FILE:
        return t('builder_chatpane_asset_default')
      default:
        return t('builder_chatpane_asset_default')
    }
  }

  if (!activeAsset) {
    if (isLoading) {
      return (
        <div className="relative inline-block">
          <div className={cn(ASSET_CLASSES, 'justify-center bg-intents-ux-box-backgroundColor')}>
            <Spinner size="sm" />
          </div>
        </div>
      )
    }
    return null
  }

  const label = getAssetLabel(activeAsset)
  /** Light blur so dark photos do not turn muddy under the overlay */
  const mediaBlurClass = isLoading ? 'blur-[2px]' : undefined

  return (
    <div className="relative inline-block">
      {activeAsset.mediaType === MediaType.IMAGE && activeAsset.imageUrl && !imageLoadFailed ? (
        // Images with URL render as thumbnails
        <img // eslint-disable-line @next/next/no-img-element
          src={getAssetDisplayUrl(activeAsset)}
          alt={customAsset?.imageAlt || label}
          onError={() => setImageLoadFailed(true)}
          className={cn(ASSET_CLASSES, 'object-cover', mediaBlurClass)}
        />
      ) : activeAsset.mediaType === MediaType.IMAGE ? (
        // Images WITHOUT URL render as icon with filename (fallback)
        <div className={cn(ASSET_CLASSES, 'justify-end gap-0.5 px-1 py-0.5', mediaBlurClass)}>
          <ImageIcon />
          <text.div as='caption' size={-2} className='truncate max-w-full'>
            {label}
          </text.div>
        </div>
      ) : activeAsset.mediaType === MediaType.VIDEO ? (
        // Videos render as icon with filename
        <div className={cn(ASSET_CLASSES, 'justify-end gap-0.5 px-1 py-0.5', mediaBlurClass)}>
          <VideoIcon />
          <text.div as='caption' size={-2} className='truncate max-w-full'>
            {label}
          </text.div>
        </div>
      ) : (
        // PDF and FILE types render as attachment icon with filename
        <div className={cn(ASSET_CLASSES, 'justify-end gap-0.5 px-1 py-0.5', mediaBlurClass)}>
          <AttachmentIcon />
          <text.div as='caption' size={-2} className='truncate max-w-full'>
            {label}
          </text.div>
        </div>
      )}
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded ring-1 ring-inset ring-intents-ux-box-borderColor/25 bg-intents-ux-boxLowContrast-backgroundColor/88 shadow-none"
          aria-busy="true"
        >
          <Spinner size="sm" />
        </div>
      )}
      {mode === AssetMode.EDIT && onClear && !isLoading && (
        <button
          type="button"
          data-testid="chat-staged-file-clear"
          onClick={onClear}
          className="absolute top-0.5 right-0.5 size-3 flex items-center shadow-lg justify-center bg-intents-ux-box-backgroundColor rounded-full cursor-pointer border border-intents-ux-box-borderColor"
          title={t('builder_chatpane_clear_asset')}
        >
          <XThickIcon className='size-2' />
        </button>
      )}
    </div>
  )
}

interface AssetInlineListProps {
  assets: AssetManagerItem[]
  onClearAsset: (index: number) => void
  className?: string
  mode?: AssetMode
}

export function AssetInlineList({
    assets,
    onClearAsset,
    className,
    mode = AssetMode.PREVIEW,
  }: AssetInlineListProps) {

  if (assets.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {assets.length > 0 && (
        <div className="flex flex-wrap gap-1 max-h-[160px] overflow-y-auto">
          {assets.map((asset, index) => (
            <AssetInline
              key={asset.filename || asset.imageUrl || index}
              asset={asset}
              onClear={() => onClearAsset(index)}
              mode={mode}
            />
          ))}
        </div>
      )}
    </div>
  )
}

