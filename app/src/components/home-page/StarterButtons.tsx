'use client'

import clsx from 'clsx'

import { useTranslations } from '@/hooks/useTranslations'
import { generateClickEID, logClickEvent } from '@/utils/instrumentation'
import { STARTER_CATEGORIES, type StarterCategory } from './starterCategories'

interface StarterButtonsProps {
  /** Currently selected category, or null when none is chosen. */
  selected: StarterCategory | null
  onSelect: (category: StarterCategory) => void
}

export function StarterButtons({ selected, onSelect }: StarterButtonsProps) {
  const t = useTranslations()

  return (
    <div role="group" className="flex flex-wrap items-center justify-center gap-[10px]">
      {STARTER_CATEGORIES.map(function renderStarterButton({ id, labelKey, labelDefault, Icon }) {
        const isSelected: boolean = selected === id
        const isHighlighted: boolean = isSelected || (selected === null && id === 'new_website')
        return (
          <button
            key={id}
            type="button"
            data-testid={`starter-button-${id}`}
            data-eid={generateClickEID(`homepage.starter.${id}`)}
            aria-pressed={isSelected}
            onClick={function handleStarterClick() {
              onSelect(id)
              logClickEvent(`homepage.starter.${id}`)()
            }}
            className={clsx(
              'flex cursor-pointer flex-col items-center justify-center whitespace-nowrap border-2 transition-all hover:brightness-95 gap-1 py-1.5 px-2.5 rounded-xl font-medium min-h-[68px]',
              {
                'border-ai bg-light-purple text-ai': isHighlighted,
                'border-transparent bg-intents-ux-boxLowContrast-backgroundColor text-intents-ux-box-foregroundColor': !isHighlighted,
              },
            )}
          >
            <Icon width={20} height={20} aria-hidden="true" />
            <span style={{ fontSize: '0.675rem' }}>{t(labelKey, undefined, labelDefault)}</span>
          </button>
        )
      })}
    </div>
  )
}
