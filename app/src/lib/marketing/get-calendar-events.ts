import { CalendarEvent } from '@/types/marketing';

/**
 * Get the first and last day of a month
 */
export function getMonthDateRange(month: Date): { startDate: string; endDate: string } {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  // First day of month - format as YYYY-MM-DD without timezone conversion
  const startDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;

  // Last day of month - get the actual last day number
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
  const endDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

  return { startDate, endDate };
}

export function generateMilestoneEvents(
  siteCreatedAt: Date,
  month: Date
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const currentYear = month.getFullYear();
  const currentMonth = month.getMonth();

  // Check for anniversary in this month
  const anniversaryMonth = siteCreatedAt.getMonth();
  const anniversaryDay = siteCreatedAt.getDate();

  if (anniversaryMonth === currentMonth) {
    const yearsSinceLaunch = currentYear - siteCreatedAt.getFullYear();

    if (yearsSinceLaunch > 0) {
      events.push({
        date: new Date(currentYear, currentMonth, anniversaryDay, 12, 0, 0, 0),
        name: `Launch Anniversary (${yearsSinceLaunch} year${yearsSinceLaunch > 1 ? 's' : ''})`,
        emoji: '🎂',
        description: `Celebrate ${yearsSinceLaunch} year${yearsSinceLaunch > 1 ? 's' : ''} since your app launched!`,
        contentIdeas: [
          'Milestone celebration post',
          'Journey and growth story',
          'Thank you to users and supporters'
        ],
        isCustom: true,
        category: 'milestone'
      });
    }
  }

  return events;
}
