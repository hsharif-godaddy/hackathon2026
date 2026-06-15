'use client'

import { useEffect, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import ArrowRightIcon from '@ux/icon/arrow-right'
import Modal from '@ux/modal'
import text from '@ux/text'

import {
  trackRebuildDesignModalChoice,
  trackRebuildDesignModalShown,
} from '@/app/[market]/develop/components/rebuild/rebuildIntakeInstrumentation'
import { useTranslations } from '@/hooks/useTranslations'
import type { RebuildModalDirection } from '@/lib/rebuild-design-choice'
import { defaultMessageForRebuildIntakeKey } from '@/lib/translations/rebuild-intake-defaults'

interface RebuildDesignModalProps {
  open: boolean
  onClose: () => void
  onSelect: (direction: RebuildModalDirection, url: string) => void
  /** Pre-fill the source URL (Switchers deep link). */
  initialUrl?: string
  /** Pre-select a direction (Switchers deep link); user can still change it. */
  initialDirection?: RebuildModalDirection | null
}

// Reimagine first — the more aspirational framing, and the option Sales steers toward.
const OPTIONS: { direction: RebuildModalDirection; labelKey: string; descKey: string }[] = [
  {
    direction: 'modernize',
    labelKey: 'builder_rebuild_design_option_modernize_label',
    descKey: 'builder_rebuild_design_option_modernize_description',
  },
  {
    direction: 'keep-similar',
    labelKey: 'builder_rebuild_design_option_keep_similar_label',
    descKey: 'builder_rebuild_design_option_keep_similar_description',
  },
]

export default function RebuildDesignModal({
  open,
  onClose,
  onSelect,
  initialUrl = '',
  initialDirection = null,
}: RebuildDesignModalProps) {
  const t = useTranslations()
  const [url, setUrl] = useState('')
  // Select-then-confirm: a card click selects (highlights); Continue commits.
  const [selected, setSelected] = useState<RebuildModalDirection | null>(null)

  function tr(key: string) {
    return t(key, undefined, defaultMessageForRebuildIntakeKey(key))
  }

  useEffect(() => {
    if (open) {
      trackRebuildDesignModalShown()
      setUrl(initialUrl)
      setSelected(initialDirection)
    }
  }, [open, initialUrl, initialDirection])

  if (!open) return null

  return (
    <Modal
      title={tr('builder_rebuild_design_modal_title')}
      onClose={onClose}
      centered
      id="rebuild-design-modal"
    >
      <Box orientation="vertical" gap="md">
        <div className="animate-rebuild-reveal" style={{ animationDelay: '40ms' }}>
          <input
            type="url"
            data-testid="rebuild-design-url-input"
            placeholder="https://yoursite.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-border bg-transparent transition-colors duration-200 focus:outline-none focus:border-primary text-sm"
            autoFocus
          />
        </div>
        {OPTIONS.map((option, index) => {
          const isSelected = selected === option.direction
          return (
            // Wrapper owns the entrance (opacity + lift) so it never competes with
            // the button's hover transform.
            <div
              key={option.direction}
              className="animate-rebuild-reveal"
              style={{ animationDelay: `${120 + index * 70}ms` }}
            >
              <button
                type="button"
                aria-pressed={isSelected}
                data-testid={`rebuild-design-option-${option.direction}`}
                onClick={() => setSelected(option.direction)}
                className={`group flex w-full items-center gap-2 text-start p-2 rounded-lg border cursor-pointer transition-all duration-200 ease-out hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                  isSelected ? 'border-primary shadow-sm' : 'border-border hover:border-primary'
                }`}
              >
                <span className="flex-1 min-w-0">
                  <text.span size={0} className="font-semibold block">
                    {tr(option.labelKey)}
                  </text.span>
                  <text.span size={-1} emphasis="passive" className="block">
                    {tr(option.descKey)}
                  </text.span>
                </span>
                <ArrowRightIcon
                  className={`w-2 h-2 shrink-0 transition-all duration-200 text-muted-foreground rtl:scale-x-[-1] ${
                    isSelected
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0'
                  }`}
                />
              </button>
            </div>
          )
        })}
        <Button
          data-testid="rebuild-design-continue"
          design="primary"
          disabled={!selected}
          text={t('builder_common_continue', undefined, 'Continue')}
          onClick={() => {
            if (!selected) return
            trackRebuildDesignModalChoice(selected)
            onSelect(selected, url.trim())
          }}
        />
      </Box>
    </Modal>
  )
}
