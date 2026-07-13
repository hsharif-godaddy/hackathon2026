'use client'

// import LightningBoltIcon from '@ux/icon/lightning-bolt'
import Spinner from '@ux/spinner'

import { usePulseAnalysis } from '@/hooks/usePulseAnalysis'
import { Popover, PopoverAnchor, PopoverContent } from '@/lib/shadcn/popover'
import { cn } from '@/lib/utils'
import { PulseInsightCard } from './PulseInsightCard'

export function PulseButton() {
  const { state, publishedUrl, trigger, dismiss } = usePulseAnalysis()

  const isLoading: boolean = state.status === 'loading'
  const hasInsight: boolean = state.status === 'insight'
  const isDisabled: boolean = !publishedUrl || isLoading

  const handleClick = (): void => {
    if (state.status === 'insight') {
      dismiss()
      return
    }
    if (state.status === 'idle' || state.status === 'error' || state.status === 'healthy') {
      void trigger()
    }
  }

  const disabledTitle: string | undefined = !publishedUrl
    ? 'Publish your site first to enable Pulse analysis'
    : undefined

  return (
    <Popover open={hasInsight} onOpenChange={(open) => { if (!open) dismiss() }}>
      <PopoverAnchor asChild>
        <button
          type="button"
          aria-label="Pulse"
          disabled={isDisabled}
          onClick={handleClick}
          title={disabledTitle}
          className={cn(
            'relative flex items-center gap-1 px-1.5 py-1 rounded-xmd shrink-0 transition-colors duration-200 text-sm font-medium whitespace-nowrap cursor-pointer',
            hasInsight
              ? 'bg-[#7c3aed] text-white shadow-md'
              : 'bg-intents-ux-boxLowContrast-backgroundColor',
            isDisabled && 'opacity-25 pointer-events-none'
          )}
        >
          {isLoading && <Spinner size="sm" />}
          <span>⚡ Pulse</span>
        </button>
      </PopoverAnchor>
      {state.status === 'insight' && (
        <PopoverContent side="bottom" align="end" className="p-0 shadow-none border-0 w-auto">
          <PulseInsightCard
            insight={state.insight}
            onDismiss={dismiss}
          />
        </PopoverContent>
      )}
    </Popover>
  )
}
