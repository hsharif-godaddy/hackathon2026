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
}

/**
 * Thinking indicator component
 *
 * Displays an icon to represent the agent's thinking process and a duration in MM:SS format.
 *
 * @returns React element for the thinking indicator
 */
export default function ThinkingIndicator({
  label,
  active = false,
  activeLabel,
  className,
  duration
}: ThinkingIndicatorProps) {
  const t = useTranslations();
  const labelDefault = label ?? t('builder_agent_done');
  const activeLabelDefault = activeLabel ?? t('builder_agent_thinking');

  return (
    <div className={cn("flex items-center gap-1 text-intents-ux-box-foregroundColor", className)}>
      <div className="flex items-center justify-center relative w-fit h-fit">
        { active && (
          <>
            <div className="size-[85%] absolute bg-agent rounded-full animate-agent-pulse opacity-0"></div>
            <div className="size-[85%] absolute bg-agent rounded-full"></div>
          </>
        )}
        <Brain className="size-3 relative" />
      </div>
      <div className="flex items-center gap-0.5" aria-live="polite">
        <text.strong as='caption'>
          { active ? <span className="italic">{activeLabelDefault}</span> : labelDefault }
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

