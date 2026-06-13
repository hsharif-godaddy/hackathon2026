'use client'

import { useEffect, useState } from 'react'
import Box from '@ux/box'
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

export default function RebuildDesignModal({ open, onClose, onSelect }: RebuildDesignModalProps) {
  const t = useTranslations()
  const [url, setUrl] = useState('')

  function tr(key: string) {
    return t(key, undefined, defaultMessageForRebuildIntakeKey(key))
  }

  useEffect(() => {
    if (open) {
      trackRebuildDesignModalShown()
      setUrl('')
    }
  }, [open])

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
        {OPTIONS.map((option, index) => (
          // Wrapper owns the entrance (opacity + lift) so it never competes with
          // the button's hover transform.
          <div
            key={option.direction}
            className="animate-rebuild-reveal"
            style={{ animationDelay: `${120 + index * 70}ms` }}
          >
            <button
              type="button"
              data-testid={`rebuild-design-option-${option.direction}`}
              onClick={() => {
                trackRebuildDesignModalChoice(option.direction)
                onSelect(option.direction, url.trim())
              }}
              className="group flex w-full items-center gap-2 text-start p-2 rounded-lg border border-border cursor-pointer transition-all duration-200 ease-out hover:border-primary hover:shadow-md hover:-translate-y-px active:translate-y-0 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              <span className="flex-1 min-w-0">
                <text.span size={0} className="font-semibold block">
                  {tr(option.labelKey)}
                </text.span>
                <text.span size={-1} emphasis="passive" className="block">
                  {tr(option.descKey)}
                </text.span>
              </span>
              <ArrowRightIcon className="w-2 h-2 shrink-0 opacity-0 -translate-x-1 transition-all duration-200 text-muted-foreground group-hover:opacity-100 group-hover:translate-x-0 rtl:scale-x-[-1]" />
            </button>
          </div>
        ))}
      </Box>
    </Modal>
  )
}
