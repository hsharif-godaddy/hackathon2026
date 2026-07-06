'use client'

import clsx from 'clsx'
import { type ReactNode, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import Chip from '@ux/chip'
import Modal from '@ux/modal'
import Spinner from '@ux/spinner'
import text from '@ux/text'

import DesignKitGalleryCard from '@/app/[market]/components/DesignKitGalleryCard'
import { useTranslations } from '@/hooks/useTranslations'
import {
  type DesignKitAttribute,
  type DesignKitFilter,
  type DesignKitTone,
  filterDesignKits,
} from '@/lib/design-kit-metadata'
import type { DesignKit } from '@/lib/design-kits'
import { DESIGN_KIT_GALLERY_SUBTITLE_V2 } from '@/lib/translations/merge-dev-preview-overrides'

const TONE_DEFS: { id: DesignKitTone; labelKey: string; fallback: string }[] = [
  { id: 'light', labelKey: 'builder_design_kit_gallery_tab_light', fallback: 'Light' },
  { id: 'dark', labelKey: 'builder_design_kit_gallery_tab_dark', fallback: 'Dark' },
]

const ATTRIBUTE_DEFS: { id: DesignKitAttribute; labelKey: string; fallback: string }[] = [
  { id: 'bold', labelKey: 'builder_design_kit_gallery_chip_bold', fallback: 'Bold' },
  { id: 'elegant', labelKey: 'builder_design_kit_gallery_chip_elegant', fallback: 'Elegant' },
  { id: 'warm', labelKey: 'builder_design_kit_gallery_chip_warm', fallback: 'Warm' },
  { id: 'editorial', labelKey: 'builder_design_kit_gallery_chip_editorial', fallback: 'Editorial' },
  { id: 'clean', labelKey: 'builder_design_kit_gallery_chip_clean', fallback: 'Clean' },
  { id: 'professional', labelKey: 'builder_design_kit_gallery_chip_professional', fallback: 'Professional' },
]

const TRIGGER_LABEL = 'Add a Design Style'
const ADD_DESIGN_LABEL = 'Add Design Style'

const MODAL_CLASS =
  'flex max-h-[min(90dvh,calc(100vh-2rem))] w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-2xl !gap-4 !text-left [&_.ux-text-lockup]:!items-start [&_.ux-text-lockup]:!text-left [&_.ux-text-lockup--text]:!w-full [&_.ux-text-lockup--text]:!text-left [&_.ux-text-lockup--title]:!text-left [&_.ux-text-lockup--title]:!whitespace-normal [&_.ux-text-lockup--body]:!mx-0 [&_.ux-text-lockup--body]:!mt-0 [&_.ux-text-lockup--body]:!w-full [&_.ux-text-lockup--body]:!text-left [&_.ux-text-lockup--body]:!font-normal [&_.ux-corner-actions_.ux-button]:!border-0 [&_.ux-corner-actions_.ux-button]:!shadow-none'

const SCROLL_MASK_CLASS =
  '[-webkit-mask-image:linear-gradient(to_bottom,transparent_0,black_clamp(12px,3%,20px),black_calc(100%-clamp(12px,3%,20px)),transparent_100%)] [mask-image:linear-gradient(to_bottom,transparent_0,black_clamp(12px,3%,20px),black_calc(100%-clamp(12px,3%,20px)),transparent_100%)]'

interface DesignKitGalleryModalProps {
  open: boolean
  onClose: () => void
  kits: DesignKit[]
  loaded: boolean
  error: Error | null
  attachedSlug: string | null
  pickedSlug: string | null
  onPickedSlugChange: (slug: string | null) => void
  onConfirm: () => void
  onDetach: () => void
}

export default function DesignKitGalleryModal({
  open,
  onClose,
  kits,
  loaded,
  error,
  attachedSlug,
  pickedSlug,
  onPickedSlugChange,
  onConfirm,
  onDetach,
}: DesignKitGalleryModalProps) {
  const t = useTranslations()
  const [filter, setFilter] = useState<DesignKitFilter | null>(null)

  if (!open) return null

  const pickedKit = kits.find((kit) => kit.slug === pickedSlug) ?? null
  const attachedKit = kits.find((kit) => kit.slug === attachedSlug) ?? null
  const filteredKits = filterDesignKits(kits, filter)

  const footer = ((): { info: string | null; label: string; primaryDisabled: boolean; showDetach: boolean } => {
    if (pickedKit && attachedKit && pickedKit.slug === attachedKit.slug) {
      return {
        info: t('builder_design_kit_gallery_footer_attached', { name: attachedKit.displayName }, `Currently attached: ${attachedKit.displayName}`),
        label: t('builder_common_done', undefined, 'Done'),
        primaryDisabled: false,
        showDetach: true,
      }
    }
    if (pickedKit && attachedKit) {
      return {
        info: t('builder_design_kit_gallery_footer_switch', { name: pickedKit.displayName }, `Switch to: ${pickedKit.displayName}`),
        label: t('builder_design_kit_gallery_switch', undefined, 'Switch kit'),
        primaryDisabled: false,
        showDetach: true,
      }
    }
    if (pickedKit) {
      return {
        info: null,
        label: t('builder_design_kit_gallery_attach_v2', undefined, ADD_DESIGN_LABEL),
        primaryDisabled: false,
        showDetach: false,
      }
    }
    if (attachedKit) {
      return {
        info: t('builder_design_kit_gallery_footer_attached', { name: attachedKit.displayName }, `Currently attached: ${attachedKit.displayName}`),
        label: t('builder_common_done', undefined, 'Done'),
        primaryDisabled: false,
        showDetach: true,
      }
    }
    return {
      info: null,
      label: t('builder_design_kit_gallery_attach_v2', undefined, ADD_DESIGN_LABEL),
      primaryDisabled: true,
      showDetach: false,
    }
  })()

  function togglePick(slug: string): void {
    onPickedSlugChange(pickedSlug === slug ? null : slug)
  }

  function selectFilter(nextFilter: DesignKitFilter): void {
    setFilter((current) => (current === nextFilter ? null : nextFilter))
  }

  function renderGrid(): ReactNode {
    if (error) {
      return (
        <text.p role="alert" size={-1} emphasis="passive" className="py-10 text-left">
          {t('builder_design_kit_gallery_error', undefined, "Couldn't load design kits. Please try again.")}
        </text.p>
      )
    }
    if (!loaded) {
      return (
        <div className="flex h-72 items-center justify-center">
          <Spinner />
        </div>
      )
    }
    if (kits.length === 0) {
      return (
        <text.p size={-1} emphasis="passive" className="py-10 text-left">
          {t('builder_design_kit_gallery_empty', undefined, 'No design kits available.')}
        </text.p>
      )
    }
    return (
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {filteredKits.map((kit, index) => (
          <DesignKitGalleryCard
            key={kit.slug}
            kit={kit}
            isPicked={pickedSlug === kit.slug}
            isAttached={attachedSlug === kit.slug}
            onSelect={() => togglePick(kit.slug)}
            eager={index < 6}
          />
        ))}
      </div>
    )
  }

  return (
    <Modal
      title={t('builder_design_kit_gallery_trigger', undefined, TRIGGER_LABEL)}
      description={
        <text.p size={-1} className="m-0 w-full whitespace-normal text-left">
          {t(
            'builder_design_kit_gallery_subtitle_v2',
            undefined,
            DESIGN_KIT_GALLERY_SUBTITLE_V2,
          )}
        </text.p>
      }
      onClose={onClose}
      id="design-kit-gallery-modal"
      className={MODAL_CLASS}
      data-testid="design-kit-gallery-modal"
    >
      <Box orientation="vertical" gap="md" className="flex min-h-0 flex-1 flex-col overflow-hidden text-left">
        <Box orientation="horizontal" gap="sm" wrap className="shrink-0">
          {TONE_DEFS.map((toneDef) => (
            <Chip
              key={toneDef.id}
              label={t(toneDef.labelKey, undefined, toneDef.fallback)}
              selected={filter === toneDef.id}
              onSelect={() => selectFilter(toneDef.id)}
              data-testid={`design-kit-chip-${toneDef.id}`}
              size="sm"
            />
          ))}
          {ATTRIBUTE_DEFS.map((attributeDef) => (
            <Chip
              key={attributeDef.id}
              label={t(attributeDef.labelKey, undefined, attributeDef.fallback)}
              selected={filter === attributeDef.id}
              onSelect={() => selectFilter(attributeDef.id)}
              data-testid={`design-kit-chip-${attributeDef.id}`}
              size="sm"
            />
          ))}
        </Box>

        <div className={clsx('min-h-0 flex-1 overflow-y-auto overscroll-contain', SCROLL_MASK_CLASS)}>
          <div className="p-1">{renderGrid()}</div>
        </div>

        <div className={clsx('flex shrink-0 items-center gap-3 pt-2', footer.info ? 'justify-between' : 'justify-end')}>
          {footer.info && (
            <text.p size={-1} emphasis="passive">{footer.info}</text.p>
          )}
          <Box orientation="horizontal" gap="sm">
            {footer.showDetach && (
              <Button
                design="secondary"
                text={t('builder_design_kit_gallery_detach', undefined, 'Detach kit')}
                onClick={onDetach}
                data-testid="design-kit-detach"
              />
            )}
            <Button
              design="primary"
              text={footer.label}
              onClick={onConfirm}
              disabled={footer.primaryDisabled}
              data-testid="design-kit-attach"
            />
          </Box>
        </div>
      </Box>
    </Modal>
  )
}
