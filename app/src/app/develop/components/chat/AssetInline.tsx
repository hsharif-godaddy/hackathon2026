'use client'

import AttachmentIcon from '@ux/icon/attachment';
import XThickIcon from '@ux/icon/x-thick';
import text from '@ux/text';

import { AssetManagerItem, MediaType } from '@/app/develop/components/chat/AssetManagerModal'
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
  mediaType: MediaType,
}

interface AssetInlineProps {
  asset?: AssetManagerItem
  customAsset?: CustomAsset
  onClear: () => void
  mode?: AssetMode
}

export default function AssetInline({
    asset,
    customAsset,
    onClear,
    mode
  }: AssetInlineProps) {
  const t = useTranslations();

  // Get the active asset (prefer asset, fallback to customAsset)
  const activeAsset = asset || customAsset

  // Helper function to get the display URL for an asset
  const getAssetDisplayUrl = (item: AssetManagerItem | CustomAsset): string => {
    const url = item.imageUrl.startsWith('//') ? `https:${item.imageUrl}` : item.imageUrl
    return url
  }

  // Helper function to get the asset label
  const getAssetLabel = (item: AssetManagerItem | CustomAsset): string => {
    switch (item.mediaType) {
      case MediaType.IMAGE:
        // For AssetManagerItem, use filename if available; for CustomAsset, use default
        return 'filename' in item && item.filename ? item.filename : t('builder_chatpane_asset_image')
      case MediaType.VIDEO:
        return t('builder_chatpane_asset_video')
      case MediaType.PDF:
        // For AssetManagerItem, use filename if available; for CustomAsset, use default
        return 'filename' in item && item.filename ? item.filename : t('builder_chatpane_asset_pdf')
      default:
        return t('builder_chatpane_asset_default')
    }
  }

  if (!activeAsset) {
    return null
  }

  const label = getAssetLabel(activeAsset);

  return (
    <div className="relative inline-block">
      {activeAsset.mediaType === MediaType.IMAGE || activeAsset.mediaType === MediaType.VIDEO ? (
        <img // eslint-disable-line @next/next/no-img-element
          src={getAssetDisplayUrl(activeAsset)}
          alt={customAsset?.imageAlt || label}
          className={cn(ASSET_CLASSES, 'object-cover')}
        />
      ) : (
        <div className={cn(ASSET_CLASSES, 'justify-end gap-0.5 px-1 py-0.5')}>
          <AttachmentIcon />
          <text.div as='caption' size={-2} className='truncate max-w-full'>
            {label}
          </text.div>
        </div>
      )}
      {mode === AssetMode.EDIT && onClear && (
        <button
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
              key={asset.imageUrl}
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

