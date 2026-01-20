'use client'

import dynamic from 'next/dynamic'

import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context'

/**
 * Media type enumeration for asset manager items
 */
export enum MediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
  PDF = 'PDF',
}

/**
 * Base properties common to all asset types
 */
interface BaseAsset {
  /** The type of media */
  mediaType: MediaType
  /** The source type (e.g., 'gc', 'vimeo') */
  sourceType: string
  /** The URL to the thumbnail or preview image (protocol-relative) */
  imageUrl: string
}

/**
 * Represents an image asset from the Asset Manager
 */
export interface ImageAsset extends BaseAsset {
  mediaType: MediaType.IMAGE
  /** The filename of the image */
  filename: string
  /** The MIME content type */
  contentType: string
  /** File size in bytes */
  size: number
  /** Image dimensions */
  dimensions: {
    width: number
    height: number
  }
  /** The URL to the thumbnail image (protocol-relative) */
  thumbnailUrl: string
  /** Alt text for accessibility */
  altText?: string
}

/**
 * Represents a video asset from the Asset Manager
 */
export interface VideoAsset extends BaseAsset {
  mediaType: MediaType.VIDEO
  /** The video URL */
  videoUrl: string
  /** Video ID */
  id: string
  /** URL hash */
  urlHash: string
  /** Video width */
  width: number
  /** Video height */
  height: number
}

/**
 * Represents a PDF asset from the Asset Manager
 */
export interface PDFAsset extends BaseAsset {
  mediaType: MediaType.PDF
  /** The filename of the PDF */
  filename: string
  /** The MIME content type */
  contentType: string
  /** File size in bytes */
  size: number
  /** The URL to the thumbnail image (protocol-relative) */
  thumbnailUrl: string
}

/**
 * Union type representing any asset from the Asset Manager
 */
export type AssetManagerItem = ImageAsset | VideoAsset | PDFAsset

/**
 * Props for AssetManagerModal component
 */
interface AssetManagerModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal is closed */
  onClose: () => void
  /** Callback when items are selected */
  onItemsSelected: (items: AssetManagerItem[]) => void
  /** Venture ID for the asset manager */
  ventureId: string | null
  /** Current number of assets already selected */
  currentAssetCount?: number
  /** The max number of assets a user can select */
  maxAssets?: number
}

/**
 * Get the hostname for the Asset Manager
 *
 * @returns The root domain (last two parts of hostname)
 */
function getHostname() {
  if (typeof window === 'undefined') return ''
  return window?.location?.hostname?.split('.')?.slice(-2)?.join('.') || window.location.origin
}

// Dynamically import the ImageManagerLoader with SSR disabled
const ImageManagerLoader = dynamic(
  async () => {
    // Load PropTypes first and make it globally available
    const PropTypes = await import('prop-types')
    if (typeof window !== 'undefined') {
      (window as any).PropTypes = PropTypes.default
    }
    // Then load the ImageManagerLoader
    const imageManagerModule = await import('@wsb/image-manager-loader')
    return imageManagerModule.default
  },
  { ssr: false }
) as any

/**
 * Modal component for managing assets (images, videos, PDFs) using the GoDaddy Asset Manager
 *
 * Provides a full-screen modal interface for selecting and uploading various media assets.
 * Uses the @wsb/image-manager-loader package to provide the asset management UI.
 * Supports IMAGE, VIDEO, and PDF media types.
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false)
 *
 * <AssetManagerModal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onItemsSelected={(items) => console.log('Selected:', items)}
 * />
 * ```
 */
export default function AssetManagerModal({ 
    isOpen,
    onClose,
    onItemsSelected,
    ventureId,
    currentAssetCount = 0,
    maxAssets = 1 
  }: AssetManagerModalProps) {
  const t = useTranslations();
  // Don't render anything if ventureId is not available yet
  if (!ventureId) {
    return null;
  }

  // Calculate how many more assets can be selected
  const selectionLimit = Math.max(0, maxAssets - currentAssetCount)

  // Don't render the modal if we're already at the limit
  if (selectionLimit === 0) {
    return null;
  }

  return (
    <div style={{ display: isOpen ? 'block' : 'none' }}>
      {isOpen && (
        <ImageManagerLoader
          key={`asset-manager-${currentAssetCount}`}
          appName="airobuilde"
          businessCategory="tech"
          ventureId={ventureId}
          onItemsSelectedCallback={(items: any[]) => {
          logger.debug('asset_manager.items.selected', {
            itemCount: items.length,
            items: items.map((i: any) => ({ mediaType: i.mediaType, sourceType: i.sourceType }))
          });
          
          if (items.length > 0) {
            onItemsSelected(items);
          }
          onClose();
        }}
        onModalCloseCallback={onClose}
        rootDomain={getHostname()}
        selectionLimit={selectionLimit}
        autoSelectAfterUpload={true}
        removeSources={['STOCK_MEDIA', 'SOCIAL_MEDIA']}
        mediaTypes={[MediaType.IMAGE, MediaType.VIDEO, MediaType.PDF]}
        market="en-US"
        modalTitle={selectionLimit > 1 ? t('builder_asset_manager_title', { number: selectionLimit }) : null}
        />
      )}
    </div>
  );
}
