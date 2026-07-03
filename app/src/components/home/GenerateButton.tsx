'use client'

import SendIcon from '@ux/icon/send'

interface GenerateButtonProps {
  onClick: () => void
  disabled: boolean
  label: string
  'data-eid'?: string
  'data-testid'?: string
}

export function GenerateButton({ onClick, disabled, label, 'data-eid': dataEid, 'data-testid': dataTestId }: GenerateButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-eid={dataEid}
      data-testid={dataTestId}
      aria-label={label}
      className="flex cursor-pointer items-center gap-2 bg-ai text-intents-ux-boxHighContrast-foregroundColor transition-colors hover:bg-ai-light disabled:opacity-50 disabled:cursor-not-allowed px-[18px] py-[10px] rounded-2xl"
    >
      <span className="text-sm font-medium">{label}</span>
      <SendIcon width={16} height={16} aria-hidden="true" />
    </button>
  )
}
