import { logger } from '@/lib/request-context'
import { SocialPlatform } from '@/types/social'

/**
 * Minimum time offset (in milliseconds) required before a post can be scheduled
 * UI enforces a unified 20-minute minimum for all platforms
 *
 * Platform API requirements: Instagram >15 min, Facebook >10 min
 * UI uses 20 min unified minimum to account for:
 * - TimePicker 15-minute intervals
 * - User delay between selecting time and publishing
 * - API call latency
 */
export const MIN_SCHEDULE_OFFSET_MS = 20 * 60 * 1000

/**
 * Maximum days in the future a post can be scheduled
 * Facebook (via Social V2 proxy): ~80 days maximum
 * Instagram (Graph API): 75 days maximum
 * UI uses 80 days to accommodate Facebook's higher limit
 */
export const MAX_SCHEDULE_DAYS = 80

/**
 * Platform-specific scheduling limits
 * These are the actual API requirements, not UI minimums
 */
export const PLATFORM_LIMITS: Record<SocialPlatform.INSTAGRAM | SocialPlatform.FACEBOOK, { minMinutes: number; maxDays: number }> = {
    [SocialPlatform.INSTAGRAM]: {
        minMinutes: 15,  // Instagram requires >15 min in future
        maxDays: 75      // Instagram allows up to 75 days in future
    },
    [SocialPlatform.FACEBOOK]: {
        minMinutes: 10,  // Facebook requires >10 min in future
        maxDays: 80      // Facebook allows ~80 days in future
    }
}

/**
 * Parse a 12-hour time string (e.g., "2:30 PM") and apply it to a date object
 * @param dateObj - The date object to modify
 * @param timeString - Time string in 12-hour format (e.g., "2:30 PM")
 */
export function parseTimeToDate(dateObj: Date, timeString: string): void {
    const timeMatch = timeString.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i)
    if (!timeMatch) return

    let hours = parseInt(timeMatch[1], 10)
    const minutes = parseInt(timeMatch[2], 10)
    const period = timeMatch[3]?.toUpperCase()

    if (period === 'PM' && hours !== 12) {
        hours += 12
    } else if (period === 'AM' && hours === 12) {
        hours = 0
    }

    dateObj.setHours(hours, minutes, 0, 0)
}

/**
 * Get the minimum allowed schedule time (current time + MIN_SCHEDULE_OFFSET_MS)
 */
export function getMinimumScheduleTime(): Date {
    return new Date(Date.now() + MIN_SCHEDULE_OFFSET_MS)
}

/**
 * Get the maximum allowed schedule time (current time + MAX_SCHEDULE_DAYS)
 */
export function getMaximumScheduleTime(): Date {
    const maxDate = new Date()
    maxDate.setDate(maxDate.getDate() + MAX_SCHEDULE_DAYS)
    return maxDate
}

/**
 * Calculate initial schedule time: 1 hour from now, rounded to next 15-min interval
 * @param locale - User's locale for time formatting
 */
export function getInitialScheduleTime(locale: string = 'en-US'): string {
    const date = new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
    const minutes = date.getMinutes()
    const roundedMinutes = Math.ceil(minutes / 15) * 15

    // Handle hour rollover if rounded minutes >= 60
    if (roundedMinutes >= 60) {
        date.setHours(date.getHours() + 1)
        date.setMinutes(0, 0, 0)
    } else {
        date.setMinutes(roundedMinutes, 0, 0)
    }

    const formattedTime = date.toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    })

    logger.debug('scheduling.initial-time', {
        now: new Date().toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: true }),
        calculated: formattedTime,
        locale
    })

    return formattedTime
}

/**
 * Get initial schedule date in YYYY-MM-DD format
 */
export function getInitialScheduleDate(): string {
    const today = new Date()
    const year = today.getFullYear()
    const month = String(today.getMonth() + 1).padStart(2, '0')
    const day = String(today.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

/**
 * Create a Date object from date/time strings using local timezone
 * Avoids UTC parsing issues with new Date("YYYY-MM-DD") in negative UTC offset timezones
 * @param dateString - Date in YYYY-MM-DD format
 * @param timeString - Time in 12-hour format (e.g., "2:30 PM")
 */
export function createLocalDateTime(dateString: string, timeString: string): Date {
    const [year, month, day] = dateString.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    parseTimeToDate(date, timeString)
    return date
}

/**
 * Validate if a scheduled date/time is valid (within 20 min to 80 days in the future)
 * @param dateString - Date in YYYY-MM-DD format
 * @param timeString - Time in 12-hour format (e.g., "2:30 PM")
 */
export function isValidScheduleTime(dateString: string, timeString: string): boolean {
    const scheduledDateTime = createLocalDateTime(dateString, timeString)
    const minTime = getMinimumScheduleTime()
    const maxTime = getMaximumScheduleTime()
    return scheduledDateTime > minTime && scheduledDateTime <= maxTime
}

/**
 * Validate if a scheduled Date meets platform-specific API requirements
 * @param scheduledAt - The scheduled date/time to validate
 * @param platform - The target platform (SocialPlatform.INSTAGRAM or SocialPlatform.FACEBOOK)
 * @returns Object with isValid flag and optional error message
 */
export function validatePlatformScheduleTime(
    scheduledAt: Date,
    platform: SocialPlatform.INSTAGRAM | SocialPlatform.FACEBOOK
): { isValid: boolean; error?: string } {
    const now = new Date()
    const limits = PLATFORM_LIMITS[platform]

    const minTime = new Date(now.getTime() + limits.minMinutes * 60 * 1000)
    const maxTime = new Date(now)
    maxTime.setDate(maxTime.getDate() + limits.maxDays)

    if (scheduledAt <= minTime) {
        return {
            isValid: false,
            error: `${platform} requires scheduled posts to be at least ${limits.minMinutes} minutes in the future`
        }
    }

    if (scheduledAt > maxTime) {
        return {
            isValid: false,
            error: `${platform} allows scheduling up to ${limits.maxDays} days in the future`
        }
    }

    return { isValid: true }
}


