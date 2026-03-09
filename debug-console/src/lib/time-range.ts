export function parseTimeRange(
    timeRange: string,
    opts?: { customStartTime?: string; customEndTime?: string }
): { startTime: Date; endTime: Date } {
    const endTime = opts?.customEndTime ? new Date(opts.customEndTime) : new Date();

    if (opts?.customStartTime) {
        return { startTime: new Date(opts.customStartTime), endTime };
    }

    const value = parseInt(timeRange.slice(0, -1), 10);
    const unit = timeRange.slice(-1);
    const startTime = new Date(endTime);

    if (isNaN(value) || value <= 0) {
        startTime.setHours(startTime.getHours() - 24); // safe default: last 24 h
        return { startTime, endTime };
    }

    switch (unit) {
        case 'm': startTime.setMinutes(startTime.getMinutes() - value); break;
        case 'h': startTime.setHours(startTime.getHours() - value); break;
        case 'd': startTime.setDate(startTime.getDate() - value); break;
        default:  startTime.setHours(startTime.getHours() - 24); break; // unrecognised unit
    }

    return { startTime, endTime };
}
