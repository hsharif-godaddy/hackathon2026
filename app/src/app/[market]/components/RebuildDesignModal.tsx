'use client'

import { useEffect, useState } from 'react'
import { presetForDirection, type RebuildBringOverChoice } from '@airo/shared'
import Box from '@ux/box'
import Button from '@ux/button'
import ArrowRightIcon from '@ux/icon/arrow-right'
import Modal from '@ux/modal'
import text from '@ux/text'
import ToggleButton from '@ux/toggle-button'

import {
  trackRebuildDesignModalChoice,
  trackRebuildDesignModalShown,
} from '@/app/[market]/develop/components/rebuild/rebuildIntakeInstrumentation'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import type { RebuildModalDirection } from '@/lib/rebuild-design-choice'
import { defaultMessageForRebuildIntakeKey } from '@/lib/translations/rebuild-intake-defaults'

interface RebuildDesignModalProps {
  open: boolean
  onClose: () => void
  onSelect: (choice: RebuildBringOverChoice, url: string) => void
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

// Soft check: optional scheme, at least one dot, 2+ char TLD. Accepts "mysite.com"
// and "https://sub.site.co.uk/path"; rejects garbage like "asdf". Not a strict
// validator — just enough to keep obvious junk from triggering a doomed scrape.
const URL_PATTERN: RegExp = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/.*)?$/i

const TOGGLE_FIELDS: { field: keyof Pick<RebuildBringOverChoice, 'keepLogo' | 'keepImages' | 'keepColors' | 'keepFonts'>; labelKey: string; testId: string }[] = [
  { field: 'keepLogo', labelKey: 'builder_rebuild_bring_over_logo', testId: 'rebuild-bring-over-logo' },
  { field: 'keepImages', labelKey: 'builder_rebuild_bring_over_images', testId: 'rebuild-bring-over-images' },
  { field: 'keepColors', labelKey: 'builder_rebuild_bring_over_colors', testId: 'rebuild-bring-over-colors' },
  { field: 'keepFonts', labelKey: 'builder_rebuild_bring_over_fonts', testId: 'rebuild-bring-over-fonts' },
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
  // Defer the invalid-URL message until the field is blurred, so we don't flag
  // a half-typed address mid-keystroke.
  const [urlTouched, setUrlTouched] = useState(false)
  // Select-then-confirm: a card click selects (highlights + seeds toggles); Continue commits.
  const [choice, setChoice] = useState<RebuildBringOverChoice | null>(null)
  const showAdvanced = useSwitchboard('appbuilder-rebuild-bring-over-toggles')

  function tr(key: string) {
    return t(key, undefined, defaultMessageForRebuildIntakeKey(key))
  }

  const trimmedUrl: string = url.trim()
  const isUrlValid: boolean = URL_PATTERN.test(trimmedUrl)
  const showUrlError: boolean = urlTouched && trimmedUrl.length > 0 && !isUrlValid

  useEffect(() => {
    if (open) {
      trackRebuildDesignModalShown()
      setUrl(initialUrl)
      setUrlTouched(false)
      setChoice(initialDirection ? presetForDirection(initialDirection) : null)
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
            onBlur={() => setUrlTouched(true)}
            aria-invalid={showUrlError}
            aria-describedby={showUrlError ? 'rebuild-design-url-error' : undefined}
            className={`w-full px-2 py-1.5 rounded-lg border bg-transparent transition-colors duration-200 focus:outline-none text-sm ${
              showUrlError
                ? 'border-intents-ux-feedbackCritical-feedbackColor'
                : 'border-border focus:border-primary'
            }`}
            autoFocus
          />
          {showUrlError && (
            <text.span
              id="rebuild-design-url-error"
              data-testid="rebuild-design-url-error"
              size={-2}
              className="block mt-1 text-start text-intents-ux-feedbackHighContrastCritical-feedbackColor"
            >
              {tr('builder_rebuild_design_url_invalid')}
            </text.span>
          )}
        </div>
        {OPTIONS.map((option, index) => {
          const isSelected = choice?.direction === option.direction
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
                onClick={() => setChoice(presetForDirection(option.direction))}
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
        {showAdvanced && choice && (
          <div
            className="animate-rebuild-reveal grid grid-cols-2 gap-x-16 gap-y-3 w-fit mx-auto"
            style={{ animationDelay: '260ms' }}
          >
            {TOGGLE_FIELDS.map(({ field, labelKey, testId }) => (
              <div key={field} className="flex items-center gap-2">
                <ToggleButton
                  id={testId}
                  data-testid={testId}
                  active={choice[field]}
                  aria-label={tr(labelKey)}
                  onClick={() => setChoice({ ...choice, [field]: !choice[field] })}
                />
                <label htmlFor={testId} className="text-sm cursor-pointer select-none">
                  {tr(labelKey)}
                </label>
              </div>
            ))}
          </div>
        )}
        <Button
          data-testid="rebuild-design-continue"
          design="primary"
          disabled={!choice || !isUrlValid}
          text={t('builder_common_continue', undefined, 'Continue')}
          onClick={() => {
            if (!choice || !isUrlValid) return
            trackRebuildDesignModalChoice(choice.direction)
            onSelect(choice, trimmedUrl)
          }}
        />
      </Box>
    </Modal>
  )
}
