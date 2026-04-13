'use client';

import PlusIcon from '@ux/icon/plus';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';
import EventBadge from './EventBadge';

interface CalendarDayProps {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected?: boolean;
  isXlBreakpoint: boolean;
  events: CalendarEvent[];
  scheduledPosts: ScheduledPost[];
  onClick: (date: Date) => void;
}

export default function CalendarDay({
  date,
  isCurrentMonth,
  isToday,
  isSelected = false,
  isXlBreakpoint,
  events,
  scheduledPosts,
  onClick
}: CalendarDayProps) {
  const t = useTranslations();
  const dayNumber = date.getDate();
  // Scheduled posts/activities show first, then events
  const allItems = [...scheduledPosts, ...events];
  const visibleItems = allItems.slice(0, 3);
  const remainingCount = allItems.length - visibleItems.length;

  // Compare dates only (ignore time) - normalize both to midnight local time
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const cellDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const isPast = cellDate < todayDate;

  return (
    <button
      onClick={() => onClick(date)}
      className={cn(
        'group relative w-full py-1 px-0.5 !rounded-none !border-none',
        'flex flex-col items-center overflow-hidden',
        'xl:aspect-auto xl:items-start xl:text-left xl:p-2 xl:!pt-1 xl:h-full',
        !isCurrentMonth && 'max-xl:invisible xl:bg-intents-ux-boxLowContrast-backgroundColor xl:text-intents-ux-boxLowContrast-foregroundColor',
        isCurrentMonth && 'xl:bg-intents-ux-box-backgroundColor xl:text-intents-ux-box-foregroundColor',
        isPast ? 'opacity-50' : 'cursor-pointer'
      )}
      aria-label={t('builder_marketing_calendar_day_aria_label', { date: date.toDateString(), count: allItems.length })}
    >
      {/* Hover overlay with plus icon - Desktop only */}
      {!isPast && (
        <div className={cn(
          'hidden xl:flex absolute inset-0 p-1',
          'bg-intents-ux-boxLowContrastOverlay-backgroundColor text-intents-ux-boxLowContrastOverlay-foregroundColor',
          'backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center justify-center pointer-events-none'
        )}>
          <div className="flex flex-col items-center gap-1">
            <div className="size-6 rounded-full intents-ux-actionPrimary flex items-center justify-center">
              <PlusIcon className="size-3" />
            </div>
            <text.span as="caption" size={-1} className="text-center">
              {t('builder_marketing_add_marketing_action')}
            </text.span>
          </div>
        </div>
      )}

      <div className="h-full w-full flex flex-col relative items-center xl:items-start justify-start min-w-0">
        {/* Header with day number */}
        <div className={cn(
          'flex justify-center items-center rounded-full size-4 aspect-square mb-0.5 xl:mb-1.5',
          isToday
            ? 'border border-current xl:text-intents-ux-boxHighContrast-foregroundColor xl:bg-intents-ux-boxHighContrast-backgroundColor'
            : 'xl:text-intents-ux-feedbackHighContrastPassive-feedbackColor',
          isSelected && 'border border-current !text-intents-ux-feedbackHighContrastHighlight-onFeedbackColor !bg-intents-ux-feedbackHighContrastHighlight-feedbackColor',
        )}>
          <text.span as="caption" size={isXlBreakpoint ? 0 : 1}>
            {dayNumber}
          </text.span>
        </div>

        {/* Mobile: Show pills (warning for scheduled, success for published, info for events) */}
        {allItems.length > 0 && (
          <div className="max-xl:flex flex-row gap-[1px] h-[6px] w-full max-w-[40px] rounded-full overflow-hidden xl:hidden">
            {scheduledPosts.some(p => p.status === 'scheduled') && (
              <div className="size-full bg-intents-ux-feedbackHighContrastWarning-feedbackColor" />
            )}
            {scheduledPosts.some(p => p.status === 'published') && (
              <div className="size-full bg-intents-ux-feedbackHighContrastSuccess-feedbackColor" />
            )}
            {events.length > 0 && (
              <div className="size-full bg-intents-ux-feedbackHighContrastInfo-feedbackColor" />
            )}
          </div>
        )}

        {/* Desktop: Show full badges (no dots) */}
        <div className="hidden xl:flex flex-1 flex-col gap-1.5 overflow-hidden w-full">
          {visibleItems.map((item, idx) => {
            const isScheduledPost = 'publishedAt' in item;
            return isScheduledPost ? (
              <EventBadge key={`post-${idx}`} scheduledPost={item as ScheduledPost} />
            ) : (
              <EventBadge key={`event-${idx}`} event={item as CalendarEvent} />
            );
          })}

          {remainingCount > 0 && (
            <text.span as="caption" size={-1} emphasis='passive'>
              {t('builder_marketing_more_items', { count: remainingCount })}
            </text.span>
          )}
        </div>
      </div>
    </button>
  );
}
