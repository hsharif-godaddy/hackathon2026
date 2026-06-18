'use client'

import { ChevronLeft, ChevronRight, Palette, X } from 'lucide-react'
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Spinner from '@ux/spinner'
import { text } from '@ux/text'

import { useDesignKitCatalog } from '@/hooks/home/useDesignKitCatalog'
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

// Dark prototype palette (off the UXCore token system by design — see the Figma mock).
const C = {
  overlay: 'rgba(8,5,18,.78)',
  card: '#18102E',
  tile: '#221A3D',
  thumbBg: '#2A2440',
  text: '#F4F2FA',
  textSoft: '#AFA9EC',
  accent: '#AFA9EC',
  attached: '#7F77DD',
  borderMed: 'rgba(175,169,236,.30)',
  borderStrong: 'rgba(175,169,236,.45)',
  primaryText: '#1A1530',
}

const ARROW_SIZE = 35;

function vibeFromTags(tags: string[]): string {
  return tags
    .slice(0, 3)
    .map((tag) => tag.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' · ')
}

function KitThumb({ url, alt, eager }: { url: string; alt: string; eager: boolean }): ReactElement {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="w-full shrink-0 overflow-hidden" style={{ height: 240, background: C.thumbBg }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN thumbnail, not optimizable */}
      <img
        src={url}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={eager ? 'high' : 'auto'}
        onLoad={() => setLoaded(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', opacity: loaded ? 1 : 0, transition: 'opacity .3s ease' }}
      />
    </div>
  )
}

export default function DesignKitGallery({ attachedSlug, onAttach, disabled }: DesignKitGalleryProps) {
  const isEnabled = useSwitchboard('appbuilder-design-kit-gallery')
  const t = useTranslations()
  const [isOpen, setIsOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const [pickedSlug, setPickedSlug] = useState<string | null>(null)
  const { kits, error, reload, loaded } = useDesignKitCatalog(hasOpened)

  const trackRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // Modal behaviour: scroll lock, focus capture/restore, Escape + Tab trap.
  useEffect(() => {
    if (!isOpen) return
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    // Focus the dialog container (not a button) so opening doesn't paint a focus ring.
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setIsOpen(false); return }
      if (e.key === 'Tab' && dialogRef.current) {
        const f = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])',
        )
        if (f.length === 0) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      restoreFocusRef.current?.focus()
    }
  }, [isOpen])

  if (!isEnabled) return null

  const open = (): void => {
    if (error) reload()
    setPickedSlug(attachedSlug)
    setIsOpen(true)
    setHasOpened(true)
  }
  const close = (): void => setIsOpen(false)

  const pickedKit = kits.find((k) => k.slug === pickedSlug) ?? null
  const attachedKit = kits.find((k) => k.slug === attachedSlug) ?? null

  const confirm = (): void => {
    if (pickedKit) {
      onAttach(pickedKit)
      logger.info('homepage.designKit.attached', { slug: pickedKit.slug })
      logImpressionEvent('homepage.prompt.designKitAttached', { slug: pickedKit.slug })()
    }
    close()
  }
  const detach = (): void => {
    logger.info('homepage.designKit.detached', {})
    onAttach(null)
    close()
  }
  const scrollByCards = (dir: 1 | -1): void => { trackRef.current?.scrollBy({ left: dir * 388, behavior: 'smooth' }) }

  // Footer state machine (mirrors the mock: pick → attach/switch/done + detach).
  const footer = ((): { info: string; label: string; primaryDisabled: boolean; showDetach: boolean } => {
    if (pickedKit && attachedKit && pickedKit.slug === attachedKit.slug) {
      return { info: t('builder_design_kit_gallery_footer_attached', { name: attachedKit.displayName }, `Currently attached: ${attachedKit.displayName}`), label: t('builder_common_done', undefined, 'Done'), primaryDisabled: false, showDetach: true }
    }
    if (pickedKit && attachedKit) {
      return { info: t('builder_design_kit_gallery_footer_switch', { name: pickedKit.displayName }, `Switch to: ${pickedKit.displayName}`), label: t('builder_design_kit_gallery_switch', undefined, 'Switch kit'), primaryDisabled: false, showDetach: true }
    }
    if (pickedKit) {
      return { info: t('builder_design_kit_gallery_footer_selected', { name: pickedKit.displayName }, `Selected: ${pickedKit.displayName}`), label: t('builder_design_kit_gallery_attach', undefined, 'Attach kit'), primaryDisabled: false, showDetach: false }
    }
    if (attachedKit) {
      return { info: t('builder_design_kit_gallery_footer_attached', { name: attachedKit.displayName }, `Currently attached: ${attachedKit.displayName}`), label: t('builder_common_done', undefined, 'Done'), primaryDisabled: false, showDetach: true }
    }
    return { info: t('builder_design_kit_gallery_footer_empty', undefined, 'Pick a Design Kit to attach'), label: t('builder_design_kit_gallery_attach', undefined, 'Attach kit'), primaryDisabled: true, showDetach: false }
  })()

  const renderCards = (): ReactNode => {
    if (error) {
      return (
        <p role="alert" className="px-5 py-10 text-sm" style={{ color: C.textSoft }}>
          {t('builder_design_kit_gallery_error', undefined, "Couldn't load design kits. Please try again.")}
        </p>
      )
    }
    // Spinner until a fetch actually resolves — avoids a one-frame flash of the
    // empty-state copy before the effect flips isLoading on first open.
    if (!loaded) {
      return <div className="flex h-72 items-center justify-center"><Spinner /></div>
    }
    if (kits.length === 0) {
      return (
        <p className="px-5 py-10 text-sm" style={{ color: C.textSoft }}>
          {t('builder_design_kit_gallery_empty', undefined, 'No design kits available.')}
        </p>
      )
    }
    return (
      <div className="relative">
        <button
          type="button"
          data-testid="design-kit-nav-prev"
          onClick={() => scrollByCards(-1)}
          aria-label={t('builder_common_previous', undefined, 'Previous')}
          className="absolute left-2.5 z-10 flex -translate-y-1/2 items-center justify-center rounded-full"
          style={{ top: 126, width: ARROW_SIZE, height: ARROW_SIZE, padding: 0, background: 'rgba(8,5,18,.92)', border: `1px solid ${C.borderStrong}`, color: C.text }}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          data-testid="design-kit-nav-next"
          onClick={() => scrollByCards(1)}
          aria-label={t('builder_common_next', undefined, 'Next')}
          className="absolute right-2.5 z-10 flex -translate-y-1/2 items-center justify-center rounded-full"
          style={{ top: 126, width: ARROW_SIZE, height: ARROW_SIZE, padding: 0, background: 'rgba(8,5,18,.92)', border: `1px solid ${C.borderStrong}`, color: C.text }}
        >
          <ChevronRight size={16} />
        </button>
        <div
          ref={trackRef}
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-4 pt-1"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(175,169,236,.45) transparent' }}
        >
          {kits.map((kit, i) => {
            const isPicked = pickedSlug === kit.slug
            const isAttached = attachedSlug === kit.slug
            return (
              <button
                key={kit.slug}
                type="button"
                data-testid={`design-kit-tile-${kit.slug}`}
                aria-pressed={isPicked}
                onClick={() => setPickedSlug(kit.slug)}
                className="relative flex w-[180px] shrink-0 snap-center cursor-pointer flex-col overflow-hidden rounded-[14px] text-left transition-transform hover:-translate-y-0.5"
                style={{ background: C.tile, border: `2px solid ${isAttached ? C.attached : isPicked ? C.accent : 'transparent'}` }}
              >
                {isAttached && (
                  <span className="absolute right-2.5 top-2.5 z-[1] rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: C.accent, color: C.primaryText }}>
                    {t('builder_design_kit_gallery_attached_badge', undefined, 'Attached')}
                  </span>
                )}
                <KitThumb url={kit.thumbnailUrl} alt={kit.displayName} eager={i < 4} />
                <div style={{ padding: '10px 10px' }}>
                  <p className="mb-0.5 text-[13px] font-medium" style={{ color: C.text }}>{kit.displayName}</p>
                  <p className="text-[11px] leading-snug" style={{ color: C.textSoft, opacity: 0.78 }}>{vibeFromTags(kit.tags)}</p>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const modal = isOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: C.overlay, backdropFilter: 'blur(10px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-kit-gallery-title"
        tabIndex={-1}
        className="relative w-full max-w-[900px] rounded-[20px] pb-4 pt-5 outline-none"
        style={{ background: C.card, border: `1px solid ${C.borderMed}`, boxShadow: '0 30px 80px rgba(0,0,0,.5)' }}
      >
        <div className="mb-5 flex items-start justify-between gap-3 px-5">
          <div>
            <p id="design-kit-gallery-title" className="m-0 flex items-center gap-2.5 text-lg font-medium" style={{ color: C.text }}>
              <Palette size={18} style={{ color: C.accent }} />
              {t('builder_design_kit_gallery_title', undefined, 'Choose a Design Kit')}
            </p>
            <p className="m-0 mt-1.5 max-w-[560px] text-[13px] leading-relaxed" style={{ color: C.textSoft, opacity: 0.8 }}>
              {t('builder_design_kit_gallery_subtitle', undefined, 'A Design Kit sets the starting vibe — colors, type, and feel — for the site Airo builds you. Pick one to anchor the look. You can swap it, tweak it, or change anything later in the editor.')}
            </p>
          </div>
          <button
            type="button"
            data-testid="design-kit-gallery-close"
            onClick={close}
            aria-label={t('builder_common_close', undefined, 'Close')}
            className="absolute flex shrink-0 items-center justify-center rounded-full"
            style={{ top: 16, right: 16, width: 28, height: 28, padding: 0, border: `1px solid ${C.borderMed}`, color: C.textSoft }}
          >
            <X size={15} />
          </button>
        </div>

        {renderCards()}

        <div className="mt-1 flex items-center justify-between gap-3 px-5 pt-4" style={{ borderTop: `1px solid ${C.borderMed}` }}>
          <span className="text-[13px]" style={{ color: C.textSoft, opacity: 0.85 }}>{footer.info}</span>
          <div className="flex items-center gap-2">
            {footer.showDetach && (
              <button
                type="button"
                data-testid="design-kit-detach"
                onClick={detach}
                className="rounded-[10px] text-[14px] font-medium"
                style={{ padding: '7px 14px', border: `1px solid ${C.borderStrong}`, color: C.textSoft, background: 'transparent' }}
              >
                {t('builder_design_kit_gallery_detach', undefined, 'Detach kit')}
              </button>
            )}
            <button
              type="button"
              data-testid="design-kit-attach"
              onClick={confirm}
              disabled={footer.primaryDisabled}
              className="rounded-[10px] text-[14px] font-semibold disabled:cursor-not-allowed"
              style={{
                padding: '8px 16px',
                ...(footer.primaryDisabled
                  ? { background: 'rgba(175,169,236,.2)', color: 'rgba(220,216,255,.4)' }
                  : { background: C.accent, color: C.primaryText }),
              }}
            >
              {footer.label}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  const triggerLabel = t('builder_design_kit_gallery_title', undefined, 'Choose a Design Kit')

  return (
    <>
      {/* Icon-only by default; the label slides out on hover (matches the mock). */}
      <button
        type="button"
        onClick={open}
        data-testid="design-kit-gallery-button"
        data-eid={generateClickEID('homepage.prompt.designKit')}
        aria-label={triggerLabel}
        disabled={disabled}
        className="group flex items-center overflow-hidden rounded-full border border-transparent text-[#534AB7] transition-all duration-200 hover:border-[#CECBF6] hover:bg-[#F5F3FF] hover:pr-3 disabled:opacity-50"
      >
        <span className="flex shrink-0 items-center justify-center" style={{ width: 36, height: 36 }}>
          <Palette size={18} />
        </span>
        <span className="max-w-[0px] overflow-hidden whitespace-nowrap text-[13px] font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[180px] group-hover:opacity-100">
          {triggerLabel}
        </span>
      </button>
      {modal}
    </>
  )
}

export function DesignKitChip({ kit, onRemove, disabled }: { kit: DesignKit; onRemove: () => void; disabled?: boolean }) {
  const t = useTranslations()
  return (
    <div
      className="relative flex items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2 max-w-[240px]"
      style={{ borderColor: '#CECBF6', background: '#F5F3FF', color: '#3C3489' }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN thumbnail, not optimizable */}
      <img src={kit.thumbnailUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: 24, height: 24 }} loading="lazy" />
      <Palette size={14} className="shrink-0" style={{ color: '#534AB7' }} />
      <text.p size={-1} className="truncate font-semibold leading-tight" style={{ color: '#3C3489' }}>{kit.displayName}</text.p>
      <button
        type="button"
        data-testid="design-kit-chip-remove"
        onClick={onRemove}
        disabled={disabled}
        className="ml-1 flex shrink-0 items-center justify-center rounded-full hover:bg-[#CECBF6] disabled:opacity-50"
        style={{ width: 18, height: 18, color: '#534AB7' }}
        aria-label={t('builder_design_kit_chip_remove_aria', undefined, 'Remove design kit')}
      >
        <X size={12} />
      </button>
    </div>
  )
}
