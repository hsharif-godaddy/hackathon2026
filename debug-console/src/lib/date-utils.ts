/**
 * 30 days from now, rounded up to the next UTC hour.
 * e.g. if now is 2026-04-04T15:21:31Z → 2026-05-04T16:00:00Z
 */
export function computeUseBefore(days: number = 30): string {
    const now = new Date();
    const daysLater = new Date(now);
    daysLater.setUTCDate(daysLater.getUTCDate() + days);

    const nextHour = daysLater.getUTCHours() + 1;
    daysLater.setUTCHours(nextHour, 0, 0, 0);

    return daysLater.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function formatTimestamp(timestamp: string): string {
    try {
        return new Date(timestamp).toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    } catch {
        return timestamp;
    }
}
