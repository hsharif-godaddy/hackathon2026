export const MAX_DATE_RANGE_DAYS = 31;

export function isDateRangeValid(start: string, end: string): boolean {
    if (!start || !end) return false;
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= MAX_DATE_RANGE_DAYS;
}

export function getDateRangeError(start: string, end: string): string | null {
    if (!start || !end) return null;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return 'Invalid date format';
    }
    const diffMs = endDate.getTime() - startDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays < 0) return 'End date must be after start date';
    if (diffDays > MAX_DATE_RANGE_DAYS) return `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days`;
    return null;
}
