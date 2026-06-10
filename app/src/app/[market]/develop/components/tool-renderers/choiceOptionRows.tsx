'use client'

import CheckmarkIcon from '@ux/icon/checkmark'

export function numberedLabel(index: number, text: string): string {
  return `${index + 1}. ${text}`
}

export function choiceRowClassName(isSelected: boolean): string {
  return `flex w-full items-center justify-between gap-2 px-2 py-1.5 rounded-lg border-solid text-sm text-intents-ux-box-foregroundColor bg-intents-ux-boxLowContrast-backgroundColor text-left transition-colors cursor-pointer enabled:hover:bg-intents-ux-actionHovered-backgroundColor disabled:opacity-50 disabled:cursor-not-allowed ${
    isSelected
      ? 'border-2 border-intents-ux-box-foregroundColor'
      : 'border-2 border-transparent'
  }`
}

export function RowSelectionIndicator({ isMulti, isSelected }: { isMulti: boolean; isSelected: boolean }) {
  if (isMulti) {
    if (isSelected) {
      return (
        <span
          aria-hidden="true"
          className="flex shrink-0 items-center justify-center w-3 h-3 rounded-sm bg-intents-ux-box-foregroundColor [&_svg]:w-1.5 [&_svg]:h-1.5"
        >
          <CheckmarkIcon className="text-intents-ux-box-backgroundColor" />
        </span>
      )
    }
    return (
      <span
        aria-hidden="true"
        className="flex shrink-0 w-3 h-3 rounded-sm border border-intents-ux-boxLowContrast-borderColor"
      />
    )
  }

  if (!isSelected) return null

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center w-3 h-3 rounded-full bg-intents-ux-box-foregroundColor [&_svg]:w-1.5 [&_svg]:h-1.5"
    >
      <CheckmarkIcon className="text-intents-ux-box-backgroundColor" />
    </span>
  )
}

interface ChoiceOptionRowProps {
  index: number
  text: string
  isMulti: boolean
  isSelected: boolean
  disabled?: boolean
  onClick: () => void
}

export function ChoiceOptionRow({
  index,
  text,
  isMulti,
  isSelected,
  disabled,
  onClick,
}: ChoiceOptionRowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={onClick}
      data-testid="choice-option-row"
      className={choiceRowClassName(isSelected)}
    >
      <span className="flex-1 min-w-0 text-sm text-left">
        {numberedLabel(index, text)}
      </span>
      <RowSelectionIndicator isMulti={isMulti} isSelected={isSelected} />
    </button>
  )
}
