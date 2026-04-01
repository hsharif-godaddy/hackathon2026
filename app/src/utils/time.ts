// Relative time formatting utilities that return i18n keys for localized "time ago" display.
interface TimeAgoResult {
  key: string;
  values: Record<string, number>;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DAYS_IN_MONTH = 30;
const DAYS_IN_YEAR = 365;

export function timeAgo(date: Date | string): TimeAgoResult {
  const past = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - past.getTime();

  const minutes = Math.floor(diffMs / MINUTE_MS);
  const hours = Math.floor(diffMs / HOUR_MS);
  const days = Math.floor(diffMs / DAY_MS);
  const months = Math.floor(days / DAYS_IN_MONTH);
  const years = Math.floor(days / DAYS_IN_YEAR);

  if (years >= 1) return { key: 'builder_time_years_ago', values: { years } };
  if (months >= 1) return { key: 'builder_time_months_ago', values: { months } };
  if (days >= 1) return { key: 'builder_time_days_ago', values: { days } };
  if (hours >= 1) return { key: 'builder_time_hours_ago', values: { hours } };
  if (minutes >= 1) return { key: 'builder_time_minutes_ago', values: { minutes } };
  return { key: 'builder_time_now', values: {} };
}
