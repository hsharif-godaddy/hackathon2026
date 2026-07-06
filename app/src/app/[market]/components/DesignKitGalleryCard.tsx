'use client'

import clsx from 'clsx'
import { Check } from 'lucide-react'
import { type ReactElement, useState } from 'react'

import { useTranslations } from '@/hooks/useTranslations'
import { formatAttributes } from '@/lib/design-kit-metadata'
import type { DesignKit } from '@/lib/design-kits'

interface DesignKitGalleryCardProps {
  kit: DesignKit
  isPicked: boolean
  isAttached: boolean
  onSelect: () => void
  eager?: boolean
}

function KitThumb({ url, alt, eager }: { url: string; alt: string; eager: boolean }): ReactElement {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="h-[189px] w-full shrink-0 overflow-hidden bg-intents-ux-boxLowContrast-boxBackgroundColor">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN thumbnail, not optimizable */}
      <img
        src={url}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : 'auto'}
        onLoad={() => setLoaded(true)}
        className="size-full object-cover object-top transition-opacity duration-300"
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </div>
  )
}

export default function DesignKitGalleryCard({
  kit,
  isPicked,
  isAttached,
  onSelect,
  eager = false,
}: DesignKitGalleryCardProps) {
  const t = useTranslations()
  const attributeLine = formatAttributes(kit.attributes)

  const isSelected = isPicked || isAttached

  return (
    <button
      type="button"
      data-testid={`design-kit-tile-${kit.slug}`}
      aria-pressed={isPicked}
      onClick={onSelect}
      className={clsx(
        'group relative box-border flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left transition-[border-color,box-shadow] duration-200 ease-out hover:z-[1] hover:shadow-lg',
        isSelected
          ? 'border-ai shadow-sm ring-2 ring-inset ring-ai/20'
          : 'border-intents-ux-box-borderColor hover:border-ai/50',
      )}
    >
      {isAttached && (
        <span className="absolute right-2 top-2 z-[1] rounded-full bg-intents-ux-actionPrimary-actionPrimaryBackgroundColor px-2 py-0.5 text-[11px] font-medium text-intents-ux-actionPrimary-actionPrimaryForegroundColor">
          {t('builder_design_kit_gallery_attached_badge', undefined, 'Attached')}
        </span>
      )}
      {isPicked && !isAttached && (
        <span
          className="absolute right-2 top-2 z-[1] flex size-5 items-center justify-center rounded-full bg-ai"
          aria-hidden
        >
          <Check className="size-3 text-white" strokeWidth={3} />
        </span>
      )}
      <KitThumb url={kit.thumbnailUrl} alt={kit.displayName} eager={eager} />
      <div className="bg-intents-ux-box-boxBackgroundColor p-2.5">
        <p className="mb-0.5 text-sm font-medium text-intents-ux-text-textColor">{kit.displayName}</p>
        {attributeLine && (
          <p className="text-xs leading-snug text-intents-ux-text-secondary">{attributeLine}</p>
        )}
      </div>
    </button>
  )
}
