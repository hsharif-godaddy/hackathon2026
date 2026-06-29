'use client'

import { Play } from 'lucide-react'

import { getSlotVideoPosterUrl } from '@/app/[market]/develop/components/media/slotImageUrl'

interface ChatVideoThumbnailProps {
  thumbnailUrl?: string
  searchQuery: string
  className?: string
}

/**
 * Chat-only video preview — uses a still-image thumb when available.
 * The site preview plays video same-origin; chat runs on the app origin so
 * cross-origin <video> tags are unreliable. Click opens the Media panel.
 */
export default function ChatVideoThumbnail({
  thumbnailUrl,
  searchQuery,
  className = 'w-full h-full object-cover rounded-md transition-all duration-300 group-hover:opacity-20',
}: ChatVideoThumbnailProps) {
  const posterSrc = getSlotVideoPosterUrl(thumbnailUrl)

  if (posterSrc) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={posterSrc} alt={searchQuery} className={className} />
    )
  }

  return (
    <div
      className={`${className} flex items-center justify-center bg-intents-ux-boxLowContrast-backgroundColor`}
      aria-label={searchQuery}
    >
      <Play className="w-4 h-4 text-foreground/40" fill="currentColor" aria-hidden />
    </div>
  )
}
