'use client';

import CalendarIcon from '@ux/icon/calendar';
import CheckmarkIcon from '@ux/icon/checkmark';
import ClockIcon from '@ux/icon/clock';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';

interface EventBadgeProps {
  event?: CalendarEvent;
  scheduledPost?: ScheduledPost;
}

export default function EventBadge({ event, scheduledPost }: EventBadgeProps) {
  const t = useTranslations();

  if (event) {
    return (
      <div
        className={cn(
          'flex items-start gap-1.5 py-0.5 px-1.5 w-full min-w-0 rounded-md',
          'bg-intents-ux-boxLowContrast-backgroundColor/50',
          'hover:bg-intents-ux-boxLowContrast-backgroundColor',
          'transition-all duration-150 group/badge'
        )}
        title={event.description || event.name}
      >
        {/* Calendar icon with subtle scale on hover */}
        <span className="flex-shrink-0 text-intents-ux-info-textColor transition-transform duration-150 group-hover/badge:scale-110">
          <CalendarIcon className="w-3.5 h-3.5" />
        </span>

        {/* Full event name - wraps to multiple lines */}
        <span className="text-xs font-medium text-intents-ux-textStandard-textColor leading-tight min-w-0">
          {event.name}
        </span>
      </div>
    );
  }

  if (scheduledPost) {
    const isScheduled = scheduledPost.status === 'scheduled';

    return (
      <div
        className={cn(
          'flex flex-col items-center gap-1 px-1.5 py-1 rounded-md border-2 w-full min-w-0',
          'transition-all duration-150 group/badge',
          isScheduled && 'border-intents-ux-warning-borderColor bg-intents-ux-warning-backgroundColor border-dashed',
          !isScheduled && 'border-intents-ux-feedbackSuccess-borderColor bg-intents-ux-feedbackSuccess-backgroundColor'
        )}
        title={scheduledPost.title}
      >
        <div className={cn(
          'flex-shrink-0 transition-transform duration-150 group-hover/badge:scale-110',
          isScheduled ? 'text-intents-ux-warning-textColor' : 'text-intents-ux-feedbackSuccess-textColor'
        )}>
          {isScheduled ? (
            <ClockIcon className="w-3 h-3" />
          ) : (
            <CheckmarkIcon className="w-3 h-3" />
          )}
        </div>

        <span className={cn(
          'text-xs font-semibold leading-tight text-center min-w-0',
          isScheduled ? 'text-intents-ux-warning-textColor' : 'text-intents-ux-feedbackSuccess-textColor'
        )}>
          {t('builder_marketing_blog_prefix')}: {scheduledPost.title}
        </span>
      </div>
    );
  }

  return null;
}
