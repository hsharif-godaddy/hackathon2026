import { CalendarEvent, ScheduledPost } from '@/types/marketing';

interface FetchCalendarDataParams {
  appId: string;
  month: Date;
  market?: string;
  timezone?: string;
}

interface CalendarDataResponse {
  events: CalendarEvent[];
  scheduledPosts: ScheduledPost[];
  businessType: string;
}

/**
 * Fetch calendar data for a given month
 * Handles URL construction, API call, and date parsing
 * Returns empty arrays on error for graceful degradation
 */
export async function fetchCalendarData({
  appId,
  month,
  market = 'en-US',
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}: FetchCalendarDataParams): Promise<CalendarDataResponse> {
  try {
    const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;

    const params = new URLSearchParams({
      siteId: appId,
      month: monthStr,
      market,
      timezone,
    });

    const response = await fetch(`/api/marketing/calendar?${params.toString()}`);

    if (!response.ok) {
      console.error('Failed to fetch calendar data:', response.statusText);
      return { events: [], scheduledPosts: [], businessType: 'general' };
    }

    const data = await response.json();

    // Safely handle missing data
    const events = Array.isArray(data?.events) ? data.events : [];
    const scheduledPosts = Array.isArray(data?.scheduledPosts) ? data.scheduledPosts : [];

    // Parse dates to avoid timezone issues
    const parsedEvents = events.map((e: CalendarEvent) => {
      const isoDate = new Date(e.date);
      return {
        ...e,
        date: new Date(
          isoDate.getUTCFullYear(),
          isoDate.getUTCMonth(),
          isoDate.getUTCDate(),
          12, 0, 0, 0
        )
      };
    });

    return {
      events: parsedEvents,
      scheduledPosts,
      businessType: data?.businessType || 'general',
    };
  } catch (error) {
    console.error('Error fetching calendar data:', error);
    return { events: [], scheduledPosts: [], businessType: 'general' };
  }
}
