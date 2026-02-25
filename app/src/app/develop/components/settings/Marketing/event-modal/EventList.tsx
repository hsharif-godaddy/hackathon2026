'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { useIsMobile } from '@/hooks/use-mobile';
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
  const isMobile = useIsMobile();
  const hasEvents = events.length > 0;

  if (!hasEvents && !isPast) {
    return (
      <Box gap="xl">
        {/* Modal Content */}
        <Box gap="sm" inlinePadding='md' blockPadding='md' className="text-center border-0 intents-ux-boxLowContrast">
          <text.p>
            {t('builder_marketing_no_events_for_day')}
          </text.p>
        </Box>

        {/* Modal Actions */}
        <Box orientation="horizontal" blockAlignChildren="end" gap="sm">
          <Button
            onClick={onBack}
            design="secondary"
            size="md"
          >
            {t('builder_marketing_back')}
          </Button>
          <Button
            onClick={onCreateCustomPost}
            design="primary"
            size="md"
          >
            {contentType === 'blog'
              ? t('builder_marketing_schedule_blog_post')
              : t('builder_marketing_schedule_socialpost')}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box gap="xl">
      <Box gap="md">
        {events.map((event, idx) => (
          <Box
            key={idx}
            gap="md"
            inlineAlignChildren='center'
            orientation={isMobile ? 'vertical' : 'horizontal'}
            blockPadding='lg'
            inlinePadding='lg'
            elevation="card"
          >
            <TextLockup
              title={event.name}
              titleLevel={4}
              size="md"
              className='grow'
            >
              {event.description}
            </TextLockup>
            <Box orientation="horizontal" blockAlignChildren="end" gap="sm">
              <Button
                onClick={() => onSelectEvent(event)}
                disabled={isPast}
                design="secondary"
                size="sm"
              >
                {isPast ? t('builder_marketing_past_date') : t('builder_marketing_schedule_post')}
              </Button>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Custom post option */}
      <Box orientation="horizontal" blockAlignChildren="end" gap="sm">
        <Button
          onClick={onBack}
          design="secondary"
          size="md"
        >
          {t('builder_marketing_back')}
        </Button>
        <Button
          onClick={onCreateCustomPost}
          disabled={isPast}
          design="primary"
          size="md"
        >
          {t('builder_marketing_schedule_custom_post')}
        </Button>
      </Box>
    </Box>
  );
}
