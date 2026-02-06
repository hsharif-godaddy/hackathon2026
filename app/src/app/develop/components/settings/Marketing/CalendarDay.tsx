'use client';

import PlusIcon from '@ux/icon/plus';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';
import EventBadge from './EventBadge';

interface CalendarDayProps {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected?: boolean;
  events: CalendarEvent[];
  scheduledPosts: ScheduledPost[];
  onClick: (date: Date) => void;
}

export default function CalendarDay({
  date,
  isCurrentMonth,
  isToday,
  isSelected = false,
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
        'group relative w-full aspect-square pt-3 px-2 pb-2',
        'flex flex-col items-center overflow-hidden',
        'transition-all duration-200 ease-out',
        'xl:aspect-auto xl:min-h-[160px] xl:items-start xl:text-left xl:pt-3 xl:px-1 xl:pb-2',
        'xl:border-r xl:border-b xl:border-intents-ux-boxLowContrast-borderColor',
        !isCurrentMonth && 'xl:bg-intents-ux-boxLowContrast-backgroundColor/50',
        isCurrentMonth && 'xl:bg-intents-ux-boxStandard-backgroundColor',
        isToday && 'max-lg:rounded-xl max-lg:bg-intents-ux-feedbackInfo-feedbackColor',
        isToday && 'xl:bg-intents-ux-boxStandard-backgroundColor',
        isSelected && !isToday && 'border-2 border-intents-ux-actionPrimary-backgroundColor rounded-xl xl:ring-2 xl:ring-inset xl:ring-intents-ux-actionPrimary-backgroundColor xl:border-0 xl:rounded-none',
        isPast ? 'opacity-50' : 'cursor-pointer'
      )}
      aria-label={t('builder_marketing_calendar_day_aria_label', { date: date.toDateString(), count: allItems.length })}
    >
      {/* Hover overlay with plus icon - Desktop only */}
      {!isPast && (
        <div className="hidden xl:flex absolute inset-0 bg-intents-ux-boxLowContrastOverlay-backgroundColor backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center gap-1">
            <div className="w-8 h-8 rounded-full bg-intents-ux-feedbackInfo-feedbackColor flex items-center justify-center shadow-md">
              <PlusIcon className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium text-intents-ux-actionPrimary-textColor text-center">
              {t('builder_marketing_add_marketing_action')}
            </span>
          </div>
        </div>
      )}

      <div className="h-full w-full flex flex-col relative items-center xl:items-start justify-center xl:justify-start min-w-0">
        {/* Header with day number */}
        <div className="mb-0.5 xl:mb-1.5 text-center xl:text-left">
          <span
            className={cn(
              'text-xs font-semibold transition-all duration-200',
              isToday
                ? 'xl:inline-flex xl:items-center xl:justify-center xl:w-6 xl:h-6 xl:rounded-full xl:bg-intents-ux-feedbackInfo-feedbackColor xl:shadow-md'
                : 'xl:text-sm text-intents-ux-textStandard-textColor group-hover:text-intents-ux-actionPrimary-textColor'
            )}
          >
            {dayNumber}
          </span>
        </div>

        {/* Mobile: Show dots (warning for scheduled, success for published, info for events) */}
        {allItems.length > 0 && (
          <div className="max-xl:flex flex-row items-center justify-center gap-1 mb-1 xl:hidden">
            {scheduledPosts.some(p => p.status === 'scheduled') && (
              <div className="w-2 h-2 bg-intents-ux-feedbackHighContrastWarning-feedbackColor rounded-full flex-shrink-0" />
            )}
            {scheduledPosts.some(p => p.status === 'published') && (
              <div className="w-2 h-2 bg-intents-ux-feedbackHighContrastSuccess-feedbackColor rounded-full flex-shrink-0" />
            )}
            {events.length > 0 && (
              <div className="w-2 h-2 bg-intents-ux-feedbackHighContrastInfo-feedbackColor rounded-full flex-shrink-0" />
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
            <div className="text-xs text-intents-ux-actionPrimary-textColor font-semibold text-left pt-0.5 group-hover:underline">
              {t('builder_marketing_more_items', { count: remainingCount })}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
