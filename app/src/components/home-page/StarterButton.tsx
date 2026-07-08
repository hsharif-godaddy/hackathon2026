'use client'

import clsx from 'clsx'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'
import { type StarterCategory, type StarterCategoryConfig } from './starterCategories'

interface StarterButtonProps {
  category: StarterCategoryConfig
  /** Whether this category is explicitly selected. */
  isSelected: boolean
  /** Whether to render the highlighted (selected-or-default) treatment. */
  isHighlighted: boolean
  /** `true` on the dark hero row (mobile), `false` in the white card (desktop). */
  isHero: boolean
  onSelect: (category: StarterCategory) => void
}

export function StarterButton({ category, isSelected, isHighlighted, isHero, onSelect }: StarterButtonProps) {
  const t = useTranslations()
  const { id, labelKey, labelDefault, Icon } = category

  return (
    <button
      type="button"
      data-testid={`starter-button-${id}`}
      data-eid={generateClickEID(`homepage.starter.${id}`)}
      aria-pressed={isSelected}
      onClick={function handleStarterClick() {
        onSelect(id)
        logClickEvent(`homepage.starter.${id}`)()
      }}
      className={clsx(
        'flex shrink-0 cursor-pointer flex-col items-center justify-center whitespace-nowrap border-[3px] transition-all hover:brightness-95 gap-1 py-1.5 px-2.5 rounded-xl font-medium min-h-[68px]',
        {
          // Hero: fix each button to a fraction of the row so ~3.5 show at any
          // mobile width — the half-cut last button signals it's swipe-scrollable.
          'basis-[28%] grow-0': isHero,
          'border-transparent bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-box-foregroundColor': !isHighlighted,
          'border-ai bg-light-purple text-ai': isHighlighted && !isHero,
          'border-ai bg-intents-ux-boxLowContrast-backgroundColor text-ai': isHighlighted && isHero,
        },
      )}
    >
      <Icon width={20} height={20} aria-hidden="true" />
      <span style={{ fontSize: '0.675rem' }}>{t(labelKey, undefined, labelDefault)}</span>
    </button>
  )
}
