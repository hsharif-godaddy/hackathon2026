'use client'

import Button from '@ux/button'
import LightningBoltIcon from '@ux/icon/lightning-bolt'
import Spinner from '@ux/spinner'

import { usePulseAnalysis } from '@/hooks/usePulseAnalysis'
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover'
import { PulseInsightCard } from './PulseInsightCard'

export function PulseButton() {
  const { state, publishedUrl, trigger, dismiss } = usePulseAnalysis()

  const isLoading: boolean = state.status === 'loading'
  const hasInsight: boolean = state.status === 'insight'
  const isDisabled: boolean = !publishedUrl || isLoading

  const handleClick = (): void => {
    if (state.status === 'idle' || state.status === 'error' || state.status === 'healthy') {
      void trigger()
    }
  }

  const disabledTitle: string | undefined = !publishedUrl
    ? 'Publish your site first to enable Pulse analysis'
    : undefined

  return (
    <Popover open={hasInsight} onOpenChange={(open) => { if (!open) dismiss() }}>
      <PopoverTrigger asChild>
        <Button
          design="secondary"
          size="small"
          disabled={isDisabled}
          onClick={handleClick}
          title={disabledTitle}
          className="flex items-center gap-1"
        >
          {isLoading
            ? <Spinner size="sm" />
            : <LightningBoltIcon className="size-3" />}
          <span>Pulse</span>
        </Button>
      </PopoverTrigger>
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
