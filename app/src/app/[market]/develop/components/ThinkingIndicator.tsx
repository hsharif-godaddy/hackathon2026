'use client'
import { Brain } from 'lucide-react';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/utils/common';

interface ThinkingIndicatorProps {
  label?: string;
  active?: boolean;
  activeLabel?: string;
  className?: string;
  duration?: number;
  inline?: boolean;
}

function PulseRings() {
  return (
    <>
      <div className="size-[85%] absolute bg-agent rounded-full animate-agent-pulse opacity-0" />
      <div className="size-[85%] absolute bg-agent rounded-full" />
    </>
  )
}

export default function ThinkingIndicator({
  label,
  active = false,
  activeLabel,
  className,
  duration,
  inline = false
}: ThinkingIndicatorProps) {
  const t = useTranslations();
  const labelDefault = label ?? t('builder_agent_done');
  const activeLabelDefault = activeLabel ?? t('builder_agent_thinking');

  if (inline) {
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-base md:text-sm text-foreground/70", className)}
      >
        <span className="inline-flex items-center justify-center relative">
          {active && <PulseRings />}
          <Brain className="size-2.5 relative" />
        </span>
        <span
          className={cn("whitespace-nowrap", active && "font-semibold")}
          aria-live="polite"
        >
          {active ? activeLabelDefault : labelDefault}
        </span>
      </span>
    )
  }

  return (
    <div className={cn("flex items-center gap-1 text-intents-ux-box-foregroundColor", className)}>
      <div className="flex items-center justify-center relative w-fit h-fit">
        {active && <PulseRings />}
        <Brain className="size-3 relative" />
      </div>
      <div className="flex items-center gap-0.5" aria-live="polite">
        <text.strong as='caption'>
          {active ? <span className="italic">{activeLabelDefault}</span> : labelDefault}
        </text.strong>
        {duration && (
          <span className="bg-intents-ux-boxLowContrast-backgroundColor px-1 rounded-sm">
            {formatDuration(duration)}
          </span>
        )}
      </div>
    </div>
  )
}
