'use client'

import ClockIcon from '@ux/icon/clock'

import { useTranslations } from '@/hooks/useTranslations'
import BuildProgressTracker from './BuildProgressTracker'
import { NavButton } from './NavButton'

interface ProgressTrackerCardProps {
  title: string
  timeEstimateMinutes: number | null
  /** First visible tip (title + description), or null when none are loaded yet. */
  tip: { title: string; description: string } | null
  onPrev: () => void
  onNext: () => void
}

/**
 * Unified white card shown during the first build: title, time-estimate pill,
 * the progress stepper, and the rotating tip with prev/next nav. The exact px
 * geometry, radii, shadow, and colors the approved design depends on are kept
 * as Tailwind arbitrary-value classes rather than spacing-scale tokens (the
 * scale can resolve larger than these literals).
 */
export function ProgressTrackerCard({ title, timeEstimateMinutes, tip, onPrev, onNext }: ProgressTrackerCardProps) {
  const t = useTranslations()

  return (
    <div className="flex w-full max-w-2xl flex-col items-center px-3">
      <div className="flex w-full flex-col items-center gap-0 rounded-[20px] bg-[#ffffff] px-[36px] pb-[28px] pt-[32px] shadow-[0_4px_32px_rgba(20,20,40,0.08)]">
        {/* Title */}
        <div className="mb-[12px] text-center text-[22px] font-bold leading-[1.3] text-[rgba(20,20,40,0.9)]">
          {title}
        </div>

        {/* Clock pill */}
        {timeEstimateMinutes != null && (
          <div
            data-testid="build-time-estimate"
            role="status"
            className="mb-[24px] inline-flex items-center gap-[6px] rounded-full bg-[rgba(20,20,40,0.04)] px-[12px] py-[4px]"
          >
            <ClockIcon width={18} height={18} aria-hidden="true" className="text-ai-light" />
            <span className="text-sm text-[rgba(20,20,30,0.78)]">
              {t('builder_preview_build_time_estimate', { minutes: timeEstimateMinutes }, 'On average ~{minutes} minutes')}
            </span>
          </div>
        )}

        {/* Progress tracker (no card shell — lives inside this card) */}
        <div className="mb-[36px] w-full">
          <BuildProgressTracker />
        </div>

        {/* Copy card with inline ‹ › nav */}
        {tip && (
          <div role="status" aria-live="polite" className="sr-only">
            {tip.title}
          </div>
        )}
        {tip && (
          <div className="flex w-full items-center gap-[12px] rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-[20px]">
            <NavButton direction="prev" label={t('builder_tips_nav_prev', undefined, 'Previous tip')} onClick={onPrev} />
            <div className="flex min-h-[84px] flex-1 flex-col justify-center">
              <div className="text-base font-semibold">{tip.title}</div>
              <div className="text-sm">{tip.description}</div>
            </div>
            <NavButton direction="next" label={t('builder_tips_nav_next', undefined, 'Next tip')} onClick={onNext} />
          </div>
        )}
      </div>
    </div>
  )
}
