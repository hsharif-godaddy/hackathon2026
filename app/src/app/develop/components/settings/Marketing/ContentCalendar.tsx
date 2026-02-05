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
import Spinner from '@ux/spinner';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { fetchCalendarData } from '@/lib/marketing/fetch-calendar-data';
import { cn } from '@/lib/utils';
import { CalendarEvent, ScheduledPost } from '@/types/marketing';
import CalendarDay from './CalendarDay';
import EventModal from './EventModal';

interface ContentCalendarProps {
  appId: string;
}

export default function ContentCalendar({ appId }: ContentCalendarProps) {
  const t = useTranslations();
  const intl = useIntl();
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
    t('builder_marketing_day_friday'),
    t('builder_marketing_day_saturday')
  ], [t]);

  // Auto-select today on mobile
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setSelectedDate(new Date());
    }
  }, []);

  // Fetch calendar data
  useEffect(() => {
    const loadCalendarData = async () => {
      if (!appId) return;

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
    // On desktop, open modal immediately. On mobile, just show details below calendar
    if (typeof window !== 'undefined' && window.innerWidth >= 1280) {
      setIsModalOpen(true);
    }
  };

  const handleEventClick = (event: CalendarEvent) => {
    setSelectedEvent(event);
    // Scroll to top on mobile FIRST, then open modal
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
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
    <Box gap="xl" className="max-w-[1400px]">
      {/* Header with Legend - Responsive */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 xl:gap-4">
          <div className="flex items-center gap-1.5">
            {/* Warning dot on mobile, clock icon on desktop */}
            <div className="w-2 h-2 bg-intents-ux-feedbackHighContrastWarning-feedbackColor rounded-full xl:hidden" />
            <div className="hidden xl:flex items-center justify-center w-4 h-4 rounded text-intents-ux-warning-textColor">
              <ClockIcon className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-medium text-intents-ux-textStandard-textColor">{t('builder_marketing_legend_scheduled')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Success dot on mobile, checkmark on desktop */}
            <div className="w-2 h-2 bg-intents-ux-feedbackHighContrastSuccess-feedbackColor rounded-full xl:hidden" />
            <div className="hidden xl:flex items-center justify-center w-4 h-4 rounded text-intents-ux-feedbackSuccess-textColor">
              <CheckmarkIcon className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-medium text-intents-ux-textStandard-textColor">{t('builder_marketing_legend_published')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Info dot on mobile, calendar icon on desktop */}
            <div className="w-2 h-2 bg-intents-ux-feedbackHighContrastInfo-feedbackColor rounded-full xl:hidden" />
            <div className="hidden xl:flex items-center justify-center w-4 h-4 rounded text-intents-ux-info-textColor">
              <CalendarIcon className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-medium text-intents-ux-textStandard-textColor">{t('builder_marketing_legend_marketing_events')}</span>
          </div>
        </div>

        {/* Month Navigation */}
        <div className="flex items-center justify-center gap-3">
          <Button
            onClick={handlePrevMonth}
            design="tertiary"
            size="md"
            icon={<ChevronLeftIcon />}
            aria-label={t('builder_marketing_previous_month')}
          />
          <text.h3 className="min-w-[140px] xl:min-w-[200px] text-center text-lg xl:text-xl font-bold text-intents-ux-textStandard-textColor">
            {intl.formatDate(currentMonth, {
              month: 'long',
              year: 'numeric',
              timeZone: userTimezone
            })}
          </text.h3>
          <Button
            onClick={handleNextMonth}
            design="tertiary"
            size="md"
            icon={<ChevronRightIcon />}
            aria-label={t('builder_marketing_next_month')}
          />
        </div>
      </div>

      {/* Calendar Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center min-h-[400px] xl:min-h-[600px] rounded-2xl border border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxLowContrast-backgroundColor/30 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <Spinner size="lg" />
            <text.p className="text-sm text-intents-ux-textSubdued-textColor">{t('builder_marketing_loading_calendar')}</text.p>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl xl:border border-intents-ux-boxLowContrast-borderColor overflow-hidden xl:bg-intents-ux-boxStandard-backgroundColor xl:shadow-lg">
            {/* Day names header */}
            <div className="grid grid-cols-7 xl:border-b-2 border-intents-ux-boxLowContrast-borderColor xl:bg-intents-ux-boxLowContrast-backgroundColor">
              {dayNames.map((day, idx) => (
                <div
                  key={idx}
                  className="text-center text-xs xl:text-sm font-bold uppercase tracking-wider text-intents-ux-textStandard-textColor py-2 xl:py-4 px-1 xl:px-3 xl:border-r border-intents-ux-boxLowContrast-borderColor last:border-r-0"
                >
                  {day.slice(0, 3)}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7 xl:bg-intents-ux-boxStandard-backgroundColor">
              {calendarDays.map((day, idx) => (
                <CalendarDay
                  key={idx}
                  date={day}
                  isCurrentMonth={isCurrentMonthDay(day)}
                  isToday={isToday(day)}
                  isSelected={selectedDate?.toDateString() === day.toDateString()}
                  events={getEventsForDate(day)}
                  scheduledPosts={getScheduledPostsForDate(day)}
                  onClick={handleDayClick}
                />
              ))}
            </div>
          </div>

          {/* Selected Day Details - Mobile Only */}
          {selectedDate && (
            <div className="xl:hidden">
              <Box gap="md">
                {/* Date Header */}
                <div className="text-center py-4 border-b border-intents-ux-boxLowContrast-borderColor">
                  <text.p className="text-lg font-semibold text-intents-ux-textStandard-textColor">
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
                    {/* Blog Posts (Scheduled and Published) */}
                    {getScheduledPostsForDate(selectedDate).map((post, idx) => {
                      const isScheduled = post.status === 'scheduled';
                      return (
                        <div
                          key={`post-${idx}`}
                          className={cn(
                            'p-3 rounded-lg bg-intents-ux-boxStandard-backgroundColor border-l-4 flex items-center gap-3 shadow-sm',
                            isScheduled ? 'border-l-intents-ux-warning-borderColor' : 'border-l-intents-ux-feedbackSuccess-borderColor'
                          )}
                        >
                          <div className={cn(
                            'flex-shrink-0',
                            isScheduled ? 'text-intents-ux-warning-textColor' : 'text-intents-ux-feedbackSuccess-textColor'
                          )}>
                            {isScheduled ? (
                              <ClockIcon className="w-5 h-5" />
                            ) : (
                              <CheckmarkIcon className="w-5 h-5" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <text.p className="font-semibold text-sm text-intents-ux-textStandard-textColor">
                              {isScheduled ? t('builder_marketing_scheduled_blog_post') : t('builder_marketing_published_blog_post')}
                            </text.p>
                            <div className="flex items-center gap-2">
                              <text.p className="text-xs text-intents-ux-textSubdued-textColor">
                                {intl.formatTime(new Date(post.publishedAt), {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: userTimezone
                                })}
                              </text.p>
                            </div>
                            <text.p className="text-sm text-intents-ux-textSubdued-textColor">
                              {post.title}
                            </text.p>
                          </div>
                        </div>
                      );
                    })}

                    {/* Marketing Events */}
                    {getEventsForDate(selectedDate).map((event, idx) => (
                      <button
                        key={`event-${idx}`}
                        onClick={() => handleEventClick(event)}
                        className={cn(
                          'p-4 rounded-lg border-2 border-dashed w-full text-left',
                          'transition-all duration-150 hover:shadow-md active:scale-[0.99] cursor-pointer',
                          'border-intents-ux-info-borderColor bg-intents-ux-info-backgroundColor',
                          'hover:border-intents-ux-info-textColor'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 text-intents-ux-info-textColor">
                            <CalendarIcon className="w-6 h-6" />
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col gap-1">
                            <span className="text-xs font-bold text-intents-ux-info-textColor uppercase tracking-wide">
                              {t('builder_marketing_suggested_marketing_event')}
                            </span>
                            <text.p className="font-semibold text-base text-intents-ux-textStandard-textColor">
                              {event.name}
                            </text.p>
                            {event.description && (
                              <text.p className="text-sm text-intents-ux-textSubdued-textColor">
                                {event.description}
                              </text.p>
                            )}
                          </div>
                          <div className="flex-shrink-0 text-intents-ux-textSubdued-textColor">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </div>
                      </button>
                    ))}

                    {/* Add Custom Marketing Action button */}
                    <Button
                      onClick={() => {
                        setSelectedEvent(null);
                        if (typeof window !== 'undefined' && window.innerWidth < 1280) {
                          window.scrollTo({ top: 0, behavior: 'instant' });
                        }
                        setIsModalOpen(true);
                      }}
                      design="primary"
                      size="md"
                      className="w-full"
                    >
                      {t('builder_marketing_add_custom_marketing_action')}
                    </Button>
                  </Box>
                ) : (
                  <Box gap="sm">
                    <text.p className="text-center text-sm text-intents-ux-textSubdued-textColor py-4">
                      {t('builder_marketing_no_events_scheduled')}
                    </text.p>
                    <Button
                      onClick={() => {
                        setSelectedEvent(null);
                        if (typeof window !== 'undefined' && window.innerWidth < 1280) {
                          window.scrollTo({ top: 0, behavior: 'instant' });
                        }
                        setIsModalOpen(true);
                      }}
                      design="primary"
                      size="md"
                      className="w-full"
                    >
                      {t('builder_marketing_add_custom_marketing_action')}
                    </Button>
                  </Box>
                )}
              </Box>
            </div>
          )}
        </>
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
