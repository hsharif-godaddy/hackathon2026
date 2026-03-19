'use client';

import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import Box from '@ux/box';
import Button from '@ux/button';
import CalendarIcon from '@ux/icon/calendar';
import CheckmarkIcon from '@ux/icon/checkmark';
import ChevronLeftIcon from '@ux/icon/chevron-left';
import ChevronRightIcon from '@ux/icon/chevron-right';
import ClockIcon from '@ux/icon/clock';
import Tag from '@ux/tag';
import text, { type Emphasis } from '@ux/text';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useTranslations } from '@/hooks/useTranslations';
import { fetchCalendarData } from '@/lib/marketing/fetch-calendar-data';
import { cn } from '@/lib/utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';
import CalendarDay from './CalendarDay';
import EventModal from './EventModal';

interface LegendItemProps {
  emphasis: Emphasis;
  dotColor: string;
  icon: React.ReactNode;
  label: string;
}

function LegendItem({ emphasis, dotColor, icon, label }: LegendItemProps) {
  return (
    <div className="flex items-center gap-1">
      <div className={cn('w-2 h-2 rounded-full xl:hidden', dotColor)} />
      <text.span emphasis={emphasis} className="hidden xl:block">
        {icon}
      </text.span>
      <text.strong as="caption">{label}</text.strong>
    </div>
  );
}

interface EventCardItemProps {
  description?: React.ReactNode;
  emphasis: Emphasis;
  eyebrow?: React.ReactNode;
  icon: React.ReactNode;
  onClick?: () => void;
  title: string;
}

function EventCardItem({
  description,
  emphasis,
  eyebrow,
  icon,
  onClick,
  title,
}: EventCardItemProps) {
  const t = useTranslations();
  const { isLgBreakpoint } = useBreakpoints();
  return (
    <Box gap="sm" orientation="horizontal" stretch>
      <text.span emphasis={emphasis}>
        {icon}
      </text.span>
      <Box
        gap="md"
        orientation={isLgBreakpoint ? 'horizontal' : 'vertical'}
        inlineAlignChildren={isLgBreakpoint ? 'start' : undefined}
        stretch
      >
        <Box gap="sm" orientation="vertical" inlineAlignChildren="start" stretch>
          <text.div as="title" size={-1}>{title}</text.div>
          {eyebrow}
          {description && (
            <text.div as="paragraph" size={-1} emphasis="passive">{description}</text.div>
          )}
        </Box>
        {onClick && (
          <Button
            design="secondary"
            size="sm"
            onClick={onClick}
            text={t('builder_marketing_schedule_post')}
          />
        )}
      </Box>
    </Box>
  );
}

interface ContentCalendarProps {
  appId: string;
  onLoadingChange?: (loading: boolean) => void;
}

export default function ContentCalendar({ appId, onLoadingChange }: ContentCalendarProps) {
  const t = useTranslations();
  const intl = useIntl();
  const { isXlBreakpoint } = useBreakpoints();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // Get user's locale and timezone
  const userLocale = useMemo(() => {
    if (typeof navigator !== 'undefined') {
      return navigator.language || 'en-US';
    }
    return 'en-US';
  }, []);

  const userTimezone = useMemo(() => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }, []);

  const dayNames = useMemo(() => [
    t('builder_marketing_day_sunday'),
    t('builder_marketing_day_monday'),
    t('builder_marketing_day_tuesday'),
    t('builder_marketing_day_wednesday'),
    t('builder_marketing_day_thursday'),
    t('builder_marketing_day_friday2'), // replaces bad "extra space" key
    t('builder_marketing_day_saturday')
  ], [t]);

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // Auto-select today on mobile
  useEffect(() => {
    if (!isXlBreakpoint) {
      setSelectedDate(new Date());
    }
  }, [isXlBreakpoint]);

  // Fetch calendar data
  useEffect(() => {
    const loadCalendarData = async () => {
      if (!appId) {return;}

      setIsLoading(true);
      try {
        const data = await fetchCalendarData({
          appId,
          month: currentMonth,
          market: userLocale,
          timezone: userTimezone,
        });

        setEvents(data.events);
        setScheduledPosts(data.scheduledPosts);
      } catch (_error) {
        // Error is silently handled - loading state will reset
      } finally {
        setIsLoading(false);
      }
    };

    void loadCalendarData();
  }, [appId, currentMonth, userLocale, userTimezone]);

  // Generate calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    // Create dates at noon to avoid timezone issues
    const firstDay = new Date(year, month, 1, 12, 0, 0, 0);
    const lastDay = new Date(year, month + 1, 0, 12, 0, 0, 0);

    // Calculate start date (may be in previous month)
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay());

    // Calculate end date (may be in next month)
    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

    const days: Date[] = [];
    const current = new Date(startDate);

    while (current <= endDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return days;
  }, [currentMonth]);

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedEvent(null);
    if (isXlBreakpoint) {
      setIsModalOpen(true);
    } else {
      document.getElementById('mobile-date-header')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    if (!isXlBreakpoint) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    setIsModalOpen(true);
  };

  const getEventsForDate = (date: Date): CalendarEvent[] => {
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    return events.filter(event => {
      const eventDate = new Date(event.date);
      const normalizedEventDate = new Date(
        eventDate.getFullYear(),
        eventDate.getMonth(),
        eventDate.getDate()
      );
      return normalizedEventDate.getTime() === targetDate.getTime();
    });
  };

  const getScheduledPostsForDate = (date: Date): ScheduledPost[] => {
    // Normalize to local date for comparison (ignore time)
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    return scheduledPosts.filter(post => {
      const postDate = new Date(post.publishedAt);
      const normalizedPostDate = new Date(
        postDate.getFullYear(),
        postDate.getMonth(),
        postDate.getDate()
      );

      return normalizedPostDate.getTime() === targetDate.getTime();
    });
  };

  const isToday = (date: Date): boolean => {
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const cellDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return cellDate.getTime() === todayDate.getTime();
  };

  const isCurrentMonthDay = (date: Date): boolean => {
    return date.getMonth() === currentMonth.getMonth();
  };

  return (
    <Box gap="lg" className="max-w-[1400px] mt-2">
      {/* Header with Legend - Responsive */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 xl:gap-4">
          <LegendItem
            emphasis="warning"
            dotColor="bg-intents-ux-feedbackHighContrastWarning-feedbackColor"
            icon={<ClockIcon className="size-3" />}
            label={t('builder_marketing_legend_scheduled')}
          />
          <LegendItem
            emphasis="success"
            dotColor="bg-intents-ux-feedbackHighContrastSuccess-feedbackColor"
            icon={<CheckmarkIcon className="size-3" />}
            label={t('builder_marketing_legend_published')}
          />
          <LegendItem
            emphasis="info"
            dotColor="bg-intents-ux-feedbackHighContrastInfo-feedbackColor"
            icon={<CalendarIcon className="size-3" />}
            label={t('builder_marketing_legend_marketing_events')}
          />
        </div>

        {/* Month Navigation */}
        <div className="flex items-center justify-center gap-3">
          <Button
            onClick={handlePrevMonth}
            design="minimal"
            size="md"
            icon={<ChevronLeftIcon />}
            aria-label={t('builder_marketing_previous_month')}
          />
          <text.h3 as="title" className="text-center">
            {intl.formatDate(currentMonth, {
              month: 'long',
              year: 'numeric',
              timeZone: userTimezone
            })}
          </text.h3>
          <Button
            onClick={handleNextMonth}
            design="minimal"
            size="md"
            icon={<ChevronRightIcon />}
            aria-label={t('builder_marketing_next_month')}
          />
        </div>

      </div>

      {/* Calendar Grid */}
      <div className="overflow-hidden xl:bg-intents-ux-box-backgroundColor xl:border-intents-ux-box-borderColor xl:border-r xl:border-t">
        {/* Day names header */}
        <div className="grid grid-cols-7">
          {dayNames.map((day, idx) => (
            <div
              key={idx}
              className="text-center overflow-hidden py-1 px-0.5 xl:px-2 xl:border-intents-ux-box-borderColor xl:border-l xl:border-b"
            >
              <text.strong as="label" size={isXlBreakpoint ? 0 : -1}>
                {day.slice(0, 3)}
              </text.strong>
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => (
            <div key={idx} className="border-t border-intents-ux-box-borderColor xl:min-h-[160px] xl:border-l xl:border-b xl:border-t-0">
              <CalendarDay
                date={day}
                isCurrentMonth={isCurrentMonthDay(day)}
                isToday={isToday(day)}
                isSelected={selectedDate?.toDateString() === day.toDateString()}
                isXlBreakpoint={isXlBreakpoint}
                events={getEventsForDate(day)}
                scheduledPosts={getScheduledPostsForDate(day)}
                onClick={handleDayClick}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Selected Day Details - Mobile Only */}
      {selectedDate && (
        <div className="xl:hidden">
          <Box gap="lg">
            {/* Date Header */}
            <div id="mobile-date-header" className="text-center pb-2 border-b border-intents-ux-boxLowContrast-borderColor">
              <text.p as="title">
                {intl.formatDate(selectedDate, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  timeZone: userTimezone
                })}
              </text.p>
            </div>

            {(getEventsForDate(selectedDate).length > 0 || getScheduledPostsForDate(selectedDate).length > 0) ? (
              <Box gap="sm">
                {getScheduledPostsForDate(selectedDate).map((post, idx) => {
                  const isScheduled = post.status === 'scheduled';
                  return (
                    <Box
                      key={`post-${idx}`}
                      elevation="card"
                      inlinePadding="md"
                      blockPadding="md"
                    >
                      <EventCardItem
                        title={isScheduled ? t('builder_marketing_scheduled_blog_post') : t('builder_marketing_published_blog_post')}
                        emphasis={isScheduled ? 'warning' : 'success'}
                        icon={isScheduled ? <ClockIcon /> : <CheckmarkIcon />}
                        description={
                          <div className="flex flex-col gap-0.5 text-intents-ux-feedbackHighContrastPassive-feedbackColor">
                            <p>
                              {intl.formatTime(new Date(post.publishedAt), {
                                hour: '2-digit',
                                minute: '2-digit',
                                timeZone: userTimezone
                              })}
                            </p>
                            <p>{post.title}</p>
                          </div>
                        }
                      />
                    </Box>
                  );
                })}

                {getEventsForDate(selectedDate).map((event, idx) => (
                  <Box
                    key={`event-${idx}`}
                    elevation="card"
                    inlinePadding="md"
                    blockPadding="md"
                  >
                    <EventCardItem
                      description={event.description}
                      emphasis="info"
                      eyebrow={
                        <Tag emphasis="info" size="sm">
                          {t('builder_marketing_suggested_marketing_event')}
                        </Tag>
                      }
                      icon={<CalendarIcon />}
                      title={event.name}
                      onClick={() => handleEventClick(event)}
                    />
                  </Box>
                ))}
              </Box>
            ) : (
              <Box gap="sm" inlinePadding="md" blockPadding="md" className="text-center border-0 intents-ux-box">
                <text.p>
                  {t('builder_marketing_no_events_scheduled')}
                </text.p>
              </Box>
            )}

            <Button
              onClick={() => {
                setSelectedEvent(null);
                if (!isXlBreakpoint) {
                  window.scrollTo({ top: 0, behavior: 'instant' });
                }
                setIsModalOpen(true);
              }}
              design="primary"
              size="md"
              className="w-full"
              text={t('builder_marketing_add_custom_marketing_action')}
            />
          </Box>
        </div>
      )}

      {/* Event Modal */}
      {selectedDate && (
        <EventModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedDate(null);
            setSelectedEvent(null);
          }}
          date={selectedDate}
          events={getEventsForDate(selectedDate)}
          scheduledPosts={getScheduledPostsForDate(selectedDate)}
          appId={appId}
          initialEvent={selectedEvent}
        />
      )}
    </Box>
  );
}
