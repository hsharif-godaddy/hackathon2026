'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'

/**
 * Represents an image item from the Image Manager
 */
export interface ImageManagerItem {
  /** The filename of the image */
  filename: string
  /** The URL to the full-size image (protocol-relative) */
  imageUrl: string
  /** The type of media (e.g., 'IMAGE') */
  mediaType: string
  /** The source type (e.g., 'gc') */
  sourceType: string
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
}

/**
 * Props for ImageManagerModal component
 */
interface ImageManagerModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal is closed */
  onClose: () => void
  /** Callback when items are selected */
  onItemsSelected: (items: ImageManagerItem[]) => void
}

/**
 * Get the hostname for the Image Manager
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
 * Modal component for managing images using the GoDaddy Image Manager
 *
 * Provides a full-screen modal interface for selecting and uploading images.
 * Uses the @wsb/image-manager-loader package to provide the image management UI.
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false)
 *
 * <ImageManagerModal
 *   isOpen={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onItemsSelected={(items) => console.log('Selected:', items)}
 * />
 * ```
 */
export default function ImageManagerModal({ isOpen, onClose, onItemsSelected }: ImageManagerModalProps) {
  const [isReady, setIsReady] = useState(false)
  const [ventureId, setVentureId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(function fetchVentureId() {
    if (!isOpen) return;

    // Skip API call if ventureId is already loaded
    if (ventureId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    async function load() {
      try {
        const response = await fetch('/api/venture', {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch venture ID: ${response.status}`);
        }

        const data = await response.json();

        if (data.success && data.ventureId) {
          setVentureId(data.ventureId);
        } else {
          throw new Error(data.error || 'Failed to get venture ID');
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        console.error('Error fetching venture ID:', err);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [isOpen, ventureId]);

  useEffect(function setReady() {
    if (isOpen) {
      setIsReady(true);
    }
  }, [isOpen]);

  if (!isOpen || !isReady) {
    return null;
  }

  if (isLoading) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-ai-light rounded-full animate-bounce"></div>
          <div className="w-3 h-3 bg-ai rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
          <div className="w-3 h-3 bg-ai-dark rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
        </div>
      </div>
    );
  }

  if (error || !ventureId) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px' }}>
          <p>Error: {error || 'Failed to load venture ID'}</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <ImageManagerLoader
      appName="airobuilde"
      businessCategory="tech"
      ventureId={ventureId}
      onItemsSelectedCallback={(items: any[]) => {
        console.log('ITEMS SELECTED', items);
        onItemsSelected(items);
        onClose();
      }}
      onModalCloseCallback={onClose}
      rootDomain={getHostname()}
      selectionLimit={1}
      autoSelectAfterUpload={true}
      removeSources={['STOCK_MEDIA','SOCIAL_MEDIA']}
      mediaTypes={['IMAGE','VIDEO','PDF']}
      market="en-US"
    />
  );
}
