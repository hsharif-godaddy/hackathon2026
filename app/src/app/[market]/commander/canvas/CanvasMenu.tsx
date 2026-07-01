'use client'

import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import Button from '@ux/button'
import PlusIcon from '@ux/icon/plus'
import SearchIcon from '@ux/icon/search'

import { HeaderTooltip } from '@/components/ui/HeaderTooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { useTranslations } from '@/hooks/useTranslations'
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover'
import { useCommanderStore } from '@/stores/useCommanderStore'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logClickEvent } from '@/utils/instrumentation'
import { CANVAS_MENU_ORDER, CANVAS_REGISTRY, type CanvasDescriptor, CanvasId } from './registry'
import { useCanvasFlagFilter } from './useCanvasFlagFilter'

interface CanvasMenuProps {
  clickContext?: { appId: string }
}

const MENU_ORDER: readonly CanvasId[] = [
  CanvasId.Code,
  CanvasId.Media,
  CanvasId.Brand,
  CanvasId.Domain,
  CanvasId.Inbox,
  CanvasId.SettingsProject,
  CanvasId.SettingsBackups,
  CanvasId.SettingsSecurity,
  CanvasId.SettingsDatabase,
  CanvasId.SettingsSecrets,
  CanvasId.SettingsSocial,
  CanvasId.SettingsVisualScan,
  CanvasId.SettingsAnalytics,
  CanvasId.SettingsMarketing,
  CanvasId.SettingsCampaigns,
  CanvasId.SettingsGitHub,
  CanvasId.SettingsSso,
]

const isMacPlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform || navigator.platform || ''
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

function MenuItem({
  descriptor,
  label,
  onSelect,
  testId,
}: {
  descriptor: CanvasDescriptor
  label: string
  onSelect: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testId}
      className={clsx(
        'w-full flex items-center gap-1 px-1 py-1 rounded-md text-sm',
        'hover:bg-intents-ux-actionHovered-backgroundColor',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-intents-ux-action-borderColor',
        'cursor-pointer text-left',
      )}
    >
      <span className="inline-flex shrink-0 items-center justify-center size-2.5">
        <descriptor.Icon className="size-2.5" />
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}

export function CanvasMenu({ clickContext }: CanvasMenuProps) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showTooltip, setShowTooltip] = useState<boolean>(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const isMobile = useIsMobile()
  const openCanvasIds = useCommanderStore((state) => state.openCanvasIds)
  const openCanvas = useCommanderStore((state) => state.openCanvas)
  const isFlagAllowed = useCanvasFlagFilter()
  const isSsoVisible = useDevelopPageStore(
    (state) => !!state.site?.ssoRequired || !!state.site?.ssoOverrideAllowed,
  )

  const items = useMemo(() => {
    const all = CANVAS_MENU_ORDER.map((id) => CANVAS_REGISTRY[id]).filter(Boolean)
    const visible = all.filter((d) => {
      if (openCanvasIds.includes(d.id)) return false
      if (d.id === CanvasId.SettingsSso && !isSsoVisible) return false
      return isFlagAllowed(d.id)
    })
    return visible.map((d) => ({
      descriptor: d,
      label: d.labelKey ? t(d.labelKey) || d.fallbackLabel : d.fallbackLabel,
    }))
  }, [t, openCanvasIds, isFlagAllowed, isSsoVisible])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(({ label }) => label.toLowerCase().includes(q))
  }, [items, query])

  useEffect(() => {
    if (!open) return
    setShowTooltip(false)
    setQuery('')
    const id = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isShortcut =
        (isMacPlatform() && e.metaKey && e.key.toLowerCase() === 'o') ||
        (!isMacPlatform() && e.ctrlKey && e.key.toLowerCase() === 'o')
      if (isShortcut) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!isMobile && items.length === 0) return null

  const handleSelect = (canvasId: CanvasId) => {
    logClickEvent(`commander.canvas_menu.select.${canvasId}`, clickContext)()
    openCanvas(canvasId)
    setOpen(false)
  }

  const shortcutHint = isMacPlatform() ? '⌘O' : 'Ctrl+O'

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={buttonRef}
            data-testid="commander-canvas-tabs-menu-trigger"
            design="tertiary"
            size="sm"
            icon={<PlusIcon />}
            aria-label={t('builder_commander_canvas_menu_label')}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => logClickEvent('commander.canvas_menu.open', clickContext)()}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[260px] p-1"
          collisionPadding={8}
        >
          <div className="flex flex-col gap-1">
            <div
              className={clsx(
                'flex items-center gap-1 px-1 py-1 rounded-md',
                'bg-intents-ux-boxLowContrast-backgroundColor',
              )}
            >
              <SearchIcon className="size-2.5 opacity-60" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('builder_commander_canvas_menu_search_placeholder')}
                data-testid="commander-canvas-tabs-menu-search"
                className="flex-1 bg-transparent outline-none text-sm placeholder:opacity-60"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered.length > 0) {
                    e.preventDefault()
                    handleSelect(filtered[0].descriptor.id as CanvasId)
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setOpen(false)
                  }
                }}
              />
              <span className="text-xs opacity-60 px-0.5 py-0.5 rounded bg-intents-ux-box-backgroundColor">
                {shortcutHint}
              </span>
            </div>

            <div className="max-h-[320px] overflow-y-auto flex flex-col gap-0.5">
              {filtered.length === 0 ? (
                <div className="px-1 py-1 text-sm opacity-60">
                  {t('builder_code_search_no_results')}
                </div>
              ) : (
                filtered.map(({ descriptor, label }) => (
                  <MenuItem
                    key={descriptor.id}
                    descriptor={descriptor}
                    label={label}
                    testId={`commander-canvas-tabs-menu-${descriptor.id}`}
                    onSelect={() => handleSelect(descriptor.id as CanvasId)}
                  />
                ))
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {!open && showTooltip && (
        <HeaderTooltip anchorRef={buttonRef} label={t('builder_commander_canvas_menu_label')} />
      )}
    </>
  )
}
