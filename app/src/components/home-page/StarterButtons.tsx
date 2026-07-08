'use client'

import { type ReactElement } from 'react'

import { StarterButton } from './StarterButton'
import { DEFAULT_STARTER_CATEGORY, STARTER_CATEGORIES, type StarterCategory } from './starterCategories'

type StarterButtonsVariant = 'card' | 'hero'

interface StarterButtonsProps {
  /** Currently selected category, or null when none is chosen. */
  selected: StarterCategory | null
  onSelect: (category: StarterCategory) => void
  /**
   * `card` (default) — inside the white prompt card, centered wrap (desktop).
   * `hero` — on the dark hero background above the card, a single horizontally
   * scrollable row (mobile).
   */
  variant?: StarterButtonsVariant
}

export function StarterButtons({ selected, onSelect, variant = 'card' }: StarterButtonsProps) {
  const isHero: boolean = variant === 'hero'

  function renderStarterButton(category: (typeof STARTER_CATEGORIES)[number]): ReactElement {
    const isSelected: boolean = selected === category.id
    const isHighlighted: boolean = isSelected || (selected === null && category.id === DEFAULT_STARTER_CATEGORY)
    return (
      <StarterButton
        key={category.id}
        category={category}
        isSelected={isSelected}
        isHighlighted={isHighlighted}
        isHero={isHero}
        onSelect={onSelect}
      />
    )
  }

  if (isHero) {
    return (
      <div role="group" className="no-scrollbar flex items-center gap-[10px] overflow-x-auto scroll-smooth">
        {STARTER_CATEGORIES.map(renderStarterButton)}
      </div>
    )
  }

  return (
    <div role="group" className="flex flex-wrap items-center justify-center gap-[10px]">
      {STARTER_CATEGORIES.map(renderStarterButton)}
    </div>
  )
}
