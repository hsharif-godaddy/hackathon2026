export const MAX_DATE_RANGE_DAYS = 31;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
