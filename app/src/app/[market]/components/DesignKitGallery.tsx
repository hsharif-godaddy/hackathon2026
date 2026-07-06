'use client'

import clsx from 'clsx'
import { Palette, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import DesignKitGalleryModal from '@/app/[market]/components/DesignKitGalleryModal'
import { useDesignKitCatalog } from '@/hooks/home/useDesignKitCatalog'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import type { DesignKit } from '@/lib/design-kits'
import { logger } from '@/lib/request-context'
import { generateClickEID, logImpressionEvent } from '@/utils/instrumentation'

interface DesignKitGalleryProps {
  attachedSlug: string | null
  onAttach: (kit: DesignKit | null) => void
  disabled?: boolean
}

const TRIGGER_HOVER_CLASS =
  'border-light-purple-solid bg-light-purple pr-3 text-ai'

export default function DesignKitGallery({ attachedSlug, onAttach, disabled }: DesignKitGalleryProps) {
  const isEnabled = useSwitchboard('appbuilder-design-kit-gallery')
  const { isBelowSmBreakpoint } = useBreakpoints()
  const t = useTranslations()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const [pickedSlug, setPickedSlug] = useState<string | null>(null)
  const [isMobilePeek, setIsMobilePeek] = useState(false)
  const { kits, error, reload, loaded } = useDesignKitCatalog(hasOpened)

  useEffect(function dismissMobilePeekOnOutsideInteraction() {
    if (!isMobilePeek) return

    function dismiss(event: PointerEvent): void {
      if (triggerRef.current?.contains(event.target as Node)) return
      setIsMobilePeek(false)
    }

    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [isMobilePeek])

  if (!isEnabled) return null

  function open(): void {
    if (error) reload()
    setPickedSlug(attachedSlug)
    setIsOpen(true)
    setHasOpened(true)
    setIsMobilePeek(false)
  }

  function close(): void {
    setIsOpen(false)
    setIsMobilePeek(false)
  }

  function confirm(): void {
    const pickedKit = kits.find((kit) => kit.slug === pickedSlug) ?? null
    if (pickedKit) {
      onAttach(pickedKit)
      logger.info('homepage.designKit.attached', { slug: pickedKit.slug })
      logImpressionEvent('homepage.prompt.designKitAttached', { slug: pickedKit.slug })()
    }
    close()
  }

  function detach(): void {
    logger.info('homepage.designKit.detached', {})
    onAttach(null)
    close()
  }

  function clickTrigger(): void {
    if (isBelowSmBreakpoint) {
      if (!isMobilePeek) {
        setIsMobilePeek(true)
        return
      }
      open()
      return
    }
    open()
  }

  const triggerLabel = t('builder_design_kit_gallery_trigger', undefined, 'Add a Design Style')
  const mobileTriggerLabel = t('builder_design_kit_gallery_trigger_mobile', undefined, 'Add a Style')
  const visibleTriggerLabel = isBelowSmBreakpoint ? mobileTriggerLabel : triggerLabel
  const showTriggerExpanded = isMobilePeek

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={clickTrigger}
        data-testid="design-kit-gallery-button"
        data-mobile-peek={showTriggerExpanded ? 'true' : 'false'}
        data-eid={generateClickEID('homepage.prompt.designKit')}
        aria-label={visibleTriggerLabel}
        disabled={disabled}
        className={clsx(
          'group flex h-[36px] items-center overflow-hidden rounded-full border transition-all duration-200 disabled:opacity-50',
          showTriggerExpanded
            ? TRIGGER_HOVER_CLASS
            : 'border-transparent text-intents-ux-action-foregroundColor hover:border-light-purple-solid hover:bg-light-purple hover:pr-3 hover:text-ai',
        )}
      >
        <span className="flex size-[36px] shrink-0 items-center justify-center">
          <Palette size={18} />
        </span>
        <span
          className={clsx(
            'overflow-hidden whitespace-nowrap text-[13px] font-semibold transition-all duration-200',
            showTriggerExpanded
              ? 'max-w-[220px] opacity-100'
              : 'max-w-[0px] opacity-0 group-hover:max-w-[220px] group-hover:opacity-100',
          )}
        >
          {visibleTriggerLabel}
        </span>
      </button>
      {hasOpened && (
        <DesignKitGalleryModal
          open={isOpen}
          onClose={close}
          kits={kits}
          loaded={loaded}
          error={error}
          attachedSlug={attachedSlug}
          pickedSlug={pickedSlug}
          onPickedSlugChange={setPickedSlug}
          onConfirm={confirm}
          onDetach={detach}
        />
      )}
    </>
  )
}

interface DesignKitChipProps {
  kit: DesignKit
  onRemove: () => void
  disabled?: boolean
}

export function DesignKitChip({ kit, onRemove, disabled }: DesignKitChipProps) {
  const { isBelowSmBreakpoint } = useBreakpoints()
  const t = useTranslations()
  const label = isBelowSmBreakpoint
    ? kit.displayName
    : t('builder_design_kit_chip_label', { name: kit.displayName }, `Design Style: ${kit.displayName}`)

  return (
    <div className="relative flex h-[36px] max-w-[320px] items-center rounded-full border border-light-purple-solid bg-light-purple py-0 pr-1 text-ai-dark">
      <span className="flex size-[36px] shrink-0 items-center justify-center">
        <Palette size={18} className="text-ai" />
      </span>
      <span className="min-w-0 truncate text-[13px] font-semibold">{label}</span>
      <button
        type="button"
        data-testid="design-kit-chip-remove"
        onClick={onRemove}
        disabled={disabled}
        className="ml-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full text-ai hover:bg-light-purple-solid disabled:opacity-50"
        aria-label={t('builder_design_kit_chip_remove_aria', undefined, 'Remove design kit')}
      >
        <X size={14} />
      </button>
    </div>
  )
}
