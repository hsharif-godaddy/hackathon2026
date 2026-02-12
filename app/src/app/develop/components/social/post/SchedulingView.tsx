'use client'

import { memo, useCallback, useMemo } from 'react';
import Box from '@ux/box';
import DateInput from '@ux/date-input';
import Radio from '@ux/radio';
import text from '@ux/text';
import TimePicker from '@ux/time-picker';

import { useTranslations } from '@/hooks/useTranslations';
import { PublishTiming } from '@/types/social-posts';
import { getUserLocale } from '@/utils/common';
import { getMaximumScheduleTime, getMinimumScheduleTime, MAX_SCHEDULE_DAYS } from '@/utils/social/scheduling';

interface SchedulingViewProps {
  timing: PublishTiming;
  date: string[];
  time: string;
  onTimingChange: (timing: PublishTiming) => void;
  onDateChange: (date: string[]) => void;
  onTimeChange: (time: string) => void;
}

export const SchedulingView = memo(({
  timing,
  date,
  time,
  onTimingChange,
  onDateChange,
  onTimeChange
}: SchedulingViewProps) => {
  const t = useTranslations();

  const timezoneDisplay = useMemo(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const abbr = new Date().toLocaleTimeString(getUserLocale(), {
      timeZoneName: 'short'
    }).split(' ')[2];
    return `${tz} (${abbr})`;
  }, []);

  const shouldDisableDate = useCallback((dateStr: string) => {
    const selectedDate = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = getMaximumScheduleTime();
    return selectedDate < today || selectedDate > maxDate;
  }, []);

  const scheduleValidation = useMemo(() => {
    if (timing === PublishTiming.LATER && date.length && time) {
      const [year, month, day] = date[0].split('-').map(Number);
      const scheduledDateTime = new Date(year, month - 1, day);

      const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const period = timeMatch[3]?.toUpperCase();

        if (period === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period === 'AM' && hours === 12) {
          hours = 0;
        }

        scheduledDateTime.setHours(hours, minutes, 0, 0);
      } else {
        const [hours, minutes] = time.split(':');
        scheduledDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      }

      const now = new Date();
      const minimumScheduleTime = getMinimumScheduleTime();

      if (scheduledDateTime <= now) {
        return { isValid: false, message: 'builder_social_schedule_past_error' };
      }

      if (scheduledDateTime <= minimumScheduleTime) {
        return { isValid: false, message: 'builder_social_schedule_minimum_error' };
      }
    }
    return { isValid: true, message: null };
  }, [timing, date, time]);

  const isToday = useMemo(() => {
    if (!date.length) return false;
    const selectedDate = new Date(date[0]);
    const today = new Date();
    return selectedDate.toDateString() === today.toDateString();
  }, [date]);

  const minimumTime = useMemo(() => {
    if (!isToday) return null;
    const now = new Date();
    const minimum = new Date(now.getTime() + 20 * 60 * 1000);
    return minimum.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }, [isToday]);

  return (
    <Box orientation="vertical" gap="lg">
      <text.h2 as="title" size={0}>{t('builder_social_schedule_title')}</text.h2>

      <Box orientation="vertical" gap="md">
        <Box orientation="vertical" gap="sm">
          <Radio
            id="publish-now"
            name="timing"
            label={t('builder_social_schedule_now')}
            value={PublishTiming.NOW}
            checked={timing === PublishTiming.NOW}
            onChange={(checked) => checked && onTimingChange(PublishTiming.NOW)}
          />
          <text.p as="caption" size={-2} emphasis="passive" className="ml-3">
            {t('builder_social_schedule_now_description')}
          </text.p>
        </Box>

        <Box orientation="vertical" gap="sm">
          <Radio
            id="schedule-later"
            name="timing"
            label={t('builder_social_schedule_later')}
            value={PublishTiming.LATER}
            checked={timing === PublishTiming.LATER}
            onChange={(checked) => checked && onTimingChange(PublishTiming.LATER)}
          />
          <text.p as="caption" size={-2} emphasis="passive" className="ml-3">
            {t('builder_social_schedule_later_description', { minMinutes: 20, maxDays: MAX_SCHEDULE_DAYS })}
          </text.p>
        </Box>

        {timing === PublishTiming.LATER && (
          <Box orientation="vertical" gap="md" inlinePadding="md">
            <Box orientation="vertical" gap="sm">
              <DateInput
                id="schedule-date"
                label={t('builder_social_schedule_date_label')}
                value={date}
                onChange={onDateChange}
                locale={getUserLocale()}
                shouldDisableDate={shouldDisableDate}
                required
              />
            </Box>

            <Box orientation="vertical" gap="sm">
              <TimePicker
                id="schedule-time"
                label={t('builder_social_schedule_time_label')}
                value={time}
                onChange={onTimeChange}
                visualSize="md"
                required
                hour12={true}
                minuteInterval={15}
                locale={getUserLocale()}
                disabled={!date.length}
              />
              {isToday && minimumTime && !scheduleValidation.message && (
                <text.p as="caption" size={-2} emphasis="passive">
                  {t('builder_social_schedule_minimum_time', { time: minimumTime })}
                </text.p>
              )}
            </Box>

            {!scheduleValidation.isValid && scheduleValidation.message && (
              <text.p as="caption" size={-2} emphasis="critical">
                {t(scheduleValidation.message)}
              </text.p>
            )}

            <text.p as="caption" size={-2} emphasis="passive">
              {t('builder_social_schedule_timezone', { timezone: timezoneDisplay })}
            </text.p>
          </Box>
        )}
      </Box>
    </Box>
  );
});

SchedulingView.displayName = 'SchedulingView';
