export const MAX_DATE_RANGE_DAYS = 31;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const RANGE_DAYS: Record<string, number> = { '24h': 1, '7d': 7, '14d': 14, '30d': 30, '90d': 90 };

export function rangeToDateWindow(
  range: string,
  customFrom?: string,
  customTo?: string,
): { start: string; end: string } {
  if (range === 'custom' && customFrom && customTo) return { start: customFrom, end: customTo };
  const now = new Date();
  const utcToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = utcToday.toISOString().slice(0, 10);
  const n = RANGE_DAYS[range] ?? 7;
  const startDate = new Date(utcToday.getTime() - (n - 1) * MS_PER_DAY);
  return { start: startDate.toISOString().slice(0, 10), end };
}

function inclusiveUtcCalendarDays(start: string, end: string): number {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((endMs - startMs) / MS_PER_DAY) + 1;
}

export function isDateRangeValid(start: string, end: string): boolean {
  if (!start || !end) return false;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;
  if (endDate.getTime() < startDate.getTime()) return false;
  const inclusiveDays = inclusiveUtcCalendarDays(start, end);
  return inclusiveDays >= 1 && inclusiveDays <= MAX_DATE_RANGE_DAYS;
}

export function getDateRangeError(start: string, end: string): string | null {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return 'Invalid date format';
  }
  if (endDate.getTime() < startDate.getTime()) {
    return 'End date must be after start date';
  }
  const inclusiveDays = inclusiveUtcCalendarDays(start, end);
  if (inclusiveDays > MAX_DATE_RANGE_DAYS) {
    return `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} calendar days (inclusive)`;
  }
  return null;
}
