'use client'

import Button from '@ux/button'

type BaseProps = {
  applyLabel: string
  applyTestId?: string
  disableApply?: boolean
  disableGenerateMore?: boolean
  generateMoreLabel: string
  generateMoreTestId?: string
  onApply: () => void
  onGenerateMore: () => void
}

type WithCancel = {
  showCancel: true
  cancelLabel: string
  cancelTestId?: string
  disableCancel?: boolean
  onCancel: () => void
}

type WithoutCancel = {
  showCancel?: false
  cancelLabel?: never
  cancelTestId?: never
  disableCancel?: never
  onCancel?: never
}

export type AgentChoiceActionFooterProps = BaseProps & (WithCancel | WithoutCancel)

export default function AgentChoiceActionFooter({
  applyLabel,
  applyTestId = 'agent-choice-apply',
  cancelLabel,
  cancelTestId = 'agent-choice-cancel',
  disableApply = false,
  disableCancel = false,
  disableGenerateMore = false,
  generateMoreLabel,
  generateMoreTestId = 'agent-choice-generate-more',
  onApply,
  onCancel,
  onGenerateMore,
  showCancel,
}: AgentChoiceActionFooterProps) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-1">
      <Button
        data-testid={generateMoreTestId}
        design="tertiary"
        disabled={disableGenerateMore}
        onClick={onGenerateMore}
        size="sm"
        text={generateMoreLabel}
      />
      <div className="flex gap-1">
        {showCancel ? (
          <Button
            data-testid={cancelTestId}
            design="secondary"
            disabled={disableCancel}
            onClick={onCancel}
            size="sm"
            text={cancelLabel}
          />
        ) : null}
        <Button
          data-testid={applyTestId}
          design="primary"
          disabled={disableApply}
          onClick={onApply}
          size="sm"
          text={applyLabel}
        />
      </div>
    </div>
  )
}
