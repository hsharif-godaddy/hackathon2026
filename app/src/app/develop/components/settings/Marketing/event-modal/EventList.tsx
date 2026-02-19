'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { CalendarEvent } from '@/types/marketing';
import { ContentType } from './types';

interface EventListProps {
  events: CalendarEvent[];
  contentType: ContentType;
  isPast: boolean;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreateCustomPost: () => void;
  onBack: () => void;
}

export default function EventList({
  events,
  contentType,
  isPast,
  onSelectEvent,
  onCreateCustomPost,
  onBack
}: EventListProps) {
  const t = useTranslations();
  const hasEvents = events.length > 0;

  if (!hasEvents && !isPast) {
    return (
      <Box gap="md">
        <Box gap="sm" className="py-4 text-center">
          <text.p className="text-intents-ux-textSubdued-textColor">
            {t('builder_marketing_no_events_for_day')}
          </text.p>
        </Box>
        <Box orientation="horizontal" gap="sm">
          <Button
            onClick={onBack}
            design="tertiary"
            size="md"
          >
            {t('builder_marketing_back')}
          </Button>
          <Button
            onClick={onCreateCustomPost}
            design="primary"
            size="md"
            className="flex-1"
          >
            {contentType === 'blog'
              ? t('builder_marketing_schedule_blog_post')
              : t('builder_marketing_schedule_social_post')}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box gap="lg">
      {events.map((event, idx) => (
        <Box key={idx} gap="md" className="pb-4 border-b border-intents-ux-boxLowContrast-borderColor last:border-0 last:pb-0">
          <Box gap="sm">
            <text.p className="font-semibold text-lg">{event.name}</text.p>
            {event.description && (
              <text.p className="text-sm text-intents-ux-textSubdued-textColor">
                {event.description}
              </text.p>
            )}
          </Box>
          <Button
            onClick={() => onSelectEvent(event)}
            disabled={isPast}
            design="primary"
            size="md"
            className="w-full"
          >
            {isPast ? t('builder_marketing_past_date') : t('builder_marketing_schedule_post')}
          </Button>
        </Box>
      ))}

      {/* Custom post option */}
      <Box orientation="horizontal" gap="sm">
        <Button
          onClick={onBack}
          design="tertiary"
          size="md"
        >
          {t('builder_marketing_back')}
        </Button>
        <Button
          onClick={onCreateCustomPost}
          disabled={isPast}
          design="secondary"
          size="md"
          className="flex-1"
        >
          {t('builder_marketing_schedule_custom_post')}
        </Button>
      </Box>
    </Box>
  );
}
